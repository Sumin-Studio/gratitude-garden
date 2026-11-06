import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { FlowerId } from '../../../shared/diary'
import { buildDaisy, DAISY } from './daisy'
import { buildNemophila, NEMOPHILA } from './nemophila'
import type { PatchKind } from './patch'
import { bindRig, poseRig } from './rig'
import { FLOWER_SPECS } from './specs'

// Ground-cover patches are built in code (patch.ts): each must come out as a
// model the rig contract already understands, and stay light.

const PATCHES: [FlowerId, PatchKind, () => THREE.Group][] = [
  ['daisy', DAISY, buildDaisy],
  ['nemophila', NEMOPHILA, buildNemophila]
]

describe.each(PATCHES)('the %s patch', (id, kind, build) => {
  const spec = FLOWER_SPECS[id]
  const scene = build()
  const rig = bindRig(scene)
  const mesh = scene.getObjectByName(`${kind.name}_mesh`) as THREE.SkinnedMesh

  it('follows the rig contract: a crown, mat sectors, one bone per head', () => {
    expect(rig.stems.map((s) => s.node.name)).toEqual(['stem_0', 'stem_1'])
    expect(rig.head?.node.name).toBe('head')
    expect(rig.branches).toHaveLength(kind.sectors)
    expect(rig.blooms).toHaveLength(kind.heads)
    expect(rig.blooms.every((b) => !b.onBranch)).toBe(true)
  })

  it('is one skinned mesh, under 40k triangles, painted by vertex and tagged by part', () => {
    expect(mesh.isSkinnedMesh).toBe(true)
    expect(mesh.geometry.getIndex()!.count / 3).toBeLessThan(40_000)
    expect(mesh.geometry.getAttribute('color')).toBeTruthy()
    expect(mesh.geometry.getAttribute('wcPart')).toBeTruthy()
    expect(mesh.geometry.getAttribute('uv')).toBeFalsy()
    expect(mesh.skeleton.bones).toHaveLength(3 + kind.sectors + kind.heads)
  })

  it('stands on the ground, low and wide', () => {
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    expect(box.min.y).toBeGreaterThan(-0.02)
    expect(box.max.y).toBeLessThan(0.45)
    expect(box.max.x - box.min.x).toBeGreaterThan(1.6)
  })

  it('opens from the middle out', () => {
    const open = (b: (typeof rig.blooms)[number]) => b.node.scale.y / b.restScale.y
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    poseRig(rig, spec.wilt, { stem: 0, head: 0, petals: 0, growth: 0.45 })
    const inner = rig.blooms.filter((b) => b.radial < 0.3)
    const outer = rig.blooms.filter((b) => b.radial > 0.8)
    expect(mean(inner.map(open))).toBeGreaterThan(mean(outer.map(open)) + 0.3)
    // At the goal every head is open.
    poseRig(rig, spec.wilt, { stem: 0, head: 0, petals: 0, growth: 1 })
    expect(Math.min(...rig.blooms.map(open))).toBeGreaterThan(0.99)
    // A seedling: no heads, only the furled mat.
    poseRig(rig, spec.wilt, { stem: 0, head: 0, petals: 0, growth: 0 })
    expect(Math.max(...rig.blooms.map(open))).toBeLessThan(0.01)
  })
})
