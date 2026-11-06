// Types of netomox-exp netoviz2 API (see playground docs/netoviz2_data_format.md)

export type Severity = 'info' | 'warn'

export interface ApiWarning {
  code: string
  severity: Severity
  message: string
  [key: string]: unknown
}

export interface LayerInfo {
  /** Layer ID (URL-encoded network-id) */
  id: string
  /** network-id (for display) */
  name: string
  kind: string | null
  kinds?: string[]
  /** IDs of supporting (lower) layers */
  supports: string[]
  /** 0 is the lowest. null if the layer is in (or depends on) a cycle */
  rank: number | null
  counts: { nodes: number; tps: number; links: number }
}

export interface Summary {
  schema_version: string
  network: string
  snapshot: string
  etag: string
  flags: string[]
  has_diff: boolean
  layers: LayerInfo[]
  warnings: ApiWarning[]
  warnings_total: number
}

/** Diff label (objects without diff do not have it) */
export type DiffLabel = 'added' | 'deleted' | 'changed'

export interface NodeData {
  id: string
  name: string
  kind?: string
  tp_count: number
  diff?: DiffLabel
}

export interface TpData {
  id: string
  /** ID of the node */
  node: string
  name: string
  diff?: DiffLabel
}

export interface LinkData {
  id: string
  name: string
  /** tp ID (null if the endpoint is not found) */
  src: string | null
  dst: string | null
  diff?: DiffLabel
}

export interface LayerData {
  layer: string
  etag: string
  nodes: NodeData[]
  tps: TpData[]
  links: LinkData[]
}

export type SupportKind = 'node' | 'tp' | 'link'

/** `from` is the supported (upper) object, `to` is the supporting (lower) object */
export interface SupportEdge {
  kind: SupportKind
  from: string
  to: string
}

export interface SupportsData {
  etag: string
  supports: SupportEdge[]
}

export type ObjectType = 'layer' | 'node' | 'tp' | 'link'

export interface ObjectAttributes {
  type: ObjectType
  /** { "<attribute key>": {...} } as it is in netomox (empty if the object has no attribute) */
  attributes: Record<string, unknown>
  /** { "supporting-node": [...] } etc. (absent if no support) */
  supporting?: Record<string, unknown[]>
  /** absent if the object is kept (without diff details) */
  diff_state?: { forward?: string; backward?: string | null; pair?: string; diff_data?: unknown[] }
}

export interface AttributesData {
  etag: string
  objects: Record<string, ObjectAttributes>
  not_found: string[]
}

/** Item of GET /topologies/index */
export interface IndexEntry {
  label: string
  network: string
  snapshot: string
  file: string
}

/** A diagram profile file of a network (YAML converted to JSON by the backend; see data format 4.5) */
export interface ProfileFile {
  /** File name without the extension (`?profile=<name>` selects it) */
  name: string
  etag?: string
  /** One value for each document (`---` separated) of the file */
  documents: unknown[]
  /** Error of the file (then `documents` is empty) */
  error?: string
}

export interface ProfilesData {
  network: string
  profiles: ProfileFile[]
}
