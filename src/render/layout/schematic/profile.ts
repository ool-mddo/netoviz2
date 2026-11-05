import { parseAllDocuments } from 'yaml'
import type { DiagramProfile, ProfileRule, Selector } from './types'

export interface ParsedProfiles {
  profiles: DiagramProfile[]
  /** Problems which do not prevent using the profiles (e.g. unknown keys) */
  warnings: string[]
}

export class ProfileError extends Error {}

// Unknown keys (e.g. the keys of the design which are not supported yet) are ignored with a warning: a typo in
// `target` would widen the layers the profile is applied to, so it is checked as well.
const KNOWN_TOP_KEYS = new Set(['view', 'target', 'tiers', 'name', 'rules'])
const KNOWN_TARGET_KEYS = new Set(['network', 'layer'])
const KNOWN_RULE_KEYS = new Set(['select', 'tier', 'group', 'order', 'pair'])
const KNOWN_PAIR_KEYS = new Set(['by', 'primary'])

function warnUnknownKeys(
  raw: Record<string, unknown>,
  known: ReadonlySet<string>,
  where: string,
  warnings: string[],
): void {
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) warnings.push(`${where}unknown key '${key}' is ignored`)
  }
}

/** Parse a selector: `*`, `#id`, `[key=value]` or a sequence of them (e.g. `[site=a][role=br]`) */
export function parseSelector(text: string): Selector {
  const source = text.trim()
  if (source === '*') return { attrs: [] }
  let rest = source
  let id: string | undefined
  const attrs: Array<{ key: string; value: string }> = []
  while (rest.length > 0) {
    const attr = /^\[([^\]=\s]+)=([^\]]*)\]/.exec(rest)
    const idMatch = /^#(\S+?)(?=\[|$)/.exec(rest)
    if (attr?.[1] !== undefined && attr[2] !== undefined) {
      attrs.push({ key: attr[1], value: attr[2] })
      rest = rest.slice(attr[0].length)
    } else if (idMatch?.[1] !== undefined && id === undefined) {
      id = idMatch[1]
      rest = rest.slice(idMatch[0].length)
    } else {
      throw new ProfileError(`invalid selector: ${text}`)
    }
  }
  if (id === undefined && attrs.length === 0) throw new ProfileError(`invalid selector: ${text}`)
  return id === undefined ? { attrs } : { id, attrs }
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProfileError(`${where} must be a mapping`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new ProfileError(`${where} must be a string`)
  return String(value)
}

/** A string which must be quoted in YAML (e.g. `'01'`: an unquoted 01 is read as the number 1 and does not match) */
function asQuotedString(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new ProfileError(`${where} must be a quoted string (e.g. '1')`)
  return value
}

function parseRule(value: unknown, index: number, tiers: readonly string[], warnings: string[]): ProfileRule {
  const where = `rules[${index}]`
  const raw = asRecord(value, where)
  warnUnknownKeys(raw, KNOWN_RULE_KEYS, `${where}: `, warnings)
  const selectText = asString(raw.select, `${where}.select`)
  const rule: ProfileRule = { select: parseSelector(selectText), selectText }
  if (raw.tier !== undefined) {
    rule.tier = asString(raw.tier, `${where}.tier`)
    if (!tiers.includes(rule.tier)) throw new ProfileError(`${where}.tier '${rule.tier}' is not in tiers`)
  }
  if (raw.group !== undefined) rule.group = asString(raw.group, `${where}.group`)
  if (raw.order !== undefined) {
    if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) {
      throw new ProfileError(`${where}.order must be a number`)
    }
    rule.order = raw.order
  }
  if (raw.pair !== undefined) {
    const pair = asRecord(raw.pair, `${where}.pair`)
    warnUnknownKeys(pair, KNOWN_PAIR_KEYS, `${where}.pair: `, warnings)
    rule.pair = {
      by: asString(pair.by, `${where}.pair.by`),
      primary: asQuotedString(pair.primary, `${where}.pair.primary`),
    }
  }
  return rule
}

function parseProfile(value: unknown, warnings: string[]): DiagramProfile {
  const raw = asRecord(value, 'profile')
  warnUnknownKeys(raw, KNOWN_TOP_KEYS, '', warnings)
  const view = asString(raw.view, 'view')
  const targetRaw = raw.target === undefined ? {} : asRecord(raw.target, 'target')
  warnUnknownKeys(targetRaw, KNOWN_TARGET_KEYS, 'target: ', warnings)
  const target: DiagramProfile['target'] = {}
  if (targetRaw.network !== undefined) target.network = asString(targetRaw.network, 'target.network')
  if (targetRaw.layer !== undefined) target.layer = asString(targetRaw.layer, 'target.layer')
  const tiersRaw = raw.tiers ?? []
  if (!Array.isArray(tiersRaw)) throw new ProfileError('tiers must be a list')
  const tiers = tiersRaw.map((tier, i) => asString(tier, `tiers[${i}]`))
  let name: RegExp | undefined
  if (raw.name !== undefined) {
    try {
      name = new RegExp(asString(raw.name, 'name'))
    } catch {
      throw new ProfileError(`name is not a valid regular expression: ${String(raw.name)}`)
    }
  }
  const rulesRaw = raw.rules ?? []
  if (!Array.isArray(rulesRaw)) throw new ProfileError('rules must be a list')
  const rules = rulesRaw.map((rule, i) => parseRule(rule, i, tiers, warnings))
  const profile: DiagramProfile = { view, target, tiers, rules }
  if (name) profile.name = name
  return profile
}

/**
 * Parse a profile file: one or more YAML documents (`---` separated), each of them is a view.
 * TODO: the regular expression of `name` is run on the main thread for every node. It is acceptable for the bundled
 * profiles, but limit the length of the pattern (and of the names) or use a worker when profiles come from the backend.
 */
export function parseProfiles(text: string): ParsedProfiles {
  const warnings: string[] = []
  const profiles: DiagramProfile[] = []
  for (const doc of parseAllDocuments(text)) {
    const [error] = doc.errors
    if (error) throw new ProfileError(error.message)
    for (const warning of doc.warnings) warnings.push(warning.message)
    const value: unknown = doc.toJS()
    if (value === null || value === undefined) continue // an empty document
    profiles.push(parseProfile(value, warnings))
  }
  return { profiles, warnings }
}

/**
 * Profile to use for a layer: the first profile of the view (the first one if no view is given) whose target
 * accepts the layer. A target without a layer accepts all layers.
 * (`target.network` is not checked here: the profile is loaded for the network being shown.)
 */
export function selectProfile(
  profiles: readonly DiagramProfile[],
  layer: string,
  view?: string,
): DiagramProfile | undefined {
  return profiles.find(
    (profile) =>
      (view === undefined || profile.view === view) &&
      (profile.target.layer === undefined || layer === profile.target.layer),
  )
}
