import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { fastPick } from './pick'

// fastPick must give three's answer: the same hit or miss, the same nearest
// point, for a bent skinned mesh, from both sides of single-sided material.

/** A bumpy, twisted tube on a chain of three bones, posed off its bind pose. */
function bentTube(side: THREE.Side) {
  const geo = new THREE.CylinderGeometry(0.3, 0.5, 3, 24, 30, true)
  const pos = geo.attributes.position
  const skinIndex: number[] = []
  const skinWeight: number[] = []
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + 1.5
    // Blend between neighbouring bones along the tube.
    const f = Math.min(1.999, Math.max(0, y))
    const b = Math.floor(f)
    const t = f - b
    skinIndex.push(b, b + 1, 0, 0)
    skinWeight.push(1 - t, t, 0, 0)
    pos.setX(i, pos.getX(i) * (1 + 0.15 * Math.sin(i)))
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()]
  bones[0].position.y = -1.5
  bones[1].position.y = 1
  bones[2].position.y = 1
  bones[0].add(bones[1])
  bones[1].add(bones[2])
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial({ side }))
  mesh.add(bones[0])
  mesh.bind(new THREE.Skeleton(bones))
  bones[1].rotation.z = 0.5
  bones[2].rotation.set(0.3, 0.4, -0.6)
  mesh.position.set(0.2, 0.1, -0.3)
  mesh.rotation.y = 0.7
  mesh.updateMatrixWorld(true)
  return mesh
}

function compare(side: THREE.Side) {
  const plain = bentTube(side)
  const fast = bentTube(side)
  fastPick(fast)
  plain.computeBoundingSphere()
  fast.computeBoundingSphere()
  expect(fast.boundingSphere!.center.distanceTo(plain.boundingSphere!.center)).toBeLessThan(1e-9)
  expect(Math.abs(fast.boundingSphere!.radius - plain.boundingSphere!.radius)).toBeLessThan(1e-9)

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
  camera.position.set(0, 0.5, 9)
  camera.lookAt(0, 0.5, 0)
  camera.updateMatrixWorld()
  const ray = new THREE.Raycaster()
  let hits = 0
  for (let x = -1; x <= 1; x += 0.025)
    for (let y = -1; y <= 1; y += 0.025) {
      ray.setFromCamera(new THREE.Vector2(x, y), camera)
      const a = ray.intersectObject(plain, false)[0]
      const b = ray.intersectObject(fast, false)[0]
      expect(Boolean(b)).toBe(Boolean(a))
      if (a && b) {
        hits++
        expect(Math.abs(a.distance - b.distance)).toBeLessThan(1e-9)
        expect(b.faceIndex).toBe(a.faceIndex)
      }
    }
  return hits
}

describe('fastPick', () => {
  it('hits exactly what three hits, double-sided', { timeout: 20_000 }, () => {
    expect(compare(THREE.DoubleSide)).toBeGreaterThan(200)
  })
  it('honours a single-sided material', { timeout: 20_000 }, () => {
    expect(compare(THREE.FrontSide)).toBeGreaterThan(100)
    expect(compare(THREE.BackSide)).toBeGreaterThan(100)
  })
})
