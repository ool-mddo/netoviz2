const FULL_TURN = Math.PI * 2

function normalize(angle: number): number {
  const a = angle % FULL_TURN
  return a < 0 ? a + FULL_TURN : a
}

/**
 * How a port is placed (in this order of priority):
 * - pinned: at the given angle (the user put it there); the others keep away from it.
 * - straight: as near as possible to the desired angle (toward the node it is linked to, so that the link is straight),
 *   keeping the gap from the other ports. The ports are moved as little as possible in total.
 * - loose: in a free place nearest to the desired angle, without moving the ports above (e.g. the port of a link which
 *   goes around a node: it must not disturb the ports of straight links).
 */
export type PortKind = 'pinned' | 'straight' | 'loose'

export interface PortSpec {
  desired: number
  kind: PortKind
}

/** Weight of a pinned port in the least squares (it is practically fixed) */
const PINNED_WEIGHT = 1e6
const EPS = 1e-9

/** Weighted isotonic regression (non-decreasing) by pool-adjacent-violators */
function isotonic(values: readonly number[], weights: readonly number[]): number[] {
  const blocks: Array<{ sum: number; weight: number; count: number }> = []
  values.forEach((value, i) => {
    const weight = weights[i] ?? 1
    blocks.push({ sum: value * weight, weight, count: 1 })
    while (blocks.length > 1) {
      const [a, b] = [blocks[blocks.length - 2]!, blocks[blocks.length - 1]!]
      if (a.sum / a.weight <= b.sum / b.weight) break
      blocks.splice(blocks.length - 2, 2, {
        sum: a.sum + b.sum,
        weight: a.weight + b.weight,
        count: a.count + b.count,
      })
    }
  })
  return blocks.flatMap((block) => new Array<number>(block.count).fill(block.sum / block.weight))
}

/**
 * Angles of the ports which keep `minGap` between the neighbors around the circle and are the nearest to the desired
 * angles (the sum of the squares of the movements, weighted): the least squares with the order kept. A circle is
 * cut at a place where the ports are not pushed against each other, and then it is a line (isotonic regression of the
 * angles minus the gaps). Returns the angles in the order of the input, or undefined if there is no room.
 */
function leastSquaresAngles(
  desired: readonly number[],
  weights: readonly number[],
  minGap: number,
): number[] | undefined {
  const count = desired.length
  if (count === 0) return []
  if (count === 1) return [desired[0] ?? 0]
  if (count * minGap > FULL_TURN + EPS) return undefined
  const order = desired.map((angle, i) => ({ i, angle: normalize(angle) })).sort((a, b) => a.angle - b.angle)
  // cut at a place after a big gap first (the solutions of the other cuts are tried when it does not fit)
  const gapBefore = order.map((item, k) => {
    const previous = order[(k + count - 1) % count]!
    return item.angle - previous.angle + (k === 0 ? FULL_TURN : 0)
  })
  const cuts = gapBefore
    .map((gap, k) => ({ gap, k }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, count <= 24 ? count : 12)
    .map((c) => c.k)

  let best: { cost: number; angles: number[] } | undefined
  for (const cut of cuts) {
    const unrolled = order.map((_, j) => {
      const item = order[(cut + j) % count]!
      return { ...item, angle: item.angle + (cut + j >= count ? FULL_TURN : 0) }
    })
    const shifted = unrolled.map((item, j) => item.angle - j * minGap)
    const fitted = isotonic(
      shifted,
      unrolled.map((item) => weights[item.i] ?? 1),
    ).map((value, j) => value + j * minGap)
    const first = fitted[0] ?? 0
    const last = fitted[count - 1] ?? 0
    if (last + minGap > first + FULL_TURN + EPS) continue // it does not fit around the circle with this cut
    const cost = fitted.reduce(
      (sum, value, j) => sum + (weights[unrolled[j]!.i] ?? 1) * (value - unrolled[j]!.angle) ** 2,
      0,
    )
    if (!best || cost < best.cost) {
      const angles = new Array<number>(count).fill(0)
      unrolled.forEach((item, j) => (angles[item.i] = fitted[j] ?? 0))
      best = { cost, angles }
    }
  }
  return best?.angles
}

/** Distance between two angles (0..PI) */
function angularDistance(a: number, b: number): number {
  const d = Math.abs(normalize(a - b))
  return Math.min(d, FULL_TURN - d)
}

/**
 * Angles of the ports around a node, by the priority of the kinds (see PortKind): the pinned and straight ports are
 * placed first, as near as possible to their desired angles with the gaps kept; then each loose port is put in the free
 * place nearest to its desired angle, without moving the others.
 * @param minGap Minimum angular gap between neighboring ports in radian
 * @returns Angles in the same order as `ports`
 */
export function placeAngles(ports: readonly PortSpec[], minGap: number): number[] {
  const count = ports.length
  if (count === 0) return []
  if (count === 1) return [ports[0]?.desired ?? 0]

  const solved = (indexes: number[]): number[] | undefined =>
    leastSquaresAngles(
      indexes.map((i) => ports[i]?.desired ?? 0),
      indexes.map((i) => (ports[i]?.kind === 'pinned' ? PINNED_WEIGHT : 1)),
      minGap,
    )
  const all = ports.map((_, i) => i)
  const result: number[] = new Array<number>(count).fill(0)
  const equalIntervals = () => {
    // no room: put them at regular intervals, from the first port (in the order of the desired angles)
    const order = all.sort((a, b) => normalize(ports[a]?.desired ?? 0) - normalize(ports[b]?.desired ?? 0))
    const start = normalize(ports[order[0] ?? 0]?.desired ?? 0)
    order.forEach((index, k) => (result[index] = start + (k * FULL_TURN) / count))
    return result
  }

  const fixed = all.filter((i) => ports[i]?.kind !== 'loose')
  const loose = all.filter((i) => ports[i]?.kind === 'loose')
  const fixedAngles = solved(fixed)
  if (fixedAngles === undefined) return equalIntervals()
  fixed.forEach((index, k) => (result[index] = fixedAngles[k] ?? 0))

  const placed = [...fixedAngles]
  for (const index of loose.sort(
    (a, b) => normalize(ports[a]?.desired ?? 0) - normalize(ports[b]?.desired ?? 0),
  )) {
    const wanted = ports[index]?.desired ?? 0
    const candidates = [wanted, ...placed.flatMap((a) => [a + minGap, a - minGap])]
    const free = candidates.filter((c) => placed.every((a) => angularDistance(a, c) >= minGap - 1e-7))
    const nearest = free.sort((a, b) => angularDistance(a, wanted) - angularDistance(b, wanted))[0]
    if (nearest === undefined) {
      // no free place (it is tight): all the ports are placed together
      const together = leastSquaresAngles(
        all.map((i) => ports[i]?.desired ?? 0),
        all.map((i) => (ports[i]?.kind === 'pinned' ? PINNED_WEIGHT : 1)),
        minGap,
      )
      if (together === undefined) return equalIntervals()
      return together
    }
    result[index] = nearest
    placed.push(nearest)
  }
  return result
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
  return placeAngles(
    desired.map((angle) => ({ desired: angle, kind: 'straight' as const })),
    minGap,
  )
}

/** Radius of a node to have `portCount` ports with the arc length `arc` on its circle (not less than `base`) */
export function radiusForPorts(base: number, portCount: number, arc: number): number {
  return Math.max(base, (portCount * arc) / FULL_TURN)
}
