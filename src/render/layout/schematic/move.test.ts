import { describe, expect, it } from 'vitest'
import type { Position } from '../types'
import { constrainDelta, moveNodes, movingNodes, snapDelta, type MoveRequest } from './move'
import type { SchematicStructure } from './types'

const node = (id: string) => ({ id, name: id, radius: 11 })
const at = (x: number, y: number): Position => ({ x, y })

// base layer: r1 r2 (row y=0), h1 h2 (row y=100), segment s joins r1 and h1 (connection point)
// up layer: follows the base one to one (u-r1 ...), and u-s follows s
const from = new Map<string, Position>([
  ['b/r1', at(0, 0)],
  ['b/r2', at(100, 0)],
  ['b/h1', at(0, 100)],
  ['b/h2', at(100, 100)],
  ['b/s', at(0, 50)],
  ['u/r1', at(1000, 0)],
  ['u/r2', at(1100, 0)],
  ['u/h1', at(1000, 100)],
  ['u/h2', at(1100, 100)],
  ['u/s', at(1000, 50)],
])
const layerOf = (id: string) => id.split('/')[0]
const structures = new Map<string, SchematicStructure>([
  [
    'b',
    {
      layer: 'b',
      connectors: [node('b/s')],
      links: [
        { source: 'b/r1', target: 'b/s' },
        { source: 'b/s', target: 'b/h1' },
      ],
      follows: new Map(),
    },
  ],
  [
    'u',
    {
      layer: 'u',
      connectors: [node('u/s')],
      links: [
        { source: 'u/r1', target: 'u/s' },
        { source: 'u/s', target: 'u/h1' },
      ],
      follows: new Map([
        ['u/r1', 'b/r1'],
        ['u/r2', 'b/r2'],
        ['u/h1', 'b/h1'],
        ['u/h2', 'b/h2'],
      ]),
    },
  ],
])
const request = (over: Partial<MoveRequest>): MoveRequest => ({
  id: 'b/r1',
  scope: 'node',
  from,
  delta: at(30, 0),
  structures,
  layerOf,
  radiusOf: () => 11,
  ...over,
})

describe('snapDelta', () => {
  it('rounds the movement to the grid', () => {
    expect(snapDelta(at(14, -26), 20)).toEqual(at(20, -20))
    expect(snapDelta(at(14, -26), 0)).toEqual(at(14, -26))
  })
})

describe('constrainDelta', () => {
  it('moves a row only vertically and a column only horizontally', () => {
    expect(constrainDelta(at(14, -26), 'row')).toEqual(at(0, -26))
    expect(constrainDelta(at(14, -26), 'column')).toEqual(at(14, 0))
    expect(constrainDelta(at(14, -26), 'node')).toEqual(at(14, -26))
  })
})

describe('movingNodes', () => {
  it('moves the node and the nodes which follow it in the other layers', () => {
    expect([...movingNodes(request({}))].sort()).toEqual(['b/r1', 'u/r1'])
  })

  it('moves the node it follows too when it is the only one which follows the node (and the others which follow that)', () => {
    expect([...movingNodes(request({ id: 'u/r1' }))].sort()).toEqual(['b/r1', 'u/r1'])
  })

  it('does not move the node it follows when the node supports many (an interface of a device)', () => {
    const many = new Map(structures)
    many.set('u', {
      ...structures.get('u')!,
      follows: new Map([
        ['u/r1', 'b/r1'],
        ['u/r2', 'b/r1'],
      ]),
    })
    expect([...movingNodes(request({ id: 'u/r1', structures: many }))]).toEqual(['u/r1'])
    // the nodes which follow it move with the node it follows
    expect([...movingNodes(request({ id: 'b/r1', structures: many }))].sort()).toEqual([
      'b/r1',
      'u/r1',
      'u/r2',
    ])
  })

  it('moves the nodes of the row / the column of the layer', () => {
    expect([...movingNodes(request({ scope: 'row' }))].sort()).toEqual(['b/r1', 'b/r2', 'u/r1', 'u/r2'])
    expect([...movingNodes(request({ scope: 'column' }))].sort()).toEqual(['b/h1', 'b/r1', 'u/h1', 'u/r1'])
  })

  it('moves a connection point by itself', () => {
    expect([...movingNodes(request({ id: 'b/s', scope: 'row' }))]).toEqual(['b/s'])
  })
})

describe('moveNodes', () => {
  it('moves the nodes and puts the connection points between the devices again', () => {
    const moved = moveNodes(request({ delta: at(40, 0) }))
    expect(moved.get('b/r1')).toEqual(at(40, 0))
    expect(moved.get('u/r1')).toEqual(at(1040, 0))
    expect(moved.get('b/r2')).toBeUndefined()
    // the segment is at the centroid of r1 (40, 0) and h1 (0, 100) (or moved off it by the placement)
    expect(moved.get('b/s')?.x).toBeCloseTo(20, 0)
    expect(moved.get('u/s')?.x).toBeCloseTo(1020, 0)
  })

  it('keeps the connection points which are pinned', () => {
    const moved = moveNodes(request({ delta: at(40, 0), pinned: new Set(['b/s']) }))
    expect(moved.has('b/s')).toBe(false)
    expect(moved.has('u/s')).toBe(true)
  })

  it('is stable: the same connection points stay where they were when nothing moves', () => {
    const moved = moveNodes(request({ delta: at(0, 0) }))
    expect(moved.get('b/s')).toEqual(from.get('b/s'))
    expect(moved.get('u/s')).toEqual(from.get('u/s'))
  })
})
