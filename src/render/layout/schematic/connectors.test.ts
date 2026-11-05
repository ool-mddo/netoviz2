import { describe, expect, it } from 'vitest'
import type { Positions } from '../types'
import { placeConnectors } from './connectors'

const placedOf = (entries: Record<string, [number, number]>): Positions =>
  new Map(Object.entries(entries).map(([id, [x, y]]) => [id, { x, y }]))
const R = 11
/** Distance which the circles of nodes keep from each other (the radii and the margin of 10) */
const CLEAR = 2 * R + 10
const place = (
  connectors: string[],
  links: Array<[string, string]>,
  placed: Positions,
  options?: Parameters<typeof placeConnectors>[4],
) =>
  placeConnectors(
    connectors.map((id) => ({ id, radius: R })),
    links.map(([source, target]) => ({ source, target })),
    placed,
    () => R,
    options,
  )
const distance = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

describe('placeConnectors', () => {
  it('puts a connection point at the middle of the two devices it joins (between rows)', () => {
    const placed = placedOf({ a: [0, 0], b: [100, 100] })
    const result = place(
      ['s'],
      [
        ['s', 'a'],
        ['s', 'b'],
      ],
      placed,
    )
    expect(result.get('s')).toEqual({ x: 50, y: 50 })
  })

  it('puts it at the centroid of three or more devices', () => {
    const placed = placedOf({ a: [0, 0], b: [200, 0], c: [100, 300] })
    const result = place(
      ['s'],
      [
        ['s', 'a'],
        ['s', 'b'],
        ['s', 'c'],
      ],
      placed,
    )
    expect(result.get('s')).toEqual({ x: 100, y: 100 })
  })

  it('moves it over the row (upward first) when a device is in the way between two devices in a row', () => {
    const placed = placedOf({ a: [0, 0], b: [100, 0], c: [200, 0] })
    const s = place(
      ['s'],
      [
        ['s', 'a'],
        ['s', 'c'],
      ],
      placed,
    ).get('s')!
    expect(s.y).toBeLessThan(0)
    expect(s.x).toBeCloseTo(100, 6)
    // the links to the devices clear b
    for (const device of [placed.get('a')!, placed.get('c')!]) {
      expect(distance(placed.get('b')!, s, device)).toBeGreaterThanOrEqual(R + 10 - 1e-6)
    }
  })

  it('moves it away from the device when the centroid is the position of a device (three in a row, or only one)', () => {
    const row = placedOf({ a: [0, 0], b: [100, 0], c: [200, 0] })
    const s = place(
      ['s'],
      [
        ['s', 'a'],
        ['s', 'b'],
        ['s', 'c'],
      ],
      row,
    ).get('s')!
    for (const q of row.values())
      expect(Math.hypot(s.x - q.x, s.y - q.y)).toBeGreaterThanOrEqual(CLEAR - 1e-6)
    const one = placedOf({ a: [0, 0] })
    const t = place(['s'], [['s', 'a']], one).get('s')!
    expect(Math.hypot(t.x, t.y)).toBeGreaterThanOrEqual(CLEAR - 1e-6)
  })

  it('moves it sideways when the devices are in a column and a node is in the way', () => {
    const placed = placedOf({ a: [0, 0], b: [0, 200], n: [0, 100] })
    const s = place(
      ['s'],
      [
        ['s', 'a'],
        ['s', 'b'],
      ],
      placed,
    ).get('s')!
    expect(s.x).toBeGreaterThan(0)
    expect(s.y).toBeCloseTo(100, 6)
  })

  it('does not put it on a link between devices (not through the connection point)', () => {
    // the centroid (100, 0) is on the link a - c
    const placed = placedOf({ a: [0, 0], c: [200, 0], d1: [100, -60], d2: [100, 60] })
    const s = place(
      ['s'],
      [
        ['a', 'c'],
        ['s', 'd1'],
        ['s', 'd2'],
      ],
      placed,
    ).get('s')!
    expect(distance(s, placed.get('a')!, placed.get('c')!)).toBeGreaterThanOrEqual(R + 10 - 1e-6)
  })

  it('does not overlap the nodes, nor the connection points which are already placed, nor their links', () => {
    const placed = placedOf({ a: [0, 0], b: [100, 0] })
    const result = place(
      ['s1', 's2'],
      [
        ['s1', 'a'],
        ['s1', 'b'],
        ['s2', 'a'],
        ['s2', 'b'],
      ],
      placed,
    )
    const [p1, p2] = [result.get('s1')!, result.get('s2')!]
    expect(Math.hypot(p1.x - p2.x, p1.y - p2.y)).toBeGreaterThanOrEqual(CLEAR - 1e-6)
    for (const p of [p1, p2]) {
      for (const q of placed.values())
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(CLEAR - 1e-6)
    }
    // the one placed later is not on the links of the one placed before
    expect(distance(p2, p1, placed.get('a')!)).toBeGreaterThanOrEqual(R + 10 - 1e-6)
    expect(distance(p2, p1, placed.get('b')!)).toBeGreaterThanOrEqual(R + 10 - 1e-6)
  })

  it('uses the position which breaks the least when nothing is free within maxSteps (not a failure)', () => {
    const placed = placedOf({ a: [0, 0], b: [100, 0], c: [200, 0] })
    const links: Array<[string, string]> = [
      ['s', 'a'],
      ['s', 'c'],
    ]
    // maxSteps 0: the centroid, which is the position of b
    expect(place(['s'], links, placed, { maxSteps: 0 }).get('s')).toEqual({ x: 100, y: 0 })
    const s = place(['s'], links, placed, { maxSteps: 1, step: 5 }).get('s')!
    expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true)
  })

  it('does not place a connection point which is not linked to a placed node, and ignores the other links', () => {
    const placed = placedOf({ a: [0, 0], b: [100, 0] })
    const links: Array<[string, string]> = [
      ['s', 'a'],
      ['s', 'b'],
      ['s', 'a'],
      ['a', 'b'],
      ['lonely', 'nothing'],
      ['s', 's2'],
      ['s', 's'],
    ]
    const result = place(['s', 's2', 'lonely'], links, placed)
    expect([...result.keys()]).toEqual(['s'])
  })

  it('is deterministic and independent of the order of the connection points and of the links', () => {
    const placed = placedOf({ a: [0, 0], b: [100, 0], c: [200, 0] })
    const links: Array<[string, string]> = [
      ['s1', 'a'],
      ['s1', 'c'],
      ['s2', 'a'],
      ['s2', 'b'],
    ]
    const first = place(['s1', 's2'], links, placed)
    const second = place(['s2', 's1'], [...links].reverse(), placed)
    expect([...second].sort()).toEqual([...first].sort())
  })
})
