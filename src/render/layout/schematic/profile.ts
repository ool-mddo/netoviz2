import type { DiagramProfile, ProfileRule, Selector } from './types'

export interface ParsedProfiles {
  profiles: DiagramProfile[]
  /** Problems which do not prevent using the profiles (e.g. unknown keys) */
  warnings: string[]
}

export class ProfileError extends Error {}

// Unknown keys (e.g. the keys of the design which are not supported yet) are ignored with a warning: a typo in
// `target` would widen the layers the profile is applied to, so it is checked as well.
const KNOWN_TOP_KEYS = new Set(['view', 'target', 'tiers', 'name', 'inherit', 'rules'])
const KNOWN_TARGET_KEYS = new Set(['network', 'snapshot', 'layer'])
const KNOWN_RULE_KEYS = new Set(['select', 'tier', 'group', 'order', 'pair'])
const KNOWN_GROUP_KEYS = new Set(['value'])
const KNOWN_PAIR_KEYS = new Set(['by', 'primary'])
const KNOWN_INHERIT_KEYS = new Set(['from', 'via'])

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

/** A string which must be quoted in the YAML file (e.g. `'01'`: an unquoted 01 is read as the number 1 and does not match) */
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
  if (raw.group !== undefined) {
    if (typeof raw.group === 'object' && raw.group !== null && !Array.isArray(raw.group)) {
      // `group: { value: <literal> }`: a group value which is not captured from the name
      const group = raw.group as Record<string, unknown>
      warnUnknownKeys(group, KNOWN_GROUP_KEYS, `${where}.group: `, warnings)
      const value = asQuotedString(group.value, `${where}.group.value`)
      if (value === '') throw new ProfileError(`${where}.group.value must not be empty`)
      rule.groupValue = value
    } else {
      rule.group = asString(raw.group, `${where}.group`)
    }
  }
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

/**
 * Parse a profile: a JSON value (a document of the profile file, converted from YAML by the backend).
 * @throws ProfileError if it is not valid
 */
export function parseProfile(value: unknown, warnings: string[]): DiagramProfile {
  const raw = asRecord(value, 'profile')
  warnUnknownKeys(raw, KNOWN_TOP_KEYS, '', warnings)
  const view = asString(raw.view, 'view')
  const targetRaw = raw.target === undefined ? {} : asRecord(raw.target, 'target')
  warnUnknownKeys(targetRaw, KNOWN_TARGET_KEYS, 'target: ', warnings)
  const target: DiagramProfile['target'] = {}
  if (targetRaw.network !== undefined) target.network = asString(targetRaw.network, 'target.network')
  if (targetRaw.snapshot !== undefined) {
    const pattern = asString(targetRaw.snapshot, 'target.snapshot')
    try {
      target.snapshot = new RegExp(`^(?:${pattern})$`) // the whole name
    } catch {
      throw new ProfileError(`target.snapshot is not a valid regular expression: ${pattern}`)
    }
  }
  if (targetRaw.layer !== undefined) target.layer = asString(targetRaw.layer, 'target.layer')
  let inherit: DiagramProfile['inherit']
  if (raw.inherit !== undefined) {
    const inheritRaw = asRecord(raw.inherit, 'inherit')
    warnUnknownKeys(inheritRaw, KNOWN_INHERIT_KEYS, 'inherit: ', warnings)
    if (inheritRaw.via !== undefined && inheritRaw.via !== 'supports') {
      warnings.push(`inherit: via '${String(inheritRaw.via)}' is not supported (only supports)`)
    }
    inherit = { from: asString(inheritRaw.from, 'inherit.from') }
  }
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
  if (inherit) profile.inherit = inherit
  if (name) profile.name = name
  return profile
}

/**
 * Parse the documents of a profile file (each of them is a view): the values which the backend gives (`documents`).
 * TODO: the regular expression of `name` is run on the main thread for every node. It is acceptable for the profiles
 * managed in git, but limit the length of the pattern (and of the names) or use a worker for profiles from elsewhere.
 */
export function parseProfileDocuments(documents: readonly unknown[]): ParsedProfiles {
  const warnings: string[] = []
  const profiles: DiagramProfile[] = []
  for (const value of documents) {
    if (value === null || value === undefined) continue // an empty document
    profiles.push(parseProfile(value, warnings))
  }
  return { profiles, warnings }
}

/** Where the profiles are used: the network and the snapshot being shown (the snapshot may be unknown) */
export interface ProfileScope {
  network: string
  snapshot?: string
}

/** Whether the target of the profile accepts the network / snapshot (an omitted item accepts anything) */
export function profileInScope(profile: DiagramProfile, scope: ProfileScope): boolean {
  const { network, snapshot } = profile.target
  if (network !== undefined && network !== scope.network) return false
  if (snapshot !== undefined && scope.snapshot !== undefined && !snapshot.test(scope.snapshot)) return false
  return true
}

/**
 * Profile to use for a layer: the first profile of the view (the first one if no view is given) whose target
 * accepts the layer. A target without a layer accepts all layers.
 * (`target.network` and `target.snapshot` are not checked here: see `profileInScope`.)
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
