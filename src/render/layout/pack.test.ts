import { describe, expect, it } from 'vitest'
import { packBoxes } from './pack'

describe('packBoxes', () => {
  it('returns an empty map without boxes', () => {
    expect(packBoxes([], 10).size).toBe(0)
  })

  it('puts a single box at the origin', () => {
    expect(packBoxes([{ key: 'a', width: 100, height: 50 }], 10).get('a')).toEqual({ x: 0, y: 0 })
  })

  it('puts boxes in a grid without overlap, keeping the gap', () => {
    const boxes = [
      { key: 'a', width: 100, height: 50 },
      { key: 'b', width: 300, height: 80 },
      { key: 'c', width: 50, height: 200 },
      { key: 'd', width: 20, height: 20 },
    ]
    const gap = 10
    const positions = packBoxes(boxes, gap)
    for (const p of boxes) {
      for (const q of boxes) {
        if (p.key >= q.key) continue
        const [a, b] = [positions.get(p.key), positions.get(q.key)]
        if (!a || !b) throw new Error('missing position')
        const apart =
          a.x + p.width + gap <= b.x ||
          b.x + q.width + gap <= a.x ||
          a.y + p.height + gap <= b.y ||
          b.y + q.height + gap <= a.y
        expect(apart).toBe(true)
      }
    }
  })
})
