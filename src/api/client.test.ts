import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getAttributes, getLayer, getSummary, MAX_ATTRIBUTE_IDS } from './client'

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

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
