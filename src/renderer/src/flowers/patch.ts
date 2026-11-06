import * as THREE from 'three'

// Ground-cover patches built in code rather than from a Meshy GLB: a low,
// sparse carpet of small flowers on short stalks over a mat of grass blades
// and leaves. One builder for every patch type (daisy.ts, nemophila.ts):
// each brings its own head geometry, leaf shape and colours. A patch comes
// out as the same thing a rigged GLB would (a skinned mesh over named bones,
// vertex colours, no texture), so models.ts, the rig driver, the pad and the
// garden treat it like every other type:
//
//   stem_0 / stem_1 / head    the crown, a weightless head on top for the halo
//   branch_N_0                one sector of the mat, fanning out from the crown
//                             (furled up into sprigs while young)
//   bloom_N                   one flower with its stalk, pivot at the ground,
//                             +Y up the stalk (hidden, a bud, then open)
//
// Each vertex carries its watercolour part (wcPart) so the stalks stay green
// under the bloom bones (markParts keeps a model's own tags).

export const rad = THREE.MathUtils.degToRad

/** How heads, grass and leaves spread over the disc: radius ∝ u^FALLOFF.
 * 0.5 is even; above it they crowd the middle and thin out to the rim. */
const FALLOFF = 0.72

export function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** An sRGB colour, stored linear in the vertex colour (what a GLB carries). */
export const lin = (hex: string) => {
  const c = new THREE.Color().setStyle(hex, THREE.SRGBColorSpace)
  return [c.r, c.g, c.b]
}
export const mix3 = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t)

/** Watercolour parts: x leaf, y petal, z rim (see watercolour.ts markParts). */
export const PART = { leaf: [1, 0, 0], petal: [0, 1, 0], heart: [0, 0, 0], rim: [1, 0, 1] }

export type Vert = { p: THREE.Vector3; c: number[]; part: number[] }

/** Everything goes into one skinned mesh; a piece is a few vertices on one bone. */
export class Sink {
  pos: number[] = []
  col: number[] = []
  part: number[] = []
  skin: number[] = []
  idx: number[] = []
  count = 0
  /** `xf` moves a piece authored in its bone's frame out to where the bone
   * rests: skinning maps a vertex through the bone's rest pose, so the
   * geometry has to be in the scene's space. */
  piece(bone: number, verts: Vert[], tris: number[][], xf?: THREE.Matrix4) {
    const base = this.count
    for (const v of verts) {
      if (xf) v.p.applyMatrix4(xf)
      this.pos.push(v.p.x, v.p.y, v.p.z)
      this.col.push(...v.c)
      this.part.push(...v.part)
      this.skin.push(bone, 0, 0, 0)
      this.count++
    }
    for (const t of tris) this.idx.push(base + t[0], base + t[1], base + t[2])
  }
  geometry() {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    geo.setAttribute('wcPart', new THREE.Float32BufferAttribute(this.part, 3))
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skin, 4))
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skin.map((_, i) => (i % 4 === 0 ? 1 : 0)), 4))
    geo.setIndex(this.idx)
    geo.computeVertexNormals()
    return geo
  }
}

const UP = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)

/** A frame at `at`, y along `dir`, x roughly along `side`. */
export function frame(at: THREE.Vector3, dir: THREE.Vector3, side = Z) {
  const y = dir.clone().normalize()
  let x = new THREE.Vector3().crossVectors(side, y)
  if (x.lengthSq() < 1e-6) x = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), y)
  x.normalize()
  const z = new THREE.Vector3().crossVectors(y, x)
  return (lx: number, ly: number, lz: number) => at.clone().addScaledVector(x, lx).addScaledVector(y, ly).addScaledVector(z, lz)
}

