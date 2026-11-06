import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getAttributes, getLayer, getProfiles, getSummary, MAX_ATTRIBUTE_IDS } from './client'

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('getProfiles', () => {
  it('requests the profile files of the network (not under a snapshot; the name is encoded)', async () => {
    const files = [{ name: 'asis', documents: [{ view: 'v' }] }]
    const fetchMock = mockFetch(() => json({ network: 'nw/1', profiles: files }))
    expect(await getProfiles('nw/1')).toEqual(files)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/topologies/nw%2F1/netoviz2/profiles')
  })

  it('throws ApiError which tells that an old backend does not have the API', async () => {
    mockFetch(() => json({ error: 'Not Found' }, 404))
    await expect(getProfiles('nw')).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('does not provide the profile API') as string,
    })
  })

  it('rejects a response which is not in the form (e.g. another route of an old backend)', async () => {
    for (const body of [{}, { profiles: 'x' }, { profiles: [{ name: 'a' }] }, { profiles: [null] }, null]) {
      mockFetch(() => json(body))
      await expect(getProfiles('nw')).rejects.toMatchObject({ status: 502 })
    }
  })
})

describe('getSummary', () => {
  it('requests the summary of the snapshot (names are encoded)', async () => {
    const fetchMock = mockFetch(() => json({ etag: 'e1' }))
    await getSummary('nw/1', 'ss 2')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/topologies/nw%2F1/ss%202/netoviz2/summary')
  })

  it('sends If-None-Match and returns null for 304', async () => {
    const fetchMock = mockFetch(() => new Response(null, { status: 304 }))
    expect(await getSummary('nw', 'ss', 'e1')).toBeNull()
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ 'If-None-Match': '"e1"' })
  })

  it('throws ApiError with the message of the server', async () => {
    mockFetch(() => json({ error: 'Not found: x' }, 404))
    await expect(getSummary('nw', 'ss')).rejects.toMatchObject({ status: 404, message: 'Not found: x' })
    await expect(getSummary('nw', 'ss')).rejects.toBeInstanceOf(ApiError)
  })

  it('throws ApiError even if the error body is not json', async () => {
    mockFetch(() => new Response('<html>', { status: 502, statusText: 'Bad Gateway' }))
    await expect(getSummary('nw', 'ss')).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' })
  })
})

describe('getLayer', () => {
  it('encodes the layer ID again in the path', async () => {
    const fetchMock = mockFetch(() => json({ layer: 'a%2Fb' }))
    await getLayer('nw', 'ss', 'a%2Fb')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/topologies/nw/ss/netoviz2/layers/a%252Fb')
  })
})

describe('getAttributes', () => {
  it('splits requests by the limit and merges the results', async () => {
    const ids = Array.from({ length: MAX_ATTRIBUTE_IDS + 5 }, (_, i) => `id${i}`)
    const fetchMock = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { ids: string[] }
      return json({
        etag: 'e',
        objects: Object.fromEntries(body.ids.map((id) => [id, { type: 'node', attributes: {} }])),
        not_found: [],
      })
    })
    const result = await getAttributes('nw', 'ss', ids)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(Object.keys(result.objects)).toHaveLength(ids.length)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
  })

  it('does not request without ids', async () => {
    const fetchMock = mockFetch(() => json({}))
    expect((await getAttributes('nw', 'ss', [])).objects).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
