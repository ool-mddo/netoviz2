import { describe, expect, it } from 'vitest'
import { parseProfileDocuments } from './profile'
import { profileSourceOf } from '../../../test/profileSource'
import { loadProfiles, type ProfileSource } from './profileSource'

const source = profileSourceOf({
  '../../../profiles/mddo-fw.yaml': () => Promise.resolve('view: physical\n'),
  '../../../profiles/broken.yml?raw': () => Promise.resolve('view: [\n'),
})

/** Source of the files which are already JSON (as the backend gives them) */
const sourceOf = (
  ...files: Array<{ name: string; documents?: unknown[]; error?: string }>
): ProfileSource => {
  return () => Promise.resolve(files.map((file) => ({ documents: [], ...file })))
}

describe('profileSourceOf', () => {
  it('gives a broken file with the error (not as a failure of the source)', async () => {
    const files = await source('any-network')
    expect(files.map((f) => f.name).sort()).toEqual(['broken', 'mddo-fw'])
    expect(files.find((f) => f.name === 'broken')?.error).toBeTruthy()
    expect(files.find((f) => f.name === 'mddo-fw')?.documents).toEqual([{ view: 'physical' }])
  })
})

describe('loadProfiles', () => {
  it('loads the files in the order of the names, and the documents in the order of the files', async () => {
    const { profiles } = await loadProfiles(
      'nw',
      sourceOf(
        { name: 'b', documents: [{ view: 'b1' }, null, { view: 'b2' }] },
        { name: 'a', documents: [{ view: 'a1' }] },
      ),
    )
    expect(profiles.map((p) => p.view)).toEqual(['a1', 'b1', 'b2'])
  })

  it('uses only the file of the name (the name is not used as a path)', async () => {
    const files = sourceOf(
      { name: 'a', documents: [{ view: 'a' }] },
      { name: 'b', documents: [{ view: 'b' }] },
    )
    expect((await loadProfiles('nw', files, { name: 'b' })).profiles.map((p) => p.view)).toEqual(['b'])
    await expect(loadProfiles('nw', files, { name: 'nothing' })).rejects.toThrow(
      "profile 'nothing' is not found",
    )
    await expect(loadProfiles('nw', files, { name: '../a' })).rejects.toThrow('is not found')
  })

  it('tells a broken file as a warning, but fails if the file is named', async () => {
    const files = sourceOf(
      { name: 'broken', error: 'bad yaml' },
      { name: 'invalid', documents: [{ view: 'v', tiers: 'x' }] },
      { name: 'ok', documents: [{ view: 'ok' }] },
    )
    const { profiles, warnings } = await loadProfiles('nw', files)
    expect(profiles.map((p) => p.view)).toEqual(['ok'])
    expect(warnings).toEqual(['broken: bad yaml', 'invalid #1: tiers must be a list'])
    await expect(loadProfiles('nw', files, { name: 'broken' })).rejects.toThrow('bad yaml')
    await expect(loadProfiles('nw', files, { name: 'invalid' })).rejects.toThrow('tiers must be a list')
  })

  it('keeps only the profiles which apply to the network and the snapshot', async () => {
    const files = sourceOf({
      name: 'f',
      documents: [
        { view: 'any' },
        { view: 'other-nw', target: { network: 'other' } },
        { view: 'asis', target: { network: 'nw', snapshot: 'original_asis|emulated_asis' } },
        { view: 'conduit', target: { snapshot: '(original|emulated)_asis_conduit\\d+' } },
      ],
    })
    const views = async (snapshot?: string) =>
      (await loadProfiles('nw', files, snapshot === undefined ? {} : { snapshot })).profiles.map(
        (p) => p.view,
      )
    expect(await views('emulated_asis')).toEqual(['any', 'asis'])
    expect(await views('original_asis_conduit2')).toEqual(['any', 'conduit'])
    expect(await views('original_asis_x')).toEqual(['any']) // the whole name must match
    expect(await views()).toEqual(['any', 'asis', 'conduit']) // the snapshot is unknown: not checked
  })

  it('warns when the named file does not apply', async () => {
    const files = sourceOf({ name: 'f', documents: [{ view: 'v', target: { snapshot: 'x' } }] })
    const { profiles, warnings } = await loadProfiles('nw', files, { name: 'f', snapshot: 'y' })
    expect(profiles).toEqual([])
    expect(warnings).toEqual(["profile 'f' does not apply to nw / y"])
  })
})

describe('loadProfiles (documents)', () => {
  it('skips only the invalid document of a file (automatic), and tells where each profile is from', async () => {
    const files = sourceOf(
      {
        name: 'f',
        documents: [
          { view: 'one' },
          { view: 'bad', target: { snapshot: '(' } },
          null,
          { view: 'four', axes: {} },
        ],
      },
      { name: 'g', documents: [{ view: 'g1' }] },
    )
    const { profiles, entries, warnings } = await loadProfiles('nw', files)
    expect(profiles.map((p) => p.view)).toEqual(['one', 'four', 'g1'])
    expect(entries.map((e) => `${e.file}#${e.index}:${e.profile.view}`)).toEqual([
      'f#1:one',
      'f#4:four',
      'g#1:g1',
    ])
    expect(warnings).toEqual([
      'f #2: target.snapshot is not a valid regular expression: (',
      "f #4: unknown key 'axes' is ignored",
    ])
    // the named file must be valid as a whole
    await expect(loadProfiles('nw', files, { name: 'f' })).rejects.toThrow('target.snapshot')
  })

  it('checks the network of the target (a profile for another network does not apply)', async () => {
    const files = sourceOf({ name: 'f', documents: [{ view: 'v', target: { network: 'other' } }] })
    expect((await loadProfiles('nw', files)).profiles).toEqual([])
    expect((await loadProfiles('nw', files, { name: 'f' })).warnings).toEqual([
      "profile 'f' does not apply to nw",
    ])
    expect((await loadProfiles('other', files)).profiles).toHaveLength(1)
  })
})

describe('parseProfileDocuments', () => {
  it('accepts JSON values and rejects an invalid target.snapshot', () => {
    expect(
      parseProfileDocuments([{ view: 'v', target: { snapshot: 'a|b' } }]).profiles[0]?.target.snapshot,
    ).toEqual(/^(?:a|b)$/)
    expect(() => parseProfileDocuments([{ view: 'v', target: { snapshot: '(' } }])).toThrow(
      'target.snapshot is not a valid regular expression',
    )
  })
})
