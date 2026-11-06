import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FLOWER_IDS, normalize } from '../../../shared/diary'
import { findSoil } from './Droplets'
import { buildPlaceholder } from './placeholder'
import { bindRig, poseRig } from './rig'
import { FLOWER_SPECS } from './specs'

// Autorig v3 (spikes and clumps): branch_N_K chains and bloom_N flowers.

/** A small clump in the contract's shape: a trunk, a two-bone branch leaning
 * out to screen right with a flower on its end, a one-bone leaf to the left,
 * and a second flower higher up the trunk. Bones point along their +Y. */
function clump() {
  const root = new THREE.Group()
  const stem = new THREE.Group()
  stem.name = 'stem_0'
  root.add(stem)
  const aim = (o: THREE.Object3D, dir: THREE.Vector3) => o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  const b0 = new THREE.Group()
  b0.name = 'branch_0_0'
  b0.position.set(0, 0.1, 0)
  aim(b0, new THREE.Vector3(1, 1, 0))
  stem.add(b0)
  const b1 = new THREE.Group()
  b1.name = 'branch_0_1'
  b1.position.set(0, 0.5, 0)
  b0.add(b1)
  const low = new THREE.Group()
  low.name = 'bloom_0'
  low.position.set(0, 0.4, 0)
  b1.add(low)
  const leaf = new THREE.Group()
  leaf.name = 'branch_1_0'
  leaf.position.set(0, 0.2, 0)
  aim(leaf, new THREE.Vector3(-1, 0.3, 0))
  stem.add(leaf)
  const high = new THREE.Group()
  high.name = 'bloom_1'
  high.position.set(0, 1.6, 0)
  stem.add(high)
  return root
}

const tipOf = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false)
  return new THREE.Vector3(0, 0.5, 0).applyMatrix4(o.matrixWorld)
}

