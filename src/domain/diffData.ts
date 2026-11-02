/**
 * Diff data of an attribute (`_diff_state_.diff_data`): list of `[sign, path, value...]` (hashdiff style)
 *   changed: ['~', 'metric', 1, 9]   added: ['+', 'neighbor[1]', {...}]   deleted: ['-', 'neighbor[0]', {...}]
 * `path` is joined by `.` for keys and `[i]` for array indexes (e.g. `timer.dead-interval`, `neighbor[0]`).
 */
export interface DiffEntry {
  sign: '+' | '-' | '~'
  path: string
  /** deleted / changed */
  before?: unknown
  /** added / changed */
  after?: unknown
}

export function parseDiffData(raw: unknown): DiffEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: DiffEntry[] = []
  for (const item of raw) {
    if (!Array.isArray(item) || typeof item[1] !== 'string') continue
    const [sign, path, first, second] = item as [unknown, string, unknown, unknown]
    if (sign === '+') entries.push({ sign, path, after: first })
    else if (sign === '-') entries.push({ sign, path, before: first })
    else if (sign === '~') entries.push({ sign, path, before: first, after: second })
  }
  return entries
}

/** Path of a child in the same style as diff data */
export function childPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`
  return parent === '' ? key : `${parent}.${key}`
}

/** Diff state in the data of netomox (`_diff_state_`) */
export interface RawDiffState {
  forward?: string | null
  backward?: string | null
  pair?: string
  diff_data?: unknown
}

export function isDiffState(value: unknown): value is RawDiffState {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    ('forward' in value || 'backward' in value)
  )
}

/** `kept` states are in all data (even if the topology is not a diff), so they are meaningless to show */
export function isMeaningfulDiffState(state: RawDiffState): boolean {
  const hasData = Array.isArray(state.diff_data) && state.diff_data.length > 0
  return hasData || (state.forward ?? 'kept') !== 'kept' || state.backward === 'changed'
}
