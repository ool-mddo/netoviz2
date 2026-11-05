/**
 * Shape of node names, for the inference of the diagram profile: a name is split by the separators (`-`, `_`) and by
 * the borders of letters and digits into tokens (`site-a-seg1` -> site, a, seg, 1; `regiona-ce01` -> regiona, ce, 01).
 * The most common shape (the kinds of the tokens and the separators) is the shape of the names of a layer.
 */
export type TokenKind = 'alpha' | 'digits' | 'other'

export interface Token {
  text: string
  kind: TokenKind
}

export interface Tokenized {
  tokens: Token[]
  /** `seps[i]` is the separator before `tokens[i]`: '-', '_' or '' (letters and digits of a part) */
  seps: string[]
}

const TOKEN = /[A-Za-z]+|[0-9]+|[^A-Za-z0-9_-]+/g

export function tokenize(name: string): Tokenized {
  const tokens: Token[] = []
  const seps: string[] = []
  name.split(/([-_])/).reduce<string>((sep, part) => {
    if (part === '-' || part === '_') return part
    let first = true
    for (const text of part.match(TOKEN) ?? []) {
      tokens.push({ text, kind: /^[A-Za-z]/.test(text) ? 'alpha' : /^[0-9]/.test(text) ? 'digits' : 'other' })
      seps.push(first ? sep : '')
      first = false
    }
    return ''
  }, '')
  return { tokens, seps }
}

export interface NameShape {
  kinds: TokenKind[]
  /** Separators before the tokens (the one before digits is not distinguished: `seg1` and `seg-1` have the same shape) */
  seps: string[]
}

function shapeOf({ tokens, seps }: Tokenized): NameShape {
  const kinds = tokens.map((t) => t.kind)
  return { kinds, seps: seps.map((sep, i) => (kinds[i] === 'digits' ? '*' : sep)) }
}

const keyOf = (shape: NameShape) => shape.kinds.map((k, i) => `${shape.seps[i] ?? ''}${k}`).join('|')

export interface ShapedNames {
  shape: NameShape
  /** Tokens of the names which have the shape, by the names */
  tokens: Map<string, Token[]>
  /** Names which do not have the shape (unusual names) */
  mismatched: string[]
}

/** @returns the most common shape of the names (the first one by the key if the counts are the same) */
export function dominantShape(names: readonly string[]): ShapedNames | undefined {
  const groups = new Map<string, { shape: NameShape; names: Array<[string, Tokenized]> }>()
  for (const name of names) {
    const tokenized = tokenize(name)
    if (tokenized.tokens.length === 0) continue
    const shape = shapeOf(tokenized)
    const key = keyOf(shape)
    const group = groups.get(key) ?? { shape, names: [] }
    group.names.push([name, tokenized])
    groups.set(key, group)
  }
  const best = [...groups]
    .sort(([ka, a], [kb, b]) => b.names.length - a.names.length || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .at(0)?.[1]
  if (!best) return undefined
  const matched = new Set(best.names.map(([name]) => name))
  return {
    shape: best.shape,
    tokens: new Map(best.names.map(([name, t]) => [name, t.tokens])),
    mismatched: names.filter((name) => !matched.has(name)),
  }
}

/**
 * Regular expression (source) which matches the names of the shape, with a named group for the tokens which have
 * a name (the others are matched without capturing).
 * @param groupName name of the group of the token at the position (undefined: not captured)
 */
export function regexSourceOf(shape: NameShape, groupName: (position: number) => string | undefined): string {
  const parts = shape.kinds.map((kind, i) => {
    const sep = shape.seps[i] ?? ''
    const prefix = sep === '*' ? '[-_]?' : sep // a separator is '-' or '_': it needs no escape
    const body = kind === 'alpha' ? '[A-Za-z]+' : kind === 'digits' ? '[0-9]+' : '[^A-Za-z0-9_-]+'
    const name = groupName(i)
    return `${prefix}(${name === undefined ? '?:' : `?<${name}>`}${body})`
  })
  return `^${parts.join('')}$`
}
