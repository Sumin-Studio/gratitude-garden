import * as THREE from 'three'
import { frameStamp } from './pace'

// Hit-testing the plant, cheaply. Hover, the brush and clicks are r3f
// raycasts; three tests a skinned mesh by running every vertex of every
// triangle through its bones, per mouse move: ~8 ms a move on the lotus, so
// brushing a grown plant ran at ~40 fps. Here a mesh's posed vertices are
// skinned once per rendered frame into a cache (three's own maths:
// SkinnedMesh.applyBoneTransform), and the ray is tested against those. Same
// answer as three's (the nearest posed triangle, honouring each material's
// side), a fraction of the cost. The cache also measures the bounding sphere
// (frustum culling) without skinning everything a second time.

type Cache = { stamp: number; pos: Float64Array }

const _v = new THREE.Vector3()
const _b = new THREE.Vector3()
const _s = new THREE.Vector3()
const _inverse = new THREE.Matrix4()
const _ray = new THREE.Ray()
const _a = new THREE.Vector3()
const _bb = new THREE.Vector3()
const _c = new THREE.Vector3()
const _hit = new THREE.Vector3()

/** The mesh's posed vertices in its local space, as getVertexPosition gives them. */
function skin(mesh: THREE.SkinnedMesh, cache: Cache) {
  const geo = mesh.geometry
  const position = geo.attributes.position
  const skinIndex = geo.attributes.skinIndex
  const skinWeight = geo.attributes.skinWeight
  const morphs = Boolean(geo.morphAttributes.position && mesh.morphTargetInfluences?.some((x) => x !== 0))
  const { bones, boneInverses } = mesh.skeleton
  // Each bone's skinning matrix once, not once per vertex.
  const mats = bones.map((bone, i) => new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, boneInverses[i]))
  const out = cache.pos
  for (let i = 0; i < position.count; i++) {
    if (morphs) THREE.Mesh.prototype.getVertexPosition.call(mesh, i, _v)
    else _v.fromBufferAttribute(position, i)
    _b.copy(_v).applyMatrix4(mesh.bindMatrix)
    _v.set(0, 0, 0)
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(i, k)
      if (w !== 0) _v.addScaledVector(_s.copy(_b).applyMatrix4(mats[skinIndex.getComponent(i, k)]), w)
    }
    _v.applyMatrix4(mesh.bindMatrixInverse)
    out[i * 3] = _v.x
    out[i * 3 + 1] = _v.y
    out[i * 3 + 2] = _v.z
  }
}

/** Posed positions, skinned at most once per rendered frame. */
function posed(mesh: THREE.SkinnedMesh, cache: Cache, fresh = false) {
  const n = mesh.geometry.attributes.position.count * 3
  if (cache.pos.length !== n) {
    cache.pos = new Float64Array(n)
    cache.stamp = -1
  }
  const stamp = frameStamp()
  if (fresh || cache.stamp !== stamp) {
    skin(mesh, cache)
    cache.stamp = stamp
  }
  return cache.pos
}

/** Möller–Trumbore, loose (a little past the edges), as a quick filter before three's exact test. */
function maybeHits(ray: THREE.Ray, p: Float64Array, a: number, b: number, c: number, side: THREE.Side) {
  const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z
  const dx = ray.direction.x, dy = ray.direction.y, dz = ray.direction.z
  const ax = p[a], ay = p[a + 1], az = p[a + 2]
  const e1x = p[b] - ax, e1y = p[b + 1] - ay, e1z = p[b + 2] - az
  const e2x = p[c] - ax, e2y = p[c + 1] - ay, e2z = p[c + 2] - az
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  // Facing: det > 0 is the triangle's front seen along the ray.
  if (det === 0 || (side === THREE.FrontSide && det < 0) || (side === THREE.BackSide && det > 0)) return false
  const inv = 1 / det
  const tx = ox - ax, ty = oy - ay, tz = oz - az
  const u = (tx * px + ty * py + tz * pz) * inv
  const slack = 1e-4
  if (u < -slack || u > 1 + slack) return false
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inv
  if (v < -slack || u + v > 1 + slack) return false
  return (e2x * qx + e2y * qy + e2z * qz) * inv >= -slack
}

/** Give a skinned mesh the cached hit test and bounding sphere. */
export function fastPick(mesh: THREE.SkinnedMesh) {
  if (mesh.userData.fastPick) return
  mesh.userData.fastPick = true
  const cache: Cache = { stamp: -1, pos: new Float64Array(0) }

  mesh.computeBoundingSphere = function () {
    const p = posed(mesh, cache, true)
    if (this.boundingSphere === null) this.boundingSphere = new THREE.Sphere()
    this.boundingSphere.makeEmpty()
    for (let i = 0; i < p.length; i += 3) this.boundingSphere.expandByPoint(_v.set(p[i], p[i + 1], p[i + 2]))
  }

  mesh.raycast = function (raycaster, intersects) {
    const material = this.material
    if (material === undefined) return
    const geo = this.geometry
    const p = posed(mesh, cache)
    _inverse.copy(this.matrixWorld).invert()
    _ray.copy(raycaster.ray).applyMatrix4(_inverse)
    const index = geo.index
    const count = index ? index.count : geo.attributes.position.count
    const ranges = Array.isArray(material)
      ? geo.groups.map((g) => ({ start: Math.max(g.start, geo.drawRange.start), end: Math.min(count, g.start + g.count, geo.drawRange.start + geo.drawRange.count), material: material[g.materialIndex!], materialIndex: g.materialIndex }))
      : [{ start: Math.max(0, geo.drawRange.start), end: Math.min(count, geo.drawRange.start + geo.drawRange.count), material, materialIndex: undefined }]
    let best: THREE.Intersection | null = null
    for (const r of ranges) {
      if (!r.material) continue
      const side = r.material.side
      for (let j = r.start; j < r.end; j += 3) {
        const a = index ? index.getX(j) : j
        const b = index ? index.getX(j + 1) : j + 1
        const c = index ? index.getX(j + 2) : j + 2
        if (!maybeHits(_ray, p, a * 3, b * 3, c * 3, side)) continue
        // three's own test and distance, so the answer is exactly its answer.
        _a.set(p[a * 3], p[a * 3 + 1], p[a * 3 + 2])
        _bb.set(p[b * 3], p[b * 3 + 1], p[b * 3 + 2])
        _c.set(p[c * 3], p[c * 3 + 1], p[c * 3 + 2])
        const hit =
          side === THREE.BackSide
            ? _ray.intersectTriangle(_c, _bb, _a, true, _hit)
            : _ray.intersectTriangle(_a, _bb, _c, side === THREE.FrontSide, _hit)
        if (!hit) continue
        const point = _hit.clone().applyMatrix4(this.matrixWorld)
        const distance = raycaster.ray.origin.distanceTo(point)
        if (distance < raycaster.near || distance > raycaster.far || (best && best.distance <= distance)) continue
        const normal = new THREE.Vector3()
        THREE.Triangle.getNormal(_a, _bb, _c, normal)
        best = { distance, point, object: this, faceIndex: Math.floor(j / 3), face: { a, b, c, normal, materialIndex: r.materialIndex ?? 0 } }
      }
    }
    // The nearest only: r3f keeps one hit per object, the nearest.
    if (best) intersects.push(best)
  }
}

