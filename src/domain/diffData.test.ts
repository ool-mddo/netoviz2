import { describe, expect, it } from 'vitest'
import { childPath, isDiffState, isMeaningfulDiffState, parseDiffData } from './diffData'

describe('parseDiffData', () => {
  it('parses changed, added and deleted entries', () => {
    const entries = parseDiffData([
      ['~', 'metric', 1, 9],
      ['+', 'neighbor[1]', { 'router-id': '1.1.1.1' }],
      ['-', 'neighbor[0]', { 'router-id': '2.2.2.2' }],
    ])
    expect(entries).toEqual([
      { sign: '~', path: 'metric', before: 1, after: 9 },
      { sign: '+', path: 'neighbor[1]', after: { 'router-id': '1.1.1.1' } },
      { sign: '-', path: 'neighbor[0]', before: { 'router-id': '2.2.2.2' } },
    ])
  })

  it('ignores malformed items', () => {
    expect(parseDiffData([['?', 'a', 1], 'x', [], ['~', 5, 1, 2], null])).toEqual([])
    expect(parseDiffData(undefined)).toEqual([])
    expect(parseDiffData({})).toEqual([])
  })
})

describe('childPath', () => {
  it('joins keys by a dot and indexes by brackets', () => {
    expect(childPath('', 'timer')).toBe('timer')
    expect(childPath('timer', 'dead-interval')).toBe('timer.dead-interval')
    expect(childPath('neighbor', 0)).toBe('neighbor[0]')
    expect(childPath('a.b[1]', 'c')).toBe('a.b[1].c')
  })
})

describe('diff state', () => {
  it('detects a diff state object', () => {
    expect(isDiffState({ forward: 'kept', backward: null, pair: '' })).toBe(true)
    expect(isDiffState({ name: 'x' })).toBe(false)
    expect(isDiffState(null)).toBe(false)
    expect(isDiffState([])).toBe(false)
  })

  it('does not show kept states', () => {
    expect(isMeaningfulDiffState({ forward: 'kept', backward: null, pair: '' })).toBe(false)
    expect(isMeaningfulDiffState({ forward: 'kept', backward: 'kept', pair: '' })).toBe(false)
  })

  it('shows states with changes or diff data', () => {
    expect(isMeaningfulDiffState({ forward: 'added' })).toBe(true)
    expect(isMeaningfulDiffState({ forward: 'kept', backward: 'changed' })).toBe(true)
    expect(isMeaningfulDiffState({ forward: 'kept', diff_data: [['~', 'a', 1, 2]] })).toBe(true)
    expect(isMeaningfulDiffState({ forward: 'kept', diff_data: [] })).toBe(false)
  })
})
