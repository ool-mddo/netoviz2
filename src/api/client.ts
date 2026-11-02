import type { AttributesData, IndexEntry, LayerData, Summary, SupportsData } from './types'

/** Max number of ids in one request of attributes (server limit) */
export const MAX_ATTRIBUTE_IDS = 200

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function snapshotPath(network: string, snapshot: string): string {
  return `/topologies/${encodeURIComponent(network)}/${encodeURIComponent(snapshot)}/netoviz2`
}

async function errorOf(response: Response): Promise<ApiError> {
  let message = response.statusText
  try {
    const body = (await response.json()) as { error?: string }
    if (body.error) message = body.error
  } catch {
    // not a json body
  }
  return new ApiError(response.status, message)
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) throw await errorOf(response)
  return (await response.json()) as T
}

/** List of network/snapshot (existing API of netomox-exp) */
export function getIndex(): Promise<IndexEntry[]> {
  return requestJson<IndexEntry[]>('/topologies/index')
}

/**
 * @param etag ETag of the summary the client has. If it is the current one, returns null (304)
 */
export async function getSummary(network: string, snapshot: string, etag?: string): Promise<Summary | null> {
  const headers: Record<string, string> = {}
  if (etag) headers['If-None-Match'] = `"${etag}"`
  const response = await fetch(`${snapshotPath(network, snapshot)}/summary`, { headers })
  if (response.status === 304) return null
  if (!response.ok) throw await errorOf(response)
  return (await response.json()) as Summary
}

export function getLayer(network: string, snapshot: string, layerId: string): Promise<LayerData> {
  // a layer ID has `%` in it if the network name has special characters, so it is encoded again in the path
  return requestJson<LayerData>(`${snapshotPath(network, snapshot)}/layers/${encodeURIComponent(layerId)}`)
}

export function getSupports(network: string, snapshot: string): Promise<SupportsData> {
  return requestJson<SupportsData>(`${snapshotPath(network, snapshot)}/supports`)
}

/** Attributes of the objects. Requests are split by the limit of the server and merged. */
export async function getAttributes(
  network: string,
  snapshot: string,
  ids: string[],
): Promise<AttributesData> {
  const merged: AttributesData = { etag: '', objects: {}, not_found: [] }
  for (let i = 0; i < ids.length; i += MAX_ATTRIBUTE_IDS) {
    const part = await requestJson<AttributesData>(`${snapshotPath(network, snapshot)}/attributes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids.slice(i, i + MAX_ATTRIBUTE_IDS) }),
    })
    merged.etag = part.etag
    Object.assign(merged.objects, part.objects)
    merged.not_found.push(...part.not_found)
  }
  return merged
}
