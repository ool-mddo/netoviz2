import { describe, expect, it } from 'vitest'
import { ProfileError, parseSelector, selectProfile } from './profile'
import { parseProfiles } from '../../../test/profileYaml'

const SAMPLE = `
view: physical
target: { network: mddo-fw, layer: layer1 }
tiers: [wan, fw]
name: '^site-(?<site>[a-z])-(?<role>[a-z]+)-?(?<index>\\d+)$'
rules:
  - { select: '*', group: site, pair: { by: index, primary: '1' } }
  - { select: '[role=br]', tier: wan }
  - { select: '[site=a]', order: 1 }
  - { select: '#site-a-fw-1', tier: fw }
  - { select: '[role=fw]', tier: fw, shape: box }
---
view: logical
target: { layer: layer3 }
`

describe('parseSelector', () => {
  it('parses *, #id and [key=value] (combined)', () => {
    expect(parseSelector('*')).toEqual({ attrs: [] })
    expect(parseSelector('#a/b[kind=segment]')).toEqual({
      id: 'a/b',
      attrs: [{ key: 'kind', value: 'segment' }],
    })
    expect(parseSelector('[site=a][role=br]').attrs).toHaveLength(2)
  })
  it('rejects an invalid selector', () => {
    expect(() => parseSelector('role=br')).toThrow(ProfileError)
    expect(() => parseSelector('')).toThrow(ProfileError)
    expect(() => parseSelector('[role]')).toThrow(ProfileError)
  })
})

describe('parseProfiles', () => {
  it('parses the views of a file', () => {
    const { profiles, warnings } = parseProfiles(SAMPLE)
    expect(profiles.map((p) => p.view)).toEqual(['physical', 'logical'])
    const physical = profiles[0]!
    expect(physical.target).toEqual({ network: 'mddo-fw', layer: 'layer1' })
    expect(physical.tiers).toEqual(['wan', 'fw'])
    expect(physical.name?.exec('site-a-br-1')?.groups).toMatchObject({ site: 'a', role: 'br', index: '1' })
    expect(physical.rules[0]).toMatchObject({ group: 'site', pair: { by: 'index', primary: '1' } })
    expect(physical.rules[2]).toMatchObject({ order: 1 })
    expect(physical.rules[3]?.select.id).toBe('site-a-fw-1')
    expect(warnings).toEqual(["rules[4]: unknown key 'shape' is ignored"])
  })

  it('parses `group: { value }` as a literal group value (and `group: name` as a captured one)', () => {
    const { profiles, warnings } = parseProfiles(
      "view: v\nrules:\n  - { select: '*', group: { value: core } }\n  - { select: '*', group: site }\n",
    )
    expect(profiles[0]?.rules[0]).toMatchObject({ groupValue: 'core' })
    expect(profiles[0]?.rules[0]?.group).toBeUndefined()
    expect(profiles[0]?.rules[1]).toMatchObject({ group: 'site' })
    expect(profiles[0]?.rules[1]?.groupValue).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('rejects an invalid `group: { value }` (missing, empty, not a string) and warns about unknown keys', () => {
    for (const group of ['{}', "{ value: '' }", '{ value: 1 }']) {
      expect(() => parseProfiles(`view: v\nrules:\n  - { select: '*', group: ${group} }\n`)).toThrow(
        ProfileError,
      )
    }
    const { warnings } = parseProfiles("view: v\nrules:\n  - { select: '*', group: { value: a, x: 1 } }\n")
    expect(warnings).toEqual(["rules[0].group: unknown key 'x' is ignored"])
  })

  it('warns about unknown top-level keys (axes, inherit are not supported yet)', () => {
    const { warnings } = parseProfiles('view: v\naxes: { y: tier }\n')
    expect(warnings).toEqual(["unknown key 'axes' is ignored"])
  })

  it('parses inherit (the layer to inherit from), and warns about a via other than supports', () => {
    const { profiles, warnings } = parseProfiles('view: v\ninherit: { from: layer1, via: supports }\n')
    expect(profiles[0]?.inherit).toEqual({ from: 'layer1' })
    expect(warnings).toEqual([])
    expect(parseProfiles('view: v\ninherit: { from: layer1, via: links }\n').warnings).toEqual([
      "inherit: via 'links' is not supported (only supports)",
    ])
    expect(parseProfiles('view: v\n').profiles[0]?.inherit).toBeUndefined()
    expect(() => parseProfiles('view: v\ninherit: {}\n')).toThrow(ProfileError)
  })

  it('warns about unknown keys of target and pair (a typo of target would apply the profile to all the layers)', () => {
    const { warnings } = parseProfiles(
      "view: v\ntarget: { layers: layer1 }\nrules:\n  - { select: '*', pair: { by: i, primary: '1', second: '2' } }\n",
    )
    expect(warnings).toEqual([
      "target: unknown key 'layers' is ignored",
      "rules[0].pair: unknown key 'second' is ignored",
    ])
  })

  it('warns about what YAML warns (e.g. an unknown tag)', () => {
    const { warnings } = parseProfiles('view: !foo v\n')
    expect(warnings).toHaveLength(1)
  })

  it.each([
    [
      'an unquoted primary (01 is read as the number 1)',
      "view: v\nrules:\n  - { select: '*', pair: { by: i, primary: 01 } }\n",
    ],
    ['broken yaml', 'view: [\n'],
    ['no view', 'tiers: [a]\n'],
    ['a tier not in tiers', 'view: v\ntiers: [a]\nrules:\n  - { select: "*", tier: b }\n'],
    ['an invalid name regex', "view: v\nname: '('\n"],
    ['an invalid selector', 'view: v\nrules:\n  - { select: "x" }\n'],
    ['a non-numeric order', 'view: v\nrules:\n  - { select: "*", order: left }\n'],
    ['rules which is not a list', 'view: v\nrules: {}\n'],
  ])('rejects %s', (_label, text) => {
    expect(() => parseProfiles(text)).toThrow(ProfileError)
  })
})

describe('selectProfile', () => {
  const { profiles } = parseProfiles(SAMPLE)
  it('selects by the layer of the target', () => {
    expect(selectProfile(profiles, 'layer1')?.view).toBe('physical')
    expect(selectProfile(profiles, 'layer3')?.view).toBe('logical')
    expect(selectProfile(profiles, 'layer2')).toBeUndefined()
  })
  it('selects by the view name', () => {
    expect(selectProfile(profiles, 'layer1', 'logical')).toBeUndefined()
    expect(selectProfile(profiles, 'layer3', 'logical')?.view).toBe('logical')
  })
})
