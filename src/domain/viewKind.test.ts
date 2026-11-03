import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW_KIND, engineOf, parseViewKind, VIEW_KINDS } from './viewKind'

describe('viewKind', () => {
  it('has the layout engines and the layer bands', () => {
    expect(VIEW_KINDS.map((k) => k.id)).toEqual(['force', 'stress', 'dependency'])
    expect(DEFAULT_VIEW_KIND).toBe('stress')
  })

  it('parses valid kinds only', () => {
    expect(parseViewKind('dependency')).toBe('dependency')
    expect(parseViewKind('force')).toBe('force')
    expect(parseViewKind('elk-stress')).toBeUndefined()
    expect(parseViewKind(undefined)).toBeUndefined()
  })

  it('tells the layout engine (the layer bands have none)', () => {
    expect(engineOf('force')).toBe('force')
    expect(engineOf('stress')).toBe('stress')
    expect(engineOf('dependency')).toBeUndefined()
  })
})