describe('autorig v3 contract', () => {
  it('finds branch chains and blooms', () => {
    const rig = bindRig(clump())
    expect(rig.branches.map((b) => b.bones.map((x) => x.node.name))).toEqual([['branch_0_0', 'branch_0_1'], ['branch_1_0']])
    expect(rig.blooms.map((b) => b.node.name)).toEqual(['bloom_0', 'bloom_1'])
    expect(rig.blooms.map((b) => b.onBranch)).toEqual([true, false])
    // Ranked by height: the flower up the trunk is higher than the one out on the branch.
    expect(rig.blooms[1].rank).toBeGreaterThan(rig.blooms[0].rank)
    // Out: the branch leans to screen right, the leaf to the left.
    expect(rig.branches[0].out.x).toBeGreaterThan(0.9)
    expect(rig.branches[1].out.x).toBeLessThan(-0.9)
  })

  for (const id of ['blossom', 'chrysanthemum', 'shrub', 'iris', 'lily', 'jasmine'] as const) {
    const spec = FLOWER_SPECS[id]
    // Open size: the spec's, of the model's, whatever the branch it rides on is scaled to.
    const full = (b: { onBranch: boolean }) => (spec.wilt.bloom?.size ?? 1) / (b.onBranch ? spec.wilt.branch?.scale ?? 1 : 1)
    describe(id, () => {
      it('rests exactly on the model when full grown and fresh', () => {
        const rig = bindRig(clump())
        poseRig(rig, spec.wilt, { stem: 0, head: 0, petals: 0, growth: 1 })
        for (const b of rig.branches) for (const x of b.bones) expect(x.node.quaternion.angleTo(x.rest)).toBeLessThan(1e-6)
        for (const b of rig.branches) expect(b.bones[0].node.scale.x).toBeCloseTo(spec.wilt.branch?.scale ?? 1)
        for (const b of rig.blooms) {
          expect(b.node.quaternion.angleTo(b.rest)).toBeLessThan(1e-6)
          expect(b.node.scale.x).toBeCloseTo(full(b))
          expect(b.node.scale.y).toBeCloseTo(full(b))
        }
      })

      it('grows sprout → bud → bloom', () => {
        const rig = bindRig(clump())
        const at = (growth: number) => {
          poseRig(rig, spec.wilt, { stem: 0, head: 0, petals: 0, growth })
          return rig.blooms.map((b) => ({ across: b.node.scale.x, along: b.node.scale.y }))
        }
        // A sprout has no flowers yet.
        for (const b of at(0)) expect(b.along).toBeLessThan(0.01)
        // Each flower is a visible shut bud (narrower than long) at some
        // point on the way, before it opens.
        const steps = Array.from({ length: 101 }, (_, i) => at(i / 100))
        rig.blooms.forEach((b, k) => {
          const budAt = steps.findIndex((s) => s[k].along > 0.25 && s[k].across < 0.9 * s[k].along)
          const openAt = steps.findIndex((s) => s[k].across > 0.99 * full(b))
          expect(budAt).toBeGreaterThan(0)
          expect(openAt).toBeGreaterThan(budAt)
        })
        // Every flower is open by the goal.
        const bl = spec.wilt.bloom!
        expect(bl.from + bl.stagger + bl.span).toBeLessThanOrEqual(1)
      })

      it('furls its branches up while young and unfurls them', () => {
        const rig = bindRig(clump())
        const branch = rig.branches[0].bones[0].node
        const up = new THREE.Vector3(0, 1, 0)
        const lean = () => {
          branch.updateWorldMatrix(true, false)
          return new THREE.Vector3(0, 1, 0).applyQuaternion(branch.getWorldQuaternion(new THREE.Quaternion())).angleTo(up)
        }
        poseRig(rig, spec.wilt, { stem: 0, head: 0, petals: 0, growth: 0 })
        const young = lean()
        poseRig(rig, spec.wilt, { stem: 0, head: 0, petals: 0, growth: 1 })
        const grown = lean()
        expect(young).toBeLessThan(grown - 0.1)
        expect(young).toBeGreaterThan(0)
      })

      it('bows its branches down and nods its flowers when thirsty', () => {
        const rig = bindRig(clump())
        const pose = (w: number) => {
          poseRig(rig, spec.wilt, { stem: w, head: w, petals: w, growth: 1 })
          rig.root.updateMatrixWorld(true)
          // Relative to the stem, which bends too.
          const tip = rig.stems[0].node.worldToLocal(tipOf(rig.branches[0].bones[1].node))
          return { tip: tip.y, size: rig.blooms[0].node.scale.x }
        }
        const fresh = pose(0)
        const wilted = pose(1)
        expect(wilted.tip).toBeLessThan(fresh.tip - 0.01)
        expect(wilted.size).toBeLessThan(fresh.size)
        expect(rig.blooms[0].node.quaternion.angleTo(rig.blooms[0].rest)).toBeGreaterThan(0.1)
      })
    })
  }

  it('opens a spike from the bottom up', () => {
    const spec = FLOWER_SPECS.blossom
    expect(spec.wilt.bloom?.up).toBe(true)
    const rig = bindRig(clump())
    const bl = spec.wilt.bloom!
    poseRig(rig, spec.wilt, { stem: 0, head: 0, petals: 0, growth: bl.from + bl.span * 0.8 })
    const [lower, higher] = rig.blooms
    expect(lower.node.scale.x).toBeGreaterThan(higher.node.scale.x)
  })
})

describe('every flower type', () => {
  it('has a spec, a label and a working stand-in', () => {
    for (const id of FLOWER_IDS) {
      expect(FLOWER_SPECS[id].id).toBe(id)
      const rig = bindRig(buildPlaceholder(FLOWER_SPECS[id]))
      expect(rig.stems.length).toBeGreaterThan(0)
      expect(() => poseRig(rig, FLOWER_SPECS[id].wilt, { stem: 0.5, head: 0.5, petals: 0.5, growth: 0.5 })).not.toThrow()
    }
  })

  it('plants the iris on the ground, with no pot', () => {
    expect(FLOWER_SPECS.iris.pot).toBeNull()
    const root = buildPlaceholder(FLOWER_SPECS.iris)
    expect(root.getObjectByName('pot')).toBeUndefined()
    expect(findSoil(root).y).toBe(0)
    // The others keep the app's basin.
    expect(buildPlaceholder(FLOWER_SPECS.lily).getObjectByName('pot')).toBeDefined()
  })

  it('keeps a saved choice of any type, and turns unknown ones into a lotus', () => {
    for (const id of FLOWER_IDS) expect(normalize({ plant: { flower: id } }, 1).plant.flower).toBe(id)
    expect(normalize({ plant: { flower: 'tulip' } }, 1).plant.flower).toBe('lotus')
  })
})
