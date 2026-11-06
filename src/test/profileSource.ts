import type { ProfileFile } from '../api/types'
import type { ProfileSource } from '../render/layout/schematic/profileSource'
import { yamlDocuments } from './profileYaml'

/**
 * Source from a set of loaders of YAML texts by file name (`<name>.yaml`), as the backend gives the profile files
 * (the YAML is converted to JSON; a broken file has the error). The network is not used.
 */
export function profileSourceOf(files: Readonly<Record<string, () => Promise<string>>>): ProfileSource {
  const byName = new Map<string, () => Promise<string>>()
  for (const [path, load] of Object.entries(files)) {
    const name = /([^/?]+)\.ya?ml(?:\?.*)?$/.exec(path)?.[1]
    if (name !== undefined) byName.set(name, load)
  }
  return () =>
    Promise.all(
      [...byName.entries()].map(async ([name, load]): Promise<ProfileFile> => {
        try {
          return { name, documents: yamlDocuments(await load()).documents }
        } catch (error) {
          return { name, documents: [], error: error instanceof Error ? error.message : String(error) }
        }
      }),
    )
}
