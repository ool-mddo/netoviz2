import type { LayerInfo, NodeData, SupportEdge } from '../api/types'

export type IssueSeverity = 'warn' | 'info'

/** Problems of the supports between layers (to check that the relations between layers are set correctly) */
export type NodeIssueCode =
  /** The layer has a lower layer but the node is not supported by any node (nothing below) */
  | 'unsupported'
  /** The layer has an upper layer but the node does not support any node (nothing above) */
  | 'unused'
export type EdgeIssueCode =
  /** A term-point of the node supports a term-point of the other node but the nodes have no node support */
  | 'tp-only'
  /** The node supports a node in the same layer */
  | 'same-layer'
  /** The supporting node is in a layer which is not lower than the layer of the supported node */
  | 'inverted'
export type LayerIssueCode =
  /** There are supports between the layers but the upper layer does not declare the lower layer */
  | 'undeclared'
  /** The upper layer declares the lower layer but there is no support between their nodes */
  | 'no-support'

export interface Issue<Code extends string> {
  code: Code
  severity: IssueSeverity
  message: string
}

export interface LayerIssue extends Issue<LayerIssueCode> {
  /** upper layer */
  from: string
  /** lower layer */
  to: string
}

export interface SupportPair {
  /** upper node */
  from: string
  /** lower node */
  to: string
  /** The pair is supported at the node level (a support between nodes) */
  byNode: boolean
  /** The pair is derived from supports between term-points of the nodes */
  byTp: boolean
}

export interface SupportReport {
  /** Supports at the node level (node supports and term-point supports rolled up to nodes) */
  pairs: SupportPair[]
  nodeIssues: Map<string, Issue<NodeIssueCode>[]>
  /** Key: `pairKey(from, to)` */
  edgeIssues: Map<string, Issue<EdgeIssueCode>[]>
  layerIssues: LayerIssue[]
}

export function pairKey(from: string, to: string): string {
  return `${from}>${to}`
}

export interface CheckInput {
  /** Layers to check (shown layers). Supports to/from the other layers are not checked */
  layers: readonly LayerInfo[]
  /** Nodes of the layers (all the layers must be loaded) */
  nodes: Readonly<Record<string, readonly Pick<NodeData, 'id' | 'name'>[]>>
  edges: readonly SupportEdge[]
  /** node ID of a term-point ID */
  nodeOfTp: (tpId: string) => string | undefined
}

/** Check the supports between the nodes of the layers */
export function checkSupports(input: CheckInput): SupportReport {
  const layerIds = new Set(input.layers.map((layer) => layer.id))
  const rankOf = new Map(input.layers.map((layer) => [layer.id, layer.rank]))
  const layerOfNode = new Map<string, string>()
  for (const layer of input.layers)
    for (const node of input.nodes[layer.id] ?? []) layerOfNode.set(node.id, layer.id)

  // supports at the node level
  const pairs = new Map<string, SupportPair>()
  const add = (from: string | undefined, to: string | undefined, via: 'byNode' | 'byTp') => {
    if (!from || !to || from === to || !layerOfNode.has(from) || !layerOfNode.has(to)) return
    const key = pairKey(from, to)
    const pair = pairs.get(key) ?? { from, to, byNode: false, byTp: false }
    pair[via] = true
    pairs.set(key, pair)
  }
  for (const edge of input.edges) {
    if (edge.kind === 'node') add(edge.from, edge.to, 'byNode')
    else if (edge.kind === 'tp') add(input.nodeOfTp(edge.from), input.nodeOfTp(edge.to), 'byTp')
  }

  const edgeIssues = new Map<string, Issue<EdgeIssueCode>[]>()
  const addEdgeIssue = (key: string, issue: Issue<EdgeIssueCode>) => {
    const list = edgeIssues.get(key)
    if (list) list.push(issue)
    else edgeIssues.set(key, [issue])
  }
  // layers of the supports (actual) between the shown layers
  const actualLayerPairs = new Set<string>()
  for (const pair of pairs.values()) {
    const key = pairKey(pair.from, pair.to)
    const [lf, lt] = [layerOfNode.get(pair.from) as string, layerOfNode.get(pair.to) as string]
    if (!pair.byNode)
      addEdgeIssue(key, {
        code: 'tp-only',
        severity: 'warn',
        message: 'term-point supports exist but the node support does not',
      })
    if (lf === lt) {
      addEdgeIssue(key, {
        code: 'same-layer',
        severity: 'warn',
        message: 'the supporting node is in the same layer',
      })
      continue
    }
    actualLayerPairs.add(pairKey(lf, lt))
    const [rf, rt] = [rankOf.get(lf), rankOf.get(lt)]
    if (rf != null && rt != null && rf <= rt)
      addEdgeIssue(key, {
        code: 'inverted',
        severity: 'warn',
        message: 'the supporting node is in a layer which is not lower than the supported node',
      })
  }

  // layers: declared and actual supports
  const layerIssues: LayerIssue[] = []
  const declaredLayerPairs = new Set<string>()
  for (const layer of input.layers)
    for (const lower of layer.supports)
      if (layerIds.has(lower)) declaredLayerPairs.add(pairKey(layer.id, lower))
  for (const key of actualLayerPairs) {
    if (declaredLayerPairs.has(key)) continue
    const [from, to] = splitKey(key)
    layerIssues.push({
      code: 'undeclared',
      severity: 'warn',
      from,
      to,
      message: 'supports exist between the layers but the upper layer does not declare the lower layer',
    })
  }
  for (const key of declaredLayerPairs) {
    if (actualLayerPairs.has(key)) continue
    const [from, to] = splitKey(key)
    const hasNodes = (input.nodes[from]?.length ?? 0) > 0 && (input.nodes[to]?.length ?? 0) > 0
    if (!hasNodes) continue
    layerIssues.push({
      code: 'no-support',
      severity: 'info',
      from,
      to,
      message: 'the upper layer declares the lower layer but there is no support between their nodes',
    })
  }

  // nodes: nothing below / nothing above (only in the layers which have a lower/upper layer)
  const hasLower = new Set<string>()
  const hasUpper = new Set<string>()
  for (const key of new Set([...declaredLayerPairs, ...actualLayerPairs])) {
    const [from, to] = splitKey(key)
    hasLower.add(from)
    hasUpper.add(to)
  }
  const supported = new Set<string>()
  const supporting = new Set<string>()
  for (const pair of pairs.values()) {
    supported.add(pair.from)
    supporting.add(pair.to)
  }
  const nodeIssues = new Map<string, Issue<NodeIssueCode>[]>()
  for (const layer of input.layers) {
    for (const node of input.nodes[layer.id] ?? []) {
      const list: Issue<NodeIssueCode>[] = []
      if (hasLower.has(layer.id) && !supported.has(node.id))
        list.push({
          code: 'unsupported',
          severity: 'warn',
          message: 'not supported by any node of the lower layers',
        })
      if (hasUpper.has(layer.id) && !supporting.has(node.id))
        list.push({
          code: 'unused',
          severity: 'info',
          message: 'does not support any node of the upper layers',
        })
      if (list.length > 0) nodeIssues.set(node.id, list)
    }
  }

  return { pairs: [...pairs.values()], nodeIssues, edgeIssues, layerIssues }
}

function splitKey(key: string): [string, string] {
  // layer IDs are URL-encoded: they have no '>' (percent-encoded)
  const i = key.indexOf('>')
  return [key.slice(0, i), key.slice(i + 1)]
}
