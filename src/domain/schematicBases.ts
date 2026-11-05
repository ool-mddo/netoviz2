import type { LayerData, LayerInfo } from '../api/types'
import { lowerClosure, lowerLayersOf, lowerNodesIn } from '../render/layout/schematic/inherit'
import type { SchematicBase } from '../render/layout/schematic/types'
import type { SupportIndex } from './supportIndex'

/** Radius of the nodes of a base layer (only the order of its nodes is used: it is not shown) */
const BASE_RADIUS = 11

/** Links between nodes of a layer (a link is between term-points: the nodes of the term-points; no duplicates) */
export function nodeLinksOf(data: LayerData): Array<{ source: string; target: string }> {
  const nodeOf = new Map(data.tps.map((tp) => [tp.id, tp.node]))
  const seen = new Set<string>()
  const links: Array<{ source: string; target: string }> = []
  for (const link of data.links) {
    const source = link.src === null ? undefined : nodeOf.get(link.src)
    const target = link.dst === null ? undefined : nodeOf.get(link.dst)
    if (source === undefined || target === undefined || source === target) continue
    const key = source < target ? `${source}\n${target}` : `${target}\n${source}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ source, target })
  }
  return links
}

/** Layers which the nodes of a layer reach by the node supports, from the lowest (the candidates of the base layer) */
export function lowerLayerIdsOf(
  layer: LayerData,
  layers: readonly LayerInfo[],
  index: SupportIndex,
): string[] {
  const closure = lowerClosure(
    index,
    layer.nodes.map((node) => node.id),
  )
  const rankOf = new Map(layers.map((info) => [info.id, info.rank ?? Number.POSITIVE_INFINITY]))
  return lowerLayersOf(
    closure,
    layers.map((info) => info.id),
  ).sort((a, b) => (rankOf.get(a) ?? 0) - (rankOf.get(b) ?? 0) || a.localeCompare(b, 'en', { numeric: true }))
}

/**
 * Bases to inherit the arrangement from for a layer: the lower layers (the lowest first) which the layer reaches by
 * the supports, whose data are loaded.
 */
export function schematicBasesOf(
  layerId: string,
  data: Readonly<Record<string, LayerData | undefined>>,
  layers: readonly LayerInfo[],
  index: SupportIndex,
): SchematicBase[] {
  const layer = data[layerId]
  if (!layer) return []
  const layerIds = layers.map((info) => info.id)
  const closure = lowerClosure(
    index,
    layer.nodes.map((node) => node.id),
  )
  return lowerLayerIdsOf(layer, layers, index).flatMap((baseId) => {
    const base = data[baseId]
    if (!base) return []
    return [
      {
        layer: baseId,
        nodes: base.nodes.map((node) => ({
          id: node.id,
          name: node.name,
          radius: BASE_RADIUS,
          ...(node.kind === undefined ? {} : { kind: node.kind }),
        })),
        links: nodeLinksOf(base),
        lowerOf: lowerNodesIn(closure, baseId, layerIds),
      },
    ]
  })
}
