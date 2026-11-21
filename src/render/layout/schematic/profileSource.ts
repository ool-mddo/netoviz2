import { ProfileError, parseProfile, profileInScope, type ParsedProfiles } from './profile'
import type { DiagramProfile } from './types'
import type { ProfileFile } from '../../../api/types'

/** Source of the profile files of a network (the backend: see `getProfiles` of the API client) */
export type ProfileSource = (network: string) => Promise<ProfileFile[]>

export interface LoadOptions {
  /** Use only the profile file of the name (`?profile=<name>`) */
  name?: string
  /** The snapshot being shown (`target.snapshot` of the profiles is checked against it) */
  snapshot?: string
}

/** A profile with where it is from (to tell the user which profile is used) */
export interface LoadedProfile {
  /** Name of the profile file */
  file: string
  /** Position of the document in the file (from 1) */
  index: number
  profile: DiagramProfile
}

export interface LoadedProfiles extends ParsedProfiles {
  /** The same profiles as `profiles`, with the file and the position */
  entries: LoadedProfile[]
}

/** A profile file which can be chosen (`?profile=<name>`) for the network / snapshot */
export interface ProfileChoice {
  /** Name of the file */
  name: string
  /** At least one document of the file applies to the network / snapshot (the target accepts it) */
  applies: boolean
  /** Why the file cannot be used (broken file or document), if it cannot */
  error?: string
}

/**
 * The profile files of the network as choices, in the order of the names. A file which is broken, or none of whose
 * documents applies to the network / snapshot (the snapshot may be unknown: then it is not checked), is `applies: false`.
 */
export async function profileChoices(
  network: string,
  source: ProfileSource,
  snapshot?: string,
): Promise<ProfileChoice[]> {
  const files = [...(await source(network))].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const choices: ProfileChoice[] = []
  for (const file of files) {
    try {
      // the same check as a named profile (`?profile=<name>`): the file must be valid and apply
      const loaded = await loadProfiles(network, () => Promise.resolve([file]), {
        name: file.name,
        ...(snapshot === undefined ? {} : { snapshot }),
      })
      choices.push({ name: file.name, applies: loaded.entries.length > 0 })
    } catch (error) {
      choices.push({
        name: file.name,
        applies: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return choices
}

/**
 * Load the profiles of the network which apply to the network / snapshot, in the order of the files (by the name) and
 * of the documents in them. Without `options.name` a broken file or document is a warning (the other ones are used);
 * with it the file must be valid (an error). The snapshot may be unknown: then `target.snapshot` is not checked.
 * @throws ProfileError if the named file is not found or not valid
 */
export async function loadProfiles(
  network: string,
  source: ProfileSource,
  options: LoadOptions = {},
): Promise<LoadedProfiles> {
  const { name, snapshot } = options
  const all = [...(await source(network))].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const files = name === undefined ? all : all.filter((file) => file.name === name)
  if (name !== undefined && files.length === 0) throw new ProfileError(`profile '${name}' is not found`)

  const loaded: LoadedProfile[] = []
  const warnings: string[] = []
  for (const file of files) {
    const error = file.error ?? (Array.isArray(file.documents) ? undefined : 'documents is not a list')
    if (error !== undefined) {
      if (name !== undefined) throw new ProfileError(error)
      warnings.push(`${file.name}: ${error}`)
      continue
    }
    file.documents.forEach((document, i) => {
      if (document === null || document === undefined) return // an empty document
      const where = `${file.name} #${i + 1}`
      const own: string[] = []
      try {
        loaded.push({ file: file.name, index: i + 1, profile: parseProfile(document, own) })
      } catch (error) {
        if (name !== undefined || !(error instanceof ProfileError)) throw error
        warnings.push(`${where}: ${error.message}`)
      }
      warnings.push(...own.map((warning) => `${where}: ${warning}`))
    })
  }
  const scope = { network, ...(snapshot === undefined ? {} : { snapshot }) }
  const entries = loaded.filter((entry) => profileInScope(entry.profile, scope))
  if (name !== undefined && loaded.length > 0 && entries.length === 0) {
    warnings.push(
      `profile '${name}' does not apply to ${network}${snapshot === undefined ? '' : ` / ${snapshot}`}`,
    )
  }
  return { profiles: entries.map((entry) => entry.profile), warnings, entries }
}