/** A thin stalk: a three-sided prism from the bone's foot up `height`. */
export function stalk(sink: Sink, bone: number, xf: THREE.Matrix4, height: number, radius: number, colour: number[]) {
  const verts: Vert[] = []
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2
    const dx = Math.cos(a) * radius
    const dz = Math.sin(a) * radius
    verts.push({ p: new THREE.Vector3(dx, 0, dz), c: colour, part: PART.leaf })
    verts.push({ p: new THREE.Vector3(dx * 0.8, height - 0.004, dz * 0.8), c: colour, part: PART.leaf })
  }
  sink.piece(
    bone,
    verts,
    [
      [0, 2, 1],
      [1, 2, 3],
      [2, 4, 3],
      [3, 4, 5],
      [4, 0, 5],
      [5, 0, 1]
    ],
    xf
  )
}

/** The mat's colours. */
export type Greens = { deep: number[]; mid: number[]; light: number[]; leaf: number[]; leafTip: number[]; stalk: number[] }

/** What a head-drawing function gets: its bone, the bone's rest transform,
 * a seed, the stalk height, the way the head faces (bone frame) and a size. */
export type HeadArgs = { sink: Sink; bone: number; xf: THREE.Matrix4; seed: number; height: number; face: THREE.Vector3; scale: number; greens: Greens }

export type PatchKind = {
  name: string
  seed: number
  /** Reach of the mat from the crown, app units (the suiban is 1.56 wide). */
  radius: number
  heads: number
  sectors: number
  blades: number
  leaves: number
  greens: Greens
  /** Stalk height at the middle of the dome and at its rim. */
  stalkMid: number
  stalkRim: number
  /** Head size, from and to. */
  scale: [number, number]
  /** Draw one flower (stalk and head) in its bone's frame. */
  head: (a: HeadArgs) => void
  /** `spoon`: a plain rosette leaf; `lobed`: a feathery leaf cut into lobes. */
  leaf: 'spoon' | 'lobed'
}

/** A grass blade: a tapered strip, bent over a little at the top. */
function blade(sink: Sink, bone: number, g: Greens, foot: THREE.Vector3, h: number, lean: THREE.Vector3, w: number, shade: number) {
  const dir = new THREE.Vector3(lean.x, 1, lean.z).normalize()
  const at = frame(foot, dir, new THREE.Vector3(lean.x || 0.3, 0, lean.z || 0.7))
  const c0 = mix3(g.deep, g.mid, shade)
  const c1 = mix3(g.mid, g.light, shade)
  const verts: Vert[] = [
    { p: at(-w, 0, 0), c: c0, part: PART.leaf },
    { p: at(w, 0, 0), c: c0, part: PART.leaf },
    { p: at(-w * 0.7, h * 0.55, h * 0.06), c: mix3(c0, c1, 0.5), part: PART.leaf },
    { p: at(w * 0.7, h * 0.55, h * 0.06), c: mix3(c0, c1, 0.5), part: PART.leaf },
    { p: at(0, h, h * 0.22), c: c1, part: PART.rim }
  ]
  sink.piece(bone, verts, [
    [0, 1, 2],
    [1, 3, 2],
    [2, 3, 4]
  ])
}

/** A rosette leaf: a spoon lying low, arching up from its foot. */
function spoonLeaf(sink: Sink, bone: number, g: Greens, foot: THREE.Vector3, out: THREE.Vector3, len: number, w: number, lift: number) {
  const dir = new THREE.Vector3(out.x, lift, out.z).normalize()
  const at = frame(foot, dir, UP)
  const pt = (u: number, s: number) => at(s * w, u * len, -0.18 * len * Math.sin(u * Math.PI) - 0.1 * len * u * u)
  const verts: Vert[] = [
    { p: pt(0, 0), c: g.leaf, part: PART.leaf },
    { p: pt(0.35, -0.6), c: g.leaf, part: PART.leaf },
    { p: pt(0.35, 0.6), c: g.leaf, part: PART.leaf },
    { p: pt(0.7, -1), c: mix3(g.leaf, g.leafTip, 0.5), part: PART.rim },
    { p: pt(0.7, 1), c: mix3(g.leaf, g.leafTip, 0.5), part: PART.rim },
    { p: pt(1, 0), c: g.leafTip, part: PART.rim }
  ]
  sink.piece(bone, verts, [
    [0, 1, 2],
    [1, 3, 2],
    [2, 3, 4],
    [3, 5, 4]
  ])
}

