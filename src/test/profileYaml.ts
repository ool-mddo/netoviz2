import { parseAllDocuments } from 'yaml'
import { ProfileError, parseProfileDocuments, type ParsedProfiles } from '../render/layout/schematic/profile'

/**
 * Read a YAML text as the documents of a profile file (`---` separated).
 * It is for the tests only: netoviz2 does not read YAML (the backend converts the profile files to JSON).
 * @throws ProfileError if the text is not valid YAML
 */
export function yamlDocuments(text: string): { documents: unknown[]; warnings: string[] } {
  const documents: unknown[] = []
  const warnings: string[] = []
  for (const doc of parseAllDocuments(text)) {
    const [error] = doc.errors
    if (error) throw new ProfileError(error.message)
    for (const warning of doc.warnings) warnings.push(warning.message)
    documents.push(doc.toJS())
  }
  return { documents, warnings }
}

/** Parse the text of a profile file (YAML) */
export function parseProfiles(text: string): ParsedProfiles {
  const { documents, warnings } = yamlDocuments(text)
  const parsed = parseProfileDocuments(documents)
  return { profiles: parsed.profiles, warnings: [...warnings, ...parsed.warnings] }
}
