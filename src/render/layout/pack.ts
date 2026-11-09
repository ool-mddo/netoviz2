import type { Position } from './types'

export interface Box {
  key: string
  width: number
  height: number
}

/**
 * Put boxes (the layouts of layers) in a grid without overlap.
 * @param columns number of the columns (default: ceil(sqrt(n)), nearly square)
 * @param align 'center' puts each box at the center of its column (default: 'start', left aligned)
 * @returns the position of the top-left corner of each box
 */
export function packBoxes(
  boxes: readonly Box[],
  gap: number,
  columns?: number,
  align: 'start' | 'center' = 'start',
): Map<string, Position> {
  columns = Math.max(1, columns ?? Math.ceil(Math.sqrt(boxes.length)))
  const rows = Math.ceil(boxes.length / columns)
  const columnWidths = Array.from({ length: columns }, (_, c) =>
    Math.max(0, ...boxes.filter((_, i) => i % columns === c).map((b) => b.width)),
  )
  const rowHeights = Array.from({ length: rows }, (_, r) =>
    Math.max(0, ...boxes.filter((_, i) => Math.floor(i / columns) === r).map((b) => b.height)),
  )
  const result = new Map<string, Position>()
  boxes.forEach((box, i) => {
    const [column, row] = [i % columns, Math.floor(i / columns)]
    const left = columnWidths.slice(0, column).reduce((sum, w) => sum + w + gap, 0)
    const x = align === 'center' ? left + ((columnWidths[column] ?? 0) - box.width) / 2 : left
    const y = rowHeights.slice(0, row).reduce((sum, h) => sum + h + gap, 0)
    result.set(box.key, { x, y })
  })
  return result
}
