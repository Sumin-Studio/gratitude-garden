import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { FlowerSpec } from './specs'
import { buildSuiban } from './suiban'

// Builds a grey-block study model for a spec. The scene graph follows the rig
// contract in docs/FLOWERS.md exactly, so the same driver poses it and any GLB
// Simon drops in later.

const rad = THREE.MathUtils.degToRad

export const CLAY = {
  plant: '#c9ccc8',
  petal: '#d6d8d3',
  core: '#bfc1bc',
  pot: '#b7aea4',
  soil: '#5e554c'
}

function block(w: number, h: number, d: number, mat: THREE.Material) {
  const r = Math.min(w, h, d) * 0.35
  const geo = new RoundedBoxGeometry(w, h, d, 2, r)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  return mesh
}

function material(color: string, role: string) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0 })
  m.name = role
  m.userData.role = role
  return m
}

export function buildPlaceholder(spec: FlowerSpec): THREE.Group {
  const mats = {
    plant: material(CLAY.plant, 'plant'),
    petal: material(CLAY.petal, 'petal'),
    core: material(CLAY.core, 'core'),
    pot: material(CLAY.pot, 'pot'),
    soil: material(CLAY.soil, 'soil')
  }

  const root = new THREE.Group()
  root.name = 'flower'

  // Pot: a suiban basin of water, origin at the bottom centre so the contact
  // shadow sits at y = 0. The plant stands on its floor, under the water.
  // A garden plant without one stands on the ground (y = 0).
  const ph = spec.pot?.height ?? 0.02
  if (spec.pot) root.add(buildSuiban(mats.pot, mats.soil))
  else root.userData.ground = true

  // Stem chain: each segment is a pivot group; the next segment hangs off its tip.
  let parent: THREE.Object3D = root
  let y = ph - 0.02
  const { segments, length, thickness, taper } = spec.stem
  const stems: THREE.Group[] = []
  for (let i = 0; i < segments; i++) {
    const seg = new THREE.Group()
    seg.name = `stem_${i}`
    seg.position.y = y
    const t = thickness * Math.pow(taper, i)
    const mesh = block(t, length + t * 0.6, t, mats.plant)
    mesh.position.y = length / 2
    seg.add(mesh)
    parent.add(seg)
    stems.push(seg)
    parent = seg
    y = length
  }

  // Leaves hang off stem segments. Blade extends along local +X; rest tilt is
  // a rotation around local Z, so sag is "more negative Z".
  spec.leaves.forEach((leaf, i) => {
    const host = stems[Math.min(leaf.segment, stems.length - 1)]
    const node = new THREE.Group()
    node.name = `leaf_${i}`
    node.position.y = leaf.along * length
    node.quaternion
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), rad(leaf.side))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad(leaf.tilt)))
    const [lw, lh, ld] = leaf.size
    const mesh = block(lw, lh, ld, mats.plant)
    mesh.position.x = lw / 2
    node.add(mesh)
    host.add(node)
  })

  // Head on the last segment's tip.
  const head = new THREE.Group()
  head.name = 'head'
  head.position.y = length
  head.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rad(spec.head.pitch))
  const [cw, ch, cd] = spec.head.core
  const core = block(cw, ch, cd, mats.core)
  core.position.y = ch / 2
  core.name = 'core'
  head.add(core)

  // Petals: hinge on a ring around the head; blade extends along local +Y and
  // opens around local X (towards local +Z, which points outward).
  let p = 0
  for (const ring of spec.head.rings) {
    for (let k = 0; k < ring.count; k++) {
      const phi = rad(ring.phase + (360 / ring.count) * k)
      const node = new THREE.Group()
      node.name = `petal_${p++}`
      node.position.set(Math.sin(phi) * ring.radius, ring.lift, Math.cos(phi) * ring.radius)
      node.quaternion
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), phi)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rad(ring.open)))
      const [w, l, d] = ring.size
      const mesh = block(w, l, d, mats.petal)
      mesh.position.y = l / 2
      node.add(mesh)
      head.add(node)
    }
  }
  stems[stems.length - 1].add(head)

  root.scale.setScalar(spec.scale)
  return root
}
