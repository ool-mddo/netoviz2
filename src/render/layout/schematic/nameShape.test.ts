import { describe, expect, it } from 'vitest'
import { mddoBgpLayer1, mddoMregnwLayer1 } from '../../../test/sampleLayers'
import { mddoFwLayer1 } from '../../../test/mddoFwLayer1'
import { dominantShape, regexSourceOf, tokenize } from './nameShape'

const texts = (name: string) => tokenize(name).tokens.map((t) => t.text)

describe('tokenize', () => {
  it('splits a name by the separators and the borders of letters and digits', () => {
    expect(texts('site-a-seg1')).toEqual(['site', 'a', 'seg', '1'])
    expect(texts('site-a-br-1')).toEqual(['site', 'a', 'br', '1'])
    expect(texts('regiona-ce01')).toEqual(['regiona', 'ce', '01'])
    expect(texts('as65550-core00')).toEqual(['as', '65550', 'core', '00'])
    expect(texts('a_b')).toEqual(['a', 'b'])
    expect(tokenize('regiona-ce01').seps).toEqual(['', '-', ''])
  })
  it('keeps the other characters as tokens', () => {
    expect(texts('Seg_172.16.0.0/30')).toEqual(['Seg', '172', '.', '16', '.', '0', '.', '0', '/', '30'])
    expect(tokenize('Seg_172.16').tokens.map((t) => t.kind)).toEqual(['alpha', 'digits', 'other', 'digits'])
  })
  it('has no tokens for an empty name', () => {
    expect(tokenize('').tokens).toEqual([])
  })
})

describe('dominantShape', () => {
  const namesOf = (layer: { nodes: ReadonlyArray<{ name: string }> }) => layer.nodes.map((n) => n.name)

  it('does not distinguish the separator before the digits (seg1 and br-1 are the same shape)', () => {
    const shaped = dominantShape(namesOf(mddoFwLayer1()))
    expect(shaped?.mismatched).toEqual([])
    expect(shaped?.shape.kinds).toEqual(['alpha', 'alpha', 'alpha', 'digits'])
  })

  it('takes the most common shape and reports the other names', () => {
    const shaped = dominantShape(namesOf(mddoBgpLayer1()).concat(['as65550-core00']))
    expect(shaped?.shape.kinds).toEqual(['alpha', 'alpha', 'digits'])
    expect(shaped?.mismatched).toEqual(['as65550-core00'])
  })

  it('has no shape for no names', () => {
    expect(dominantShape([])).toBeUndefined()
    expect(dominantShape([''])).toBeUndefined()
  })

  it('is deterministic when the counts are the same', () => {
    const [a, b] = [dominantShape(['x-1', 'y']), dominantShape(['y', 'x-1'])]
    expect(a?.shape).toEqual(b?.shape)
  })
})

describe('regexSourceOf', () => {
  it('makes a regular expression with a named group for each token, which matches the names of the shape', () => {
    const names = mddoMregnwLayer1().nodes.map((n) => n.name)
    const shaped = dominantShape(names)!
    const re = new RegExp(regexSourceOf(shaped.shape, (i) => `t${i}`))
    expect(re.exec('regiona-ce01')?.groups).toEqual({ t0: 'regiona', t1: 'ce', t2: '01' })
    expect(re.test('regiona')).toBe(false)
    for (const name of names) expect(re.test(name)).toBe(true)
  })
  it('matches the names with and without the separator before the digits', () => {
    const shaped = dominantShape(['site-a-seg1', 'site-a-br-1'])!
    const re = new RegExp(regexSourceOf(shaped.shape, (i) => `t${i}`))
    expect(re.exec('site-a-seg1')?.groups?.t3).toBe('1')
    expect(re.exec('site-a-br-1')?.groups?.t3).toBe('1')
  })
  it('matches the other characters (anything except letters, digits and separators) literally as a class', () => {
    const shaped = dominantShape(['a.1'])!
    const re = new RegExp(regexSourceOf(shaped.shape, (i) => `t${i}`))
    expect(re.test('a.1')).toBe(true)
    expect(re.test('ab1')).toBe(false)
  })
})
