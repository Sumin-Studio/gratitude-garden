import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildPlaceholder } from './placeholder'
import { bindRig, poseRig, stage } from './rig'
import { FLOWER_SPECS } from './specs'

const lotus = FLOWER_SPECS.lotus

describe('bindRig on the placeholder', () => {
  it('finds every contract node', () => {
    const rig = bindRig(buildPlaceholder(lotus))
    expect(rig.stems.map((s) => s.node.name)).toEqual(['stem_0', 'stem_1', 'stem_2', 'stem_3', 'stem_4', 'stem_5'])
    expect(rig.head?.node.name).toBe('head')
    expect(rig.petals).toHaveLength(14)
    expect(rig.leaves).toHaveLength(2)
    // Pot and soil are never tinted.
    expect(rig.tint.map((t) => t.mat.name).sort()).toEqual(['core', 'petal', 'plant'])
  })

  it('returns to the exact rest pose at zero wilt', () => {
    const root = buildPlaceholder(lotus)
    const rig = bindRig(root)
    const rest = rig.stems.map((s) => s.node.quaternion.clone())
    poseRig(rig, lotus.wilt, { stem: 1, head: 1, petals: 1 })
    expect(rig.stems[5].node.quaternion.angleTo(rest[5])).toBeGreaterThan(0.1)
    poseRig(rig, lotus.wilt, { stem: 0, head: 0, petals: 0 })
    rig.stems.forEach((s, i) => expect(s.node.quaternion.angleTo(rest[i])).toBeLessThan(1e-6))
  })

  it('bends more as it gets thirstier', () => {
    const rig = bindRig(buildPlaceholder(lotus))
    const tip = () => {
      rig.root.updateMatrixWorld(true)
      return rig.head!.node.getWorldPosition(new THREE.Vector3())
    }
    const xs = [0, 0.4, 0.7, 1].map((w) => {
      poseRig(rig, lotus.wilt, { stem: w, head: w, petals: w })
      return tip()
    })
    // Head moves left and down monotonically.
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i].x).toBeLessThan(xs[i - 1].x)
      expect(xs[i].y).toBeLessThan(xs[i - 1].y)
    }
  })
})

describe('bindRig on GLB-style graphs', () => {
  it('matches loose names, takes the outermost node, resamples stem count', () => {
    const root = new THREE.Group()
    let parent: THREE.Object3D = root
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Group()
      s.name = `Stem_${i}`
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
      mesh.name = `stem_${i}` // same name nested: must be ignored
      s.add(mesh)
      parent.add(s)
      parent = s
    }
    const head = new THREE.Group()
    head.name = 'Head'
    const petal = new THREE.Group()
    petal.name = 'petal_left_front'
    const petalMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    petalMesh.name = 'petal_left_front_mesh'
    petal.add(petalMesh)
    head.add(petal)
    parent.add(head)

    const rig = bindRig(root)
    expect(rig.stems).toHaveLength(3)
    expect(rig.stems.every((s) => s.node.name.startsWith('Stem'))).toBe(true)
    expect(rig.head?.node).toBe(head)
    expect(rig.petals.map((p) => p.node)).toEqual([petal])

    // Six spec segments squeezed onto three: total bend is preserved.
    poseRig(rig, lotus.wilt, { stem: 1, head: 0, petals: 0 })
    const total = rig.stems.reduce((a, s) => a + 2 * Math.acos(Math.min(1, Math.abs(s.node.quaternion.w))), 0)
    const expected = THREE.MathUtils.degToRad(lotus.wilt.stemBend.reduce((a: number, b: number) => a + b, 0))
    expect(total).toBeCloseTo(expected, 3)
  })

  it('drives a `wilt` morph target', () => {
    const geo = new THREE.BoxGeometry()
    geo.morphAttributes.position = [geo.attributes.position.clone()]
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial())
    mesh.morphTargetDictionary = { wilt: 0 }
    mesh.morphTargetInfluences = [0]
    const root = new THREE.Group()
    root.add(mesh)
    const rig = bindRig(root)
    expect(rig.morphs).toHaveLength(1)
    poseRig(rig, lotus.wilt, { stem: 0.6, head: 0, petals: 0 })
    expect(mesh.morphTargetInfluences[0]).toBeCloseTo(0.6)
    poseRig(rig, lotus.wilt, { stem: -0.2, head: 0, petals: 0 })
    expect(mesh.morphTargetInfluences[0]).toBe(0)
  })
})

describe('stage', () => {
  it('maps into the window and passes overshoot through', () => {
    expect(stage(0.1, [0.2, 1])).toBe(0)
    expect(stage(0.6, [0.2, 1])).toBeCloseTo(0.5)
    expect(stage(1.2, [0.2, 1])).toBe(1)
    expect(stage(-0.15, [0.2, 1])).toBe(-0.15)
  })
})

describe('bud to bloom', () => {
  it('folds the petals in as a bud and opens them in bloom', () => {
    const rig = bindRig(buildPlaceholder(lotus))
    // How far the petals spread from the head's axis, on average.
    const spread = () => {
      rig.root.updateMatrixWorld(true)
      const headUp = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.head!.node.getWorldQuaternion(new THREE.Quaternion()))
      const angles = rig.petals.map((p) =>
        new THREE.Vector3(0, 1, 0).applyQuaternion(p.node.getWorldQuaternion(new THREE.Quaternion())).angleTo(headUp)
      )
      return angles.reduce((a, b) => a + b, 0) / angles.length
    }
    poseRig(rig, lotus.wilt, { stem: 0, head: 0, petals: 0, growth: 0.3 })
    const bud = spread()
    poseRig(rig, lotus.wilt, { stem: 0, head: 0, petals: 0, growth: 1 })
    const bloom = spread()
    expect(bud).toBeLessThan(THREE.MathUtils.degToRad(16))
    expect(bloom).toBeGreaterThan(bud + THREE.MathUtils.degToRad(15))
  })

  it('grows the pads when full grown', () => {
    const rig = bindRig(buildPlaceholder(lotus))
    poseRig(rig, lotus.wilt, { stem: 0, head: 0, petals: 0, growth: 1, mature: 0 })
    const before = rig.leaves[0].node.scale.x
    poseRig(rig, lotus.wilt, { stem: 0, head: 0, petals: 0, growth: 1, mature: 1 })
    expect(rig.leaves[0].node.scale.x).toBeCloseTo(before * lotus.wilt.mature!.leaves)
  })
})
