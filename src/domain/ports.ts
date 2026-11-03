const FULL_TURN = Math.PI * 2

function normalize(angle: number): number {
  const a = angle % FULL_TURN
  return a < 0 ? a + FULL_TURN : a
}

/**
 * Angles of the ports around a node: each port is put as near as possible to its desired angle
 * (toward the node it is connected to), keeping the angular gap between the ports at least `minGap`.
 * The order of the ports around the node follows the desired angles (so that links do not cross near the node).
 * @param desired Desired angle of each port in radian
 * @param minGap Minimum angular gap between neighboring ports in radian
 * @returns Angles in the same order as `desired`
 */
export function spreadAngles(desired: readonly number[], minGap: number): number[] {
  const count = desired.length
  if (count === 0) return []
  const order = desired.map((angle, i) => ({ i, angle: normalize(angle) })).sort((a, b) => a.angle - b.angle)
  const angles = order.map((item) => item.angle)
  if (count === 1) return [desired[0] ?? 0]

  if (count * minGap >= FULL_TURN) {
    // no room: put them at regular intervals, from the first port
    const start = angles[0] ?? 0
    angles.forEach((_, k) => (angles[k] = start + (k * FULL_TURN) / count))
  } else {
    // push the neighbors which are too near each other apart, until all gaps are enough
    for (let pass = 0; pass < 200; pass++) {
      let moved = false
      for (let k = 0; k < count; k++) {
        const next = (k + 1) % count
        const gap = (angles[next] ?? 0) + (next === 0 ? FULL_TURN : 0) - (angles[k] ?? 0)
        if (gap < minGap - 1e-9) {
          const push = (minGap - gap) / 2
          angles[k] = (angles[k] ?? 0) - push
          angles[next] = (angles[next] ?? 0) + push
          moved = true
        }
      }
      if (!moved) break
    }
  }
  const result: number[] = new Array<number>(count).fill(0)
  order.forEach((item, k) => (result[item.i] = angles[k] ?? 0))
  return result
}

/** Radius of a node to have `portCount` ports with the arc length `arc` on its circle (not less than `base`) */
export function radiusForPorts(base: number, portCount: number, arc: number): number {
  return Math.max(base, (portCount * arc) / FULL_TURN)
}