/** A feathery leaf: a midrib with a pair of rounded lobes at each step,
 * smaller towards the tip, arching low over the ground. */
function lobedLeaf(sink: Sink, bone: number, g: Greens, foot: THREE.Vector3, out: THREE.Vector3, len: number, w: number, lift: number) {
  const dir = new THREE.Vector3(out.x, lift, out.z).normalize()
  const at = frame(foot, dir, UP)
  const bow = (u: number) => -0.16 * len * Math.sin(u * Math.PI) - 0.08 * len * u * u
  const pt = (u: number, s: number) => at(s, u * len, bow(u))
  const steps = 4
  const verts: Vert[] = []
  const tris: number[][] = []
  // The rib, a thin strip.
  for (let k = 0; k <= steps; k++) {
    const u = k / steps
    const rw = w * 0.18 * (1 - 0.6 * u)
    verts.push({ p: pt(u, -rw), c: g.leaf, part: PART.leaf }, { p: pt(u, rw), c: g.leaf, part: PART.leaf })
    if (k) {
      const b = (k - 1) * 2
      tris.push([b, b + 2, b + 1], [b + 1, b + 2, b + 3])
    }
  }
  // A lobe each side at each step: a little triangle fan, pointing out and forward.
  for (let k = 1; k <= steps; k++) {
    const u = (k - 0.5) / steps
    const size = w * (1.05 - 0.55 * (k / steps))
    for (const side of [-1, 1]) {
      const c = verts.length
      const tip = k === steps ? 0.18 : 0.42
      verts.push(
        { p: pt(u - 0.06, side * w * 0.12), c: g.leaf, part: PART.leaf },
        { p: pt(u + 0.02, side * size * 0.75), c: mix3(g.leaf, g.leafTip, 0.5), part: PART.rim },
        { p: pt(u + tip / steps, side * size), c: g.leafTip, part: PART.rim },
        { p: pt(u + 0.1, side * w * 0.12), c: g.leaf, part: PART.leaf }
      )
      tris.push([c, c + 1, c + 2], [c, c + 2, c + 3])
    }
  }
  // The end lobe.
  const c = verts.length
  verts.push(
    { p: pt(1 - 0.08, -w * 0.3), c: g.leaf, part: PART.leaf },
    { p: pt(1 - 0.08, w * 0.3), c: g.leaf, part: PART.leaf },
    { p: pt(1.08, 0), c: g.leafTip, part: PART.rim }
  )
  tris.push([c, c + 1, c + 2])
  sink.piece(bone, verts, tris)
}

/** The patch, as a GLB-shaped scene: bones and one skinned mesh. Stands on
 * the ground at y 0, centred on the crown, facing +Z. */
