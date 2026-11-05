import { describe, expect, it } from 'vitest'
import { loadProfiles, profileSourceOf } from './profileSource'

const source = profileSourceOf({
  '../../../profiles/mddo-fw.yaml': () => Promise.resolve('view: physical\n'),
  '../../../profiles/broken.yml?raw': () => Promise.resolve('view: [\n'),
})

describe('loadProfiles', () => {
  it('loads and parses the profile file of the name', async () => {
    const { profiles } = await loadProfiles('mddo-fw', source)
    expect(profiles.map((p) => p.view)).toEqual(['physical'])
  })
  it('fails for an unknown profile (the name is not used as a path)', async () => {
    await expect(loadProfiles('nothing', source)).rejects.toThrow("profile 'nothing' is not found")
    await expect(loadProfiles('../mddo-fw', source)).rejects.toThrow('is not found')
  })
  it('fails for an invalid profile', async () => {
    await expect(loadProfiles('broken', source)).rejects.toThrow()
  })
})
