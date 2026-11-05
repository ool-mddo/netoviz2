import { parseProfiles, type ParsedProfiles } from './profile'

/** Source of the profile files: the text of the profile file of the name, or undefined if there is no such profile */
export type ProfileSource = (name: string) => Promise<string | undefined>

/** Source from a set of loaders by file name (`<name>.yaml`) */
export function profileSourceOf(files: Readonly<Record<string, () => Promise<string>>>): ProfileSource {
  const byName = new Map<string, () => Promise<string>>()
  for (const [path, load] of Object.entries(files)) {
    const name = /([^/?]+)\.ya?ml(?:\?.*)?$/.exec(path)?.[1]
    if (name !== undefined) byName.set(name, load)
  }
  return (name) => byName.get(name)?.() ?? Promise.resolve(undefined)
}

/**
 * Profiles bundled in the app (`src/profiles/*.yaml`). It is the source of the trial stage: it is to be replaced by
 * the source which gets the profiles from the backend.
 */
export const bundledProfileSource: ProfileSource = profileSourceOf(
  import.meta.glob<string>('../../../profiles/*.{yaml,yml}', { query: '?raw', import: 'default' }),
)

/**
 * Load and parse the profile file of the name.
 * @throws Error if there is no such profile, or it is not valid
 */
export async function loadProfiles(
  name: string,
  source: ProfileSource = bundledProfileSource,
): Promise<ParsedProfiles> {
  const text = await source(name)
  if (text === undefined) throw new Error(`profile '${name}' is not found`)
  return parseProfiles(text)
}