export function buildPatch(kind: PatchKind): THREE.Group {
  const rnd = mulberry(kind.seed)
  const R = kind.radius
  const scene = new THREE.Group()
  scene.name = kind.name
  const bones: THREE.Bone[] = []
  const bone = (name: string, parent: THREE.Object3D, at: THREE.Vector3, dir?: THREE.Vector3) => {
    const b = new THREE.Bone()
    b.name = name
    parent.add(b)
    // Placed in the scene's space, then expressed in the parent's.
    parent.updateWorldMatrix(true, false)
    b.position.copy(parent.worldToLocal(at.clone()))
    if (dir) {
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())
      const pq = parent.getWorldQuaternion(new THREE.Quaternion()).invert()
      b.quaternion.copy(pq.multiply(q))
    }
    bones.push(b)
    return b
  }
  const stem0 = bone('stem_0', scene, new THREE.Vector3(0, 0, 0))
  const stem1 = bone('stem_1', stem0, new THREE.Vector3(0, 0.08, 0))
  bone('head', stem1, new THREE.Vector3(0, kind.stalkMid + 0.1, 0))
  const sectorBone: number[] = []
  for (let s = 0; s < kind.sectors; s++) {
    const a = ((s + 0.5) / kind.sectors) * Math.PI * 2
    bone(`branch_${s}_0`, stem0, new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(Math.cos(a), 0.36, Math.sin(a)))
    sectorBone.push(bones.length - 1)
  }
  const sectorOf = (x: number, z: number) => {
    let a = Math.atan2(z, x)
    if (a < 0) a += Math.PI * 2
    return sectorBone[Math.min(kind.sectors - 1, Math.floor((a / (Math.PI * 2)) * kind.sectors))]
  }

  const sink = new Sink()

  // Heads: a golden spiral over the disc, jittered, a little taller in the
  // middle where the carpet domes up; the rim leans out over the edge. Not
  // even: they thin out towards the rim (r ∝ t^FALLOFF, not √t), so the
  // patch fades into the lawn instead of stopping at an edge.
  for (let i = 0; i < kind.heads; i++) {
    const t = (i + 0.5) / kind.heads
    const r = R * 0.97 * Math.pow(t, FALLOFF) + (rnd() - 0.5) * 0.12
    const a = i * 2.39996 + (rnd() - 0.5) * 0.3
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const edge = Math.min(1, r / R)
    const h = kind.stalkRim + (kind.stalkMid - kind.stalkRim) * (1 - edge * edge) + (rnd() - 0.5) * 0.05
    // Leaning out from the middle, more at the rim, plus a little wander.
    const out = new THREE.Vector3(x, 0, z).normalize()
    const lean = rad(4 + 30 * edge * edge + (rnd() - 0.5) * 8)
    const wander = rad((rnd() - 0.5) * 10)
    const dir = new THREE.Vector3(0, 1, 0)
      .applyAxisAngle(new THREE.Vector3(-out.z, 0, out.x), lean)
      .applyAxisAngle(out, wander)
      .normalize()
    const b = bone(`bloom_${i}`, stem0, new THREE.Vector3(x, 0.005, z), dir)
    b.updateWorldMatrix(true, false)
    // The head nods to the viewer, and turns a little either way.
    const face = new THREE.Vector3(0, 1, 0)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), rad(22 + rnd() * 16))
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), rad((rnd() - 0.5) * 24))
    const [s0, s1] = kind.scale
    // Out at the fringe the odd stray head is a little smaller.
    const size = (s0 + rnd() * (s1 - s0)) * (1 - 0.18 * edge * edge)
    kind.head({ sink, bone: bones.length - 1, xf: b.matrixWorld.clone(), seed: rnd(), height: h, face, scale: size, greens: kind.greens })
  }

  // The mat: short grass over the whole disc, leaves among it.
  for (let i = 0; i < kind.blades; i++) {
    const r = R * Math.pow(rnd(), FALLOFF)
    const a = rnd() * Math.PI * 2
    const foot = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)
    const lean = new THREE.Vector3((rnd() - 0.5) * 0.9, 0, (rnd() - 0.5) * 0.9)
    // Shorter and sparser out at the fringe, down to lawn height.
    const h = (0.05 + rnd() * 0.05) * (1 - 0.45 * (r / R) ** 2)
    blade(sink, sectorOf(foot.x, foot.z), kind.greens, foot, h, lean, 0.006 + rnd() * 0.004, rnd())
  }
  const leaf = kind.leaf === 'lobed' ? lobedLeaf : spoonLeaf
  for (let i = 0; i < kind.leaves; i++) {
    const r = R * Math.pow(rnd(), FALLOFF) * 0.9
    const a = rnd() * Math.PI * 2
    const foot = new THREE.Vector3(Math.cos(a) * r, 0.004, Math.sin(a) * r)
    const oa = rnd() * Math.PI * 2
    const out = new THREE.Vector3(Math.cos(oa), 0, Math.sin(oa))
    leaf(sink, sectorOf(foot.x, foot.z), kind.greens, foot, out, 0.09 + rnd() * 0.07, 0.016 + rnd() * 0.008, 0.2 + rnd() * 0.35)
  }

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide })
  material.name = kind.name
  const mesh = new THREE.SkinnedMesh(sink.geometry(), material)
  mesh.name = `${kind.name}_mesh`
  mesh.add(stem0)
  scene.add(mesh)
  scene.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(bones))
  mesh.castShadow = true
  mesh.frustumCulled = false
  return scene
}
