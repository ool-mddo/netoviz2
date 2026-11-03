import { DEFAULT_LAYOUT_ENGINE, LAYOUT_ENGINES, type LayoutEngine } from '../render/layout/types'

/**
 * Kinds of the view shown in a panel:
 * the layout engines of the topology graph (force, stress) and the layer bands (dependency) to check the supports.
 */
export type ViewKind = LayoutEngine | 'dependency'

export const VIEW_KINDS: ReadonlyArray<{ id: ViewKind; label: string }> = [
  ...LAYOUT_ENGINES,
  { id: 'dependency', label: 'dependency (layer bands)' },
]

/** View kind used when it is not specified */
export const DEFAULT_VIEW_KIND: ViewKind = DEFAULT_LAYOUT_ENGINE

/** @returns the kind if the value is a valid one (e.g. a value of the URL query), otherwise undefined */
export function parseViewKind(value: unknown): ViewKind | undefined {
  return VIEW_KINDS.find((kind) => kind.id === value)?.id
}

/** @returns the layout engine if the view kind is drawn by the graph renderer (not the layer bands) */
export function engineOf(kind: ViewKind): LayoutEngine | undefined {
  return kind === 'dependency' ? undefined : kind
}
