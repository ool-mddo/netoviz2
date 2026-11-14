import { describe, expect, it } from 'vitest'
import { mddoBgpLayer3 } from '../../../test/mddoBgpLayer3'
import { mddoBgpProfiles } from '../../../test/mddoBgpProfile'
import { layoutSchematic } from './index'

// docs/work/plans/symmetry_layout.md: the symmetries of the layout of mddo-bgp layer3 (emulated_asis).
// Stage 0 measured them: see "段階 0 の結果" of the plan.

async function arrange() {
  const input = mddoBgpLayer3()
  const { profiles, warnings } = await mddoBgpProfiles()
  expect(warnings).toEqual([])
  const positions = await layoutSchematic({ ...input, profile: profiles[0]! })
  const at = (name: string) => positions.get(`layer3/${name}`)!
  return { input, positions, at }
}

/** x of the nodes of the AS from the left, per row (the nodes of the same role are a row), e.g. `{ endpoint: [...] }` */
function rowsOfAs(at: (name: string) => { x: number }, as: string, roles: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(roles).map(([role, names]) => [role, names.map((n) => at(`${as}-${n}`).x)]),
  )
}

describe('mddo-bgp layer3 layout: symmetry', () => {
  it('places every node (the connectors, too)', async () => {
    const { input, positions } = await arrange()
    expect(positions.size).toBe(input.nodes.length)
  })

  it('(1) places the upstream ASes mirror-symmetrically about the center column', async () => {
    const { at } = await arrange()
    // the devices of a row (the same role) of the two ASes are mirror images (as sets: edge01 of one is not the
    // mirror image of edge01 of the other, because the order in a row follows the links)
    const rows = {
      edge: ['edge01', 'edge02'],
      core00: ['core00'],
      core01: ['core01'],
      endpoint: ['endpoint00', 'endpoint01', 'endpoint02', 'endpoint03'],
    }
    for (const names of Object.values(rows)) {
      const left = names.map((n) => at(`as65550-${n}`).x).sort((a, b) => a - b)
      const right = names.map((n) => -at(`as65560-${n}`).x).sort((a, b) => a - b)
      left.forEach((x, i) => expect(x).toBeCloseTo(right[i] ?? NaN, 0))
      expect(at(`as65550-${names[0]}`).y).toBeCloseTo(at(`as65560-${names[0]}`).y, 3)
    }
  })

  it('(1) puts the own AS (the center column) on the axis between the upstream ASes', async () => {
    const { at } = await arrange()
    const xs = ['edge-tk01', 'edge-tk02', 'edge-tk03'].map((n) => at(n).x)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 0)
    expect(at('edge-tk11').x).toBeCloseTo(0, 0)
  })

  it('(3) puts the upstream rows and the downstream rows at the same distances from the own AS (empty tier kept)', async () => {
    const { at } = await arrange()
    const center = at('core-tk01').y
    // the own AS: edge (up) - core - edge (down)
    expect(center - at('edge-tk01').y).toBeCloseTo(at('edge-tk11').y - center, 3)
    // upstream edge / core00 / (core01) / endpoint vs downstream edge / core00 / (empty) / endpoint
    expect(center - at('as65550-edge01').y).toBeCloseTo(at('as65520-edge01').y - center, 3)
    expect(center - at('as65550-core00').y).toBeCloseTo(at('as65520-core00').y - center, 3)
    expect(center - at('as65550-endpoint00').y).toBeCloseTo(at('as65520-endpoint00').y - center, 3)
  })

  it('(2) places the devices of an AS symmetrically about the axis of the AS', async () => {
    const { at } = await arrange()
    for (const as of ['as65550', 'as65560', 'as65520']) {
      const rows = rowsOfAs(at, as, {
        edge: as === 'as65520' ? ['edge01'] : ['edge01', 'edge02'],
        endpoint: ['endpoint00', 'endpoint01', 'endpoint02', 'endpoint03'],
      })
      const axis = at(`${as}-core00`).x
      for (const xs of Object.values(rows)) {
        const center = (Math.min(...xs) + Math.max(...xs)) / 2
        expect(center).toBeCloseTo(axis, 0)
      }
    }
  })
})
