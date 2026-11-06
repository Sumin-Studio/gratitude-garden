import * as THREE from 'three'
import type { Stage, WiltSpec } from './specs'

// The rig contract: find named nodes in any flower model and pose them from a
// wilt value and a growth value. Works on the placeholder and on GLBs
// (docs/FLOWERS.md).

type Bone = { node: THREE.Object3D; rest: THREE.Quaternion; restScale: THREE.Vector3; restPos: THREE.Vector3 }
/** A petal, and how it folds into the bud: around `close` (its parent's
 * frame) by `closeAngle`, towards the flower's axis. `ring` is 0 for the
 * outermost petals (they open first) … 1 for the innermost. */
export type Petal = Bone & {
  delay: number
  gain: number
  phase: number
  tip: Bone | null
  close: THREE.Vector3
  closeAngle: number
  ring: number
}
/** A bone with its rest direction (bone +Y) in root space, for screen-space moves. */
type Aimed = Bone & { dir: THREE.Vector3; phase: number }

/** A leaf, pad or bud on its own stalk (autorig v2): stalk_N_k, then leaf_N
 * with rim bones leaf_N_rim_k, or bud_N. A bud is a small bloom (autorig
 * 4b) with petals bud_N_petal_K(_tip): shut while growing, open full grown. */
export type Organ = {
  stalk: Bone[]
  pad: Aimed | null
  rims: Aimed[]
  bud: Aimed | null
  budPetals: Petal[]
  /** Horizontal direction from the stem out to the organ, root space. */
  out: THREE.Vector3
  /** Rest heights in root space (measureGrowth): where the stalk leaves the
   * stem, and how far above that the organ reaches. */
  attachY: number
  reach: number
  /** How far under the mud the organ's top starts (the margin in reach). */
  margin: number
  /** Each organ answers a brush a little differently. */
  gain: number
}

/** autorig v3, a spike or a clump: a chain of bones carrying foliage, fanning
 * out from the crown (branch_N_0, branch_N_1 …) or one leaf off a spike's
 * stem (branch_N_0). Furled towards upright while young, it opens as the
 * plant grows and bows outward when thirsty. */
export type Branch = {
  bones: Aimed[]
  /** Horizontal direction from the stem out along the branch, root space. */
  out: THREE.Vector3
  /** How far it is furled up at the start, radians (never past upright). */
  furl: number
  /** 0 … 1: how high it starts (rank) and a per-branch jitter. */
  rank: number
  jit: number
  gain: number
}

/** autorig v3: one flower of many (bloom_N), pivot where it meets its stalk,
 * +Y out through the flower. Hidden on a seedling, a shut bud, then open.
 * `radial`: how far out from the stem it stands, 0 at the crown … 1 the
 * farthest (a carpet opens from the middle out). */
export type Bloom = Aimed & { out: THREE.Vector3; rank: number; jit: number; gain: number; onBranch: boolean; radial: number }

export type Rig = {
  root: THREE.Object3D
  stems: Bone[]
  head: Bone | null
  petals: Petal[]
  leaves: Bone[]
  organs: Organ[]
  branches: Branch[]
  blooms: Bloom[]
  tint: { mat: THREE.MeshStandardMaterial; fresh: THREE.Color; dry: THREE.Color; dead: THREE.Color }[]
  morphs: { mesh: THREE.Mesh; index: number }[]
  /** Every mesh that isn't the pot: hidden together for an empty pot. */
  plantMeshes: THREE.Object3D[]
  /** For skinned models: a plain group around the plant that grows it, since
   * scaling the root bone down that far doesn't render reliably. */
  growNode: { node: THREE.Object3D; restScale: THREE.Vector3 } | null
  /** Growth by emerging (measureGrowth): parts rise up out of the mud, which
   * clips them, instead of the plant scaling up. Null: scale (placeholder). */
  emerge: { mudY: number; stemReach: number; clip: THREE.Plane } | null
}



/** Wilt per part (0 fresh … 1 wilted, below 0 = recovery overshoot), and
 * growth (0 seedling … 1 full bloom, default 1). */
export type WiltDrive = {
  stem: number
  head: number
  petals: number
  growth?: number
  /** 0 alive … 1 dead: browner, greyer, slumped further. */
  dead?: number
  /** Nothing planted: only the pot and soil show. */
  empty?: boolean
  /** Cursor brush, in degrees of sideways bend at the top: the stem now, and
   * a lagging copy for stalks, the head and buds. + leans to screen right. */
  sway?: number
  swayLag?: number
  /** 0 … 1: how much petal tips and pad rims are fluttering after a brush. */
  flutter?: number
  /** Seconds, for flutter. */
  time?: number
  /** 0 … 1: in bloom → full grown (bigger pads, a taller stem, the side
   * bloom open). Defaults to following growth, from MATURE_FROM to 1. */
  mature?: number
}

const STEM = /^stem[_.\- ]?(\d+)/i
const PETAL = /^petal/i
const PETAL_TIP = /^petal[_.\- ]?\d+[_.\- ]tip/i
const LEAF = /^leaf/i
const LEAF_N = /^leaf[_.\- ]?(\d+)$/i
const RIM = /^leaf[_.\- ]?(\d+)[_.\- ]rim[_.\- ]?(\d+)/i
const STALK = /^stalk[_.\- ]?(\d+)[_.\- ](\d+)/i
const BUD = /^bud[_.\- ]?(\d+)/i
const BUD_PETAL = /^bud[_.\- ]?(\d+)[_.\- ]petal[_.\- ]?\d+$/i
const BUD_PETAL_TIP = /^bud[_.\- ]?(\d+)[_.\- ]petal[_.\- ]?\d+[_.\- ]tip/i
const HEAD = /^head(?![a-z])/i
const BRANCH = /^branch[_.\- ]?(\d+)[_.\- ](\d+)/i
const BLOOM = /^bloom[_.\- ]?(\d+)$/i
const NO_TINT = /^(pot|soil)/i

// Deterministic per-index noise so petals don't move in lockstep.
const hash = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

// Dried-clay direction: warmer, darker. Dead goes further, toward dead leaves.
const DRY_TINT = new THREE.Color(0.74, 0.62, 0.48)
const DEAD_TINT = new THREE.Color(0.42, 0.34, 0.27)

function bone(node: THREE.Object3D): Bone {
  return { node, rest: node.quaternion.clone(), restScale: node.scale.clone(), restPos: node.position.clone() }
}

export function bindRig(root: THREE.Object3D): Rig {
  const stems: { i: number; b: Bone }[] = []
  const petals: Petal[] = []
  const leaves: Bone[] = []
  let head: Bone | null = null
  const tint: Rig['tint'] = []
  const seen = new Set<THREE.Material>()
  const morphs: Rig['morphs'] = []
  const plantMeshes: THREE.Object3D[] = []
  const tips: THREE.Object3D[] = []
  const parts = new Map<
    number,
    { stalk: { k: number; b: Bone }[]; pad?: THREE.Object3D; rims: { k: number; o: THREE.Object3D }[]; bud?: THREE.Object3D; budPetals: THREE.Object3D[]; budTips: THREE.Object3D[] }
  >()
  const branchParts = new Map<number, { k: number; o: THREE.Object3D }[]>()
  const bloomNodes: { i: number; o: THREE.Object3D }[] = []
  const part = (i: number) => {
    if (!parts.has(i)) parts.set(i, { stalk: [], rims: [], budPetals: [], budTips: [] })
    return parts.get(i)!
  }

  root.traverse((o) => {
    const name = o.name ?? ''
    const s = STEM.exec(name)
    const stalk = STALK.exec(name)
    const rim = RIM.exec(name)
    const bud = BUD.exec(name)
    const budTip = BUD_PETAL_TIP.exec(name)
    const budPetal = BUD_PETAL.exec(name)
    const branch = BRANCH.exec(name)
    const bloomN = BLOOM.exec(name)
    if (branch) {
      const i = Number(branch[1])
      if (!branchParts.has(i)) branchParts.set(i, [])
      branchParts.get(i)!.push({ k: Number(branch[2]), o })
    } else if (bloomN) bloomNodes.push({ i: Number(bloomN[1]), o })
    else if (budTip) part(Number(budTip[1])).budTips.push(o)
    else if (budPetal) part(Number(budPetal[1])).budPetals.push(o)
    else if (stalk) part(Number(stalk[1])).stalk.push({ k: Number(stalk[2]), b: bone(o) })
    else if (rim) part(Number(rim[1])).rims.push({ k: Number(rim[2]), o })
    else if (bud) part(Number(bud[1])).bud = o
    else if (PETAL_TIP.test(name)) tips.push(o)
    else if (s) {
      // Depth-first, so the outermost node for each index wins.
      if (!stems.some((x) => x.i === Number(s[1]))) stems.push({ i: Number(s[1]), b: bone(o) })
    } else if (!head && HEAD.test(name)) head = bone(o)
    else if (PETAL.test(name) && !hasNamedAncestor(o, PETAL)) {
      // Only the outermost node named petal_* is a petal pivot.
      petals.push({ ...bone(o), delay: 0, gain: 1, phase: 0, tip: null, close: new THREE.Vector3(1, 0, 0), closeAngle: 0, ring: 0 })
    } else if (LEAF.test(name) && !hasNamedAncestor(o, LEAF)) {
      const n = LEAF_N.exec(name)
      // A leaf on its own stalk is an organ's pad; a bare leaf_* is the v1 contract.
      if (n && hasNamedAncestor(o, STALK)) part(Number(n[1])).pad = o
      else leaves.push(bone(o))
    }

    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      if (mesh.morphTargetDictionary && 'wilt' in mesh.morphTargetDictionary) {
        morphs.push({ mesh, index: mesh.morphTargetDictionary.wilt })
      }
      if (!inPot(mesh)) plantMeshes.push(mesh)
      if (!inPot(mesh)) {
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of list) {
          const std = m as THREE.MeshStandardMaterial
          if (!std.color || seen.has(m) || NO_TINT.test(m.name)) continue
          seen.add(m)
          const fresh = std.color.clone()
          tint.push({ mat: std, fresh, dry: fresh.clone().multiply(DRY_TINT), dead: fresh.clone().multiply(DEAD_TINT) })
        }
      }
    }
  })

  for (const t of tips) {
    const p = petals.find((x) => x.node === t.parent)
    if (p) p.tip = bone(t)
  }
  petals.forEach((p, i) => {
    p.delay = hash(i, 1) * 0.14
    p.gain = 0.8 + hash(i, 2) * 0.4
    p.phase = hash(i, 3) * Math.PI * 2
  })

  // Rest directions in root space, measured once in the bind pose.
  root.updateWorldMatrix(true, true)
  // (head is assigned inside the traverse callback, which TS can't see.)
  foldPetals(petals, (head as Bone | null)?.node ?? null)
  const toRoot = root.getWorldQuaternion(new THREE.Quaternion()).invert()
  const aimed = (o: THREE.Object3D, i: number): Aimed => ({
    ...bone(o),
    dir: new THREE.Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(toRoot).normalize(),
    phase: hash(i, 4) * Math.PI * 2
  })
  const stemBase = new THREE.Vector3()
  root.getObjectByName(stems.find((x) => x.i === 0)?.b.node.name ?? '')?.getWorldPosition(stemBase)
  const organs: Organ[] = []
  for (const [i, p] of [...parts.entries()].sort((a, b) => a[0] - b[0])) {
    if (!p.stalk.length || (!p.pad && !p.bud)) continue
    const tipNode = (p.pad ?? p.bud)!
    const at = tipNode.getWorldPosition(new THREE.Vector3())
    const out = at.sub(stemBase).setY(0)
    out.applyQuaternion(toRoot).setY(0)
    if (out.lengthSq() < 1e-8) out.set(1, 0, 0)
    out.normalize()
    organs.push({
      stalk: p.stalk.sort((a, b) => a.k - b.k).map((x) => x.b),
      pad: p.pad ? aimed(p.pad, i) : null,
      rims: p.rims.sort((a, b) => a.k - b.k).map((r) => aimed(r.o, i * 16 + r.k)),
      bud: p.bud ? aimed(p.bud, i) : null,
      budPetals: p.bud ? budPetals(p.bud, p.budPetals, p.budTips) : [],
      out,
      attachY: 0,
      reach: 0,
      margin: 0,
      gain: 0.75 + hash(i, 5) * 0.5
    })
  }
  // Spikes and clumps (autorig v3). Rank: how high a part sits, 0 lowest.
  const rootY = (o: THREE.Object3D) => root.worldToLocal(o.getWorldPosition(new THREE.Vector3())).y
  const outFrom = (o: THREE.Object3D, dir: THREE.Vector3) => {
    const at = root.worldToLocal(o.getWorldPosition(new THREE.Vector3()))
    const base = root.worldToLocal(stemBase.clone())
    const out = at.sub(base).setY(0)
    out.add(dir.clone().setY(0).multiplyScalar(0.05))
    if (out.lengthSq() < 1e-10) out.set(1, 0, 0)
    return out.normalize()
  }
  const ranker = (ys: number[]) => {
    const lo = Math.min(...ys)
    const hi = Math.max(...ys)
    return (y: number) => (hi - lo < 1e-6 ? 0 : (y - lo) / (hi - lo))
  }
  const chains = [...branchParts.entries()].sort((a, b) => a[0] - b[0])
  const branchRank = ranker(chains.map(([, l]) => rootY(l[0].o)))
  const branches: Branch[] = chains.map(([i, list]) => {
    const bones = list.sort((a, b) => a.k - b.k).map((x) => aimed(x.o, i * 8 + x.k))
    const last = bones[bones.length - 1]
    // Furled up to at most 80% of the way to upright.
    const tilt = bones[0].dir.angleTo(new THREE.Vector3(0, 1, 0))
    return { bones, out: outFrom(last.node, last.dir), furl: 0.8 * tilt, rank: branchRank(rootY(list[0].o)), jit: hash(i, 6), gain: 0.75 + hash(i, 5) * 0.5 }
  })
  const bloomRank = ranker(bloomNodes.map((b) => rootY(b.o)))
  const crown = root.worldToLocal(stemBase.clone())
  const farOut = (o: THREE.Object3D) => root.worldToLocal(o.getWorldPosition(new THREE.Vector3())).sub(crown).setY(0).length()
  const bloomRadial = ranker([0, ...bloomNodes.map((b) => farOut(b.o))])
  const blooms: Bloom[] = bloomNodes
    .sort((a, b) => a.i - b.i)
    .map(({ i, o }) => {
      const a = aimed(o, 200 + i)
      return { ...a, out: outFrom(o, a.dir), rank: bloomRank(rootY(o)), radial: bloomRadial(farOut(o)), jit: hash(i, 10), gain: 0.75 + hash(i, 11) * 0.5, onBranch: hasNamedAncestor(o, BRANCH) }
    })
  stems.sort((a, b) => a.i - b.i)
  const plant = root.getObjectByName('plant')
  const growNode = plant && plantMeshes.some((m) => (m as THREE.SkinnedMesh).isSkinnedMesh)
    ? { node: plant, restScale: plant.scale.clone() }
    : null
  return { root, stems: stems.map((s) => s.b), head, petals, leaves, organs, branches, blooms, tint, morphs, plantMeshes, growNode, emerge: null }
}

/** Set a rig up to grow by emerging from the mud (a pot with `soil`, and
 * organs on stalks): rest heights in root space, and a clipping plane at the
 * mud for the plant's materials. Call at rest, after setStemLength. */
export function measureGrowth(rig: Rig) {
  const soil = rig.root.getObjectByName('soil')
  if (!soil || !rig.organs.length || !rig.head) return
  rig.root.updateWorldMatrix(true, true)
  const y = (o: THREE.Object3D) => rig.root.worldToLocal(o.getWorldPosition(new THREE.Vector3())).y
  const mudY = y(soil)
  // A margin above each part's top joint covers what it carries (a bud, a pad).
  const plantH = Math.max(1e-3, y(rig.head.node) - mudY)
  for (const o of rig.organs) {
    o.attachY = y(o.stalk[0].node)
    const tops = [o.pad ?? o.bud, ...o.budPetals.map((p) => p.tip ?? p)].filter(Boolean).map((b) => y(b!.node))
    o.margin = 0.12 * plantH
    o.reach = Math.max(...tops, o.attachY) - o.attachY + o.margin
  }
  const clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  for (const t of rig.tint) {
    t.mat.clippingPlanes = [clip]
    t.mat.needsUpdate = true
  }
  // The bud rides well clear above its joint: sink it deep enough that
  // nothing pokes through the mud before its stalk starts.
  rig.emerge = { mudY, stemReach: y(rig.head.node) - mudY + 0.3 * plantH, clip }
}

const _m4 = new THREE.Matrix4()
const _m3 = new THREE.Matrix3()
const _lift = new THREE.Vector3()

/** Move a node by `dy` along the root's up axis (root units), from `rest`. */
function liftFrom(rig: Rig, b: Bone, dy: number) {
  b.node.position.copy(b.restPos)
  const parent = b.node.parent
  if (!parent || Math.abs(dy) < 1e-6) return
  parent.updateWorldMatrix(true, false)
  _m4.copy(parent.matrixWorld).invert().multiply(rig.root.matrixWorld)
  b.node.position.add(_lift.set(0, dy, 0).applyMatrix3(_m3.setFromMatrix4(_m4)))
}

function budPetals(bud: THREE.Object3D, nodes: THREE.Object3D[], tips: THREE.Object3D[]): Petal[] {
  const petals: Petal[] = nodes.map((o, i) => {
    const tip = tips.find((t) => t.parent === o)
    return {
      ...bone(o),
      delay: hash(i, 7) * 0.14,
      gain: 0.8 + hash(i, 8) * 0.4,
      phase: hash(i, 9) * Math.PI * 2,
      tip: tip ? bone(tip) : null,
      close: new THREE.Vector3(1, 0, 0),
      closeAngle: 0,
      ring: 0
    }
  })
  foldPetals(petals, bud)
  return petals
}

/** How each petal folds into a closed bud: towards the flower's axis (the
 * head bone's +Y), stopping a few degrees short so the bud comes to a point,
 * outer petals wrapping the inner ones. Needs world matrices in the bind pose. */
function foldPetals(petals: Petal[], head: THREE.Object3D | null) {
  if (!petals.length) return
  const dirs = petals.map((p) => new THREE.Vector3(0, 1, 0).applyQuaternion(p.node.getWorldQuaternion(new THREE.Quaternion())))
  const axis = head
    ? new THREE.Vector3(0, 1, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()))
    : dirs.reduce((a, d) => a.add(d), new THREE.Vector3()).normalize()
  const angles = dirs.map((d) => d.angleTo(axis))
  const lo = Math.min(...angles)
  const hi = Math.max(...angles)
  petals.forEach((p, i) => {
    // 0 outermost (widest open) … 1 innermost.
    p.ring = hi - lo < 1e-3 ? 0.5 : (hi - angles[i]) / (hi - lo)
    const cone = rad(4 + 10 * (1 - p.ring))
    p.closeAngle = Math.max(0, angles[i] - cone)
    const world = new THREE.Vector3().crossVectors(dirs[i], axis)
    if (world.lengthSq() < 1e-8) world.set(1, 0, 0)
    const parentQ = p.node.parent ? p.node.parent.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion()
    p.close.copy(world.normalize()).applyQuaternion(parentQ).normalize()
  })
}

function hasNamedAncestor(o: THREE.Object3D, re: RegExp) {
  for (let p = o.parent; p; p = p.parent) if (re.test(p.name ?? '')) return true
  return false
}

function inPot(o: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (NO_TINT.test(p.name ?? '')) return true
  return false
}

/** Map a wilt value onto a part's stage. Overshoot below 0 passes through, so
 * a recovering flower briefly over-straightens. */
export function stage(w: number, [a, b]: Stage, delay = 0): number {
  if (w < 0) return w
  const from = Math.min(a + delay, b - 0.01)
  return Math.min(1, Math.max(0, (w - from) / (b - from)))
}

/** Stem bend distribution resampled to however many segments the model has. */
function bendFor(spec: number[], i: number, n: number) {
  if (n === spec.length) return spec[i]
  const total = spec.reduce((a, b) => a + b, 0)
  // Sample the cumulative curve so total bend is preserved.
  const cum = (t: number) => {
    const x = t * spec.length
    const k = Math.floor(x)
    let s = 0
    for (let j = 0; j < Math.min(k, spec.length); j++) s += spec[j]
    if (k < spec.length) s += spec[k] * (x - k)
    return s
  }
  const v = cum((i + 1) / n) - cum(i / n)
  return Number.isFinite(v) ? v : total / n
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Growth from which the plant fills out to full grown (pads, stem, the
 * side bloom); the main bloom is open by then. */
export const MATURE_FROM = 0.6

const _q = new THREE.Quaternion()
const _axis = new THREE.Vector3()
const _x = new THREE.Vector3(1, 0, 0)
const _face = new THREE.Quaternion()
const _parentQ = new THREE.Quaternion()
const _z = new THREE.Vector3(0, 0, 1)
const _up = new THREE.Vector3(0, 1, 0)
const _rootQ = new THREE.Quaternion()
const _out = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _sag = new THREE.Vector3()
const _rimAxis = new THREE.Vector3()
const rad = THREE.MathUtils.degToRad

/** Rotate a node about its own pivot around a world-space axis. Bone axes from
 * an auto-rig have arbitrary roll, so screen-space moves (towards the viewer,
 * sideways, down) are done in world space and converted into the parent's frame. */
function turnWorld(node: THREE.Object3D, worldAxis: THREE.Vector3, angle: number) {
  const parent = node.parent
  if (!parent || Math.abs(angle) < 1e-5) return
  parent.updateWorldMatrix(true, false)
  parent.getWorldQuaternion(_parentQ).invert()
  _axis.copy(worldAxis).applyQuaternion(_parentQ).normalize()
  _face.setFromAxisAngle(_axis, angle)
  node.quaternion.premultiply(_face)
}

/** The world axis that tips a direction downward when turned positively. */
function sagAxis(dirWorld: THREE.Vector3, target: THREE.Vector3) {
  target.crossVectors(_up, dirWorld)
  return target.lengthSq() < 1e-8 ? target.set(1, 0, 0) : target.normalize()
}

export function poseRig(rig: Rig, spec: WiltSpec, drive: WiltDrive, base?: THREE.Quaternion) {
  const st = spec.stages
  // Growth, from seedling to bloom: the plant rises (stem_0 scales up and
  // carries everything above it), leaves unfurl, the head swells from a bud,
  // and the petals open last.
  const g = drive.growth ?? 1
  const em = rig.emerge
  // Placeholder: the plant scales up. Real models emerge instead (below).
  const rise = em ? 1 : 0.22 + 0.78 * smooth(0, 0.8, g)
  // A young stem is short but not needle-thin: thicken it relative to height.
  const girth = Math.pow(rise, 0.45)
  // Leaves come out first, so even a seedling reads as a sprout.
  const leafOut = 0.6 + 0.4 * smooth(0, 0.5, g)
  // The pretty part comes early: the bud swells and opens, outer petals
  // first, by about 60% of the goal ("in bloom"). The rest of the way is
  // full grown: the plant fills out (`mature`) and the side bud rises and
  // opens, done at the goal.
  const headOut = em ? 0.35 + 0.65 * smooth(0.15, 0.55, g) : 0.3 + 0.7 * smooth(0.15, 0.55, g)
  const bloom = smooth(0.4, 0.62, g)
  const mature = drive.mature ?? smooth(MATURE_FROM, 1, g)
  const dead = Math.max(0, Math.min(1, drive.dead ?? 0))
  // A dead plant slumps past its fully-wilted pose.
  const slump = 1 + 0.25 * dead
  if (rig.growNode) {
    const { node, restScale } = rig.growNode
    node.scale.set(restScale.x * girth, restScale.y * rise, restScale.z * girth)
  }
  // Hiding a bone doesn't hide a skinned mesh, so hide the meshes themselves.
  for (const m of rig.plantMeshes) m.visible = !drive.empty
  const sStem = stage(drive.stem, st.stem) * slump
  _axis.set(...spec.stemAxis).normalize()
  const n = rig.stems.length
  // Full grown stands a little taller: the upper joints move apart.
  const tall = 1 + ((spec.mature?.stem ?? 1) - 1) * mature
  rig.stems.forEach((b, i) => {
    if (i >= 2) b.node.position.copy(b.restPos).multiplyScalar(tall)
    _q.setFromAxisAngle(_axis, rad(bendFor(spec.stemBend, i, n) * sStem))
    b.node.quaternion.copy(b.rest).multiply(_q)
    if (i === 0 && base) b.node.quaternion.premultiply(base)
    // A brush bends the stem more towards the top, like a reed.
    if (drive.sway) turnWorld(b.node, _z, -rad((drive.sway * 2 * (i + 1)) / (n * (n + 1))))
    if (i === 0 && !rig.growNode) b.node.scale.set(b.restScale.x * girth, b.restScale.y * rise, b.restScale.z * girth)
  })
  // Emerging: the flower stalk pushes up out of the mud after the first
  // leaves, carrying its bud; what is still below the mud is clipped away.
  const dropMain = em ? (1 - smooth(0.1, 0.5, g)) * em.stemReach : 0
  if (em) {
    rig.root.updateWorldMatrix(true, false)
    _lift.set(0, em.mudY, 0).applyMatrix4(rig.root.matrixWorld)
    em.clip.constant = -_lift.y
    if (rig.stems[0]) liftFrom(rig, rig.stems[0], -dropMain)
  }

  if (rig.head) {
    rig.head.node.position.copy(rig.head.restPos).multiplyScalar(tall)
    const sHead = stage(drive.head, st.head)
    _axis.set(...spec.headAxis).normalize()
    _q.setFromAxisAngle(_axis, rad(spec.headDroop * sHead))
    rig.head.node.quaternion.copy(rig.head.rest).multiply(_q)
    // Face the viewer once in bloom; the tilt gives way as thirst droops the head.
    const face = (spec.faceTilt ?? 0) * bloom * (1 - sHead)
    const parent = rig.head.node.parent
    if (face > 0.01 && parent) {
      parent.updateWorldMatrix(true, false)
      parent.getWorldQuaternion(_parentQ).invert()
      _axis.copy(_x).applyQuaternion(_parentQ)
      _face.setFromAxisAngle(_axis, rad(face))
      rig.head.node.quaternion.premultiply(_face)
    }
    // The bloom is heavy: it follows a brush a beat late.
    if (drive.swayLag) turnWorld(rig.head.node, _z, -rad(drive.swayLag * 0.5))
    rig.head.node.scale.copy(rig.head.restScale).multiplyScalar(headOut)
  }

  const flutter = Math.max(0, Math.min(1, drive.flutter ?? 0))
  const time = drive.time ?? 0
  posePetals(rig.petals, spec, drive.petals, bloom, flutter, time)

  const sLeaf = stage(drive.stem, st.leaves)
  const padGrow = 1 + ((spec.mature?.leaves ?? 1) - 1) * mature
  for (const l of rig.leaves) {
    _q.setFromAxisAngle(_z, -rad(spec.leafSag * sLeaf))
    l.node.quaternion.copy(l.rest).multiply(_q)
    l.node.scale.copy(l.restScale).multiplyScalar(leafOut * padGrow)
  }

  // Organs on their own stalks: pads turn their faces to the viewer and
  // spread a little; thirst bows the stalks and droops the pads and their
  // rims; a brush sways the stalks a beat behind the stem and sets the rims
  // fluttering.
  if (rig.organs.length || rig.branches.length || rig.blooms.length) rig.root.getWorldQuaternion(_rootQ)
  const sway = drive.swayLag ?? 0
  const flutterDeg = spec.flutter ?? 0
  let padIndex = 0
  for (const o of rig.organs) {
    _out.copy(o.out).applyQuaternion(_rootQ)
    const sag = sagAxis(_out, _sag)
    // Each leaf comes up in turn, rolled like a scroll, rising on its stalk
    // and unrolling into a pad; the side bloom comes up last. A part rises
    // on its own until its stalk's base is at the mud, then rides up with
    // the flower stalk it joins.
    const start = o.bud ? 0.55 : 0.05 * padIndex++
    let up = 1
    if (em && o.bud) up = smooth(start, start + 0.3, g)
    else if (em) {
      // A leaf's tip breaks the mud the moment it starts, then it rises fast
      // and slows as it reaches its height (ease-out), so even the first sip
      // shows a shoot.
      const t = Math.min(1, Math.max(0, (g - start) / 0.28))
      const u0 = o.margin / Math.max(1e-3, Math.max(0, o.attachY - em.mudY) + o.reach)
      up = g < start ? 0 : u0 + (1 - u0) * (1 - (1 - t) ** 2)
    }
    const roll = em && !o.bud ? 1 - smooth(start + 0.1, start + 0.34, g) : 0
    const out = em ? smooth(start, start + 0.45, g) : leafOut
    if (em) {
      const below = Math.max(0, o.attachY - em.mudY)
      const own = (1 - up) * (below + o.reach)
      // The side bud comes up after the flower stalk, so it sinks on its own.
      const drop = o.bud ? own : Math.min(dropMain, Math.max(below, own))
      liftFrom(rig, o.stalk[0], dropMain - drop)
    }
    o.stalk.forEach((b, k) => {
      b.node.quaternion.copy(b.rest)
      const lean = k === 0 ? ((spec.stalkSpread ?? 0) + (o.bud ? spec.budSpread ?? 0 : 0)) * out : 0
      turnWorld(b.node, sag, rad(lean + ((spec.stalkSag ?? 0) * sLeaf * (k + 1)) / o.stalk.length))
      turnWorld(b.node, _z, -rad(sway * o.gain * (k === 0 ? 0.35 : 0.7)))
    })
    if (o.pad) {
      const { node, rest, restScale } = o.pad
      node.quaternion.copy(rest)
      turnWorld(node, _x, rad((spec.leafFace ?? 0) * (1 - 0.6 * sLeaf)))
      // A rolled young leaf stands up; unrolling, it lies back into a pad.
      turnWorld(node, sag, rad((spec.leafSpread ?? 0) + spec.leafSag * sLeaf - 60 * roll))
      node.scale.copy(restScale).multiplyScalar((em ? 0.35 + 0.65 * out : leafOut) * padGrow)
    }
    o.rims.forEach((r) => {
      r.node.quaternion.copy(r.rest)
      _dir.copy(r.dir).applyQuaternion(_rootQ)
      const shiver = flutterDeg * 1.4 * flutter * o.gain * Math.sin(time * 8 + r.phase)
      // Rolled, the rims curl up and in over the pad.
      turnWorld(r.node, sagAxis(_dir, _rimAxis), rad((spec.leafCurl ?? 0) * sLeaf + shiver - 85 * roll))
    })
    if (o.bud) {
      const { node, rest } = o.bud
      node.quaternion.copy(rest)
      turnWorld(node, sag, rad(spec.headDroop * 0.5 * sLeaf))
      turnWorld(node, _z, -rad(sway * o.gain * 0.8))
      // A small bloom: shut and swelling while the plant grows, opening when
      // full grown.
      if (o.budPetals.length) {
        const open = smooth(0.3, 1, mature)
        const s = (spec.budSize ?? 0.72) + (1 - (spec.budSize ?? 0.72)) * open
        node.scale.copy(o.bud.restScale).multiplyScalar(s * (em ? 0.4 + 0.6 * out : 0.55 + 0.45 * headOut))
        posePetals(o.budPetals, spec, drive.petals, open, flutter, time + 1.7)
      }
    }
  }

  poseClump(rig, spec, drive, g, sLeaf, flutter, time)

  const c = Math.max(0, stage(drive.stem, st.color))
  for (const t of rig.tint) t.mat.color.copy(t.fresh).lerp(t.dry, c).lerp(t.dead, dead)

  const m = Math.max(0, Math.min(1, drive.stem))
  for (const { mesh, index } of rig.morphs) {
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = m
  }
}

/** Spikes and clumps (autorig v3). Growing, the branches unfurl from the
 * crown in turn (lower ones first) and fill out; the flowers come up as shut
 * buds, then open one after another (bottom up on a spike, scattered on a
 * bush). Thirsty, the branches bow outward and the flowers nod and shrink. */
function poseClump(rig: Rig, spec: WiltSpec, drive: WiltDrive, g: number, sLeaf: number, flutter: number, time: number) {
  if (!rig.branches.length && !rig.blooms.length) return
  const sway = drive.swayLag ?? 0
  const br = spec.branch ?? { sag: 20, furl: 50, stagger: 0.3, grow: 0.4 }
  for (const b of rig.branches) {
    _out.copy(b.out).applyQuaternion(_rootQ)
    const sag = sagAxis(_out, _sag)
    const t0 = (0.7 * b.rank + 0.3 * b.jit) * br.stagger
    const open = smooth(t0, t0 + 0.5, g)
    const n = b.bones.length
    b.bones.forEach((x, k) => {
      x.node.quaternion.copy(x.rest)
      const furl = k === 0 ? -Math.min(b.furl, rad(br.furl)) * (1 - open) : -rad(br.furl * 0.4) * (1 - open)
      turnWorld(x.node, sag, furl + rad((br.sag * sLeaf * b.gain) / n))
      turnWorld(x.node, _z, -rad(sway * b.gain * (k === 0 ? 0.3 : 0.6)))
      if (k === 0) x.node.scale.copy(x.restScale).multiplyScalar((1 - br.grow * (1 - open)) * (br.scale ?? 1))
    })
  }
  const bl = spec.bloom ?? { from: 0.4, span: 0.28, stagger: 0.22, up: false, bud: [0.35, 0.6] }
  const sHead = stage(drive.head, spec.stages.head)
  const sPet = stage(drive.petals, spec.stages.petals)
  for (const b of rig.blooms) {
    // Bottom up on a spike, from the middle out over a carpet, else scattered.
    const order = bl.outward ? 0.8 * b.radial + 0.2 * b.jit : bl.up ? 0.85 * b.rank + 0.15 * b.jit : 0.3 * b.rank + 0.7 * b.jit
    // The bud swells over the quarter of the growth before it opens.
    const t0 = bl.from + order * bl.stagger
    const bud = smooth(t0 - 0.25, t0 - 0.03, g)
    const open = smooth(t0, t0 + bl.span, g)
    const { node, rest, restScale } = b
    node.quaternion.copy(rest)
    _out.copy(b.out).applyQuaternion(_rootQ)
    // A shut bud points up out of its stalk a little more; thirsty, it nods.
    turnWorld(node, sagAxis(_out, _sag), rad(spec.headDroop * 0.6 * sHead * b.gain - 12 * (1 - open)))
    const shiver = (spec.flutter ?? 0) * flutter * b.gain * Math.sin(time * 9 + b.phase)
    turnWorld(node, _z, -rad(sway * b.gain * 0.8 + shiver * 0.3))
    const dry = 1 + (spec.petalShrink - 1) * Math.max(0, sPet)
    // The branches can be drawn smaller (branch.scale); a flower on one keeps
    // its own size (bloom.size of the model's).
    const full = (bl.size ?? 1) / (b.onBranch ? br.scale ?? 1 : 1)
    const across = Math.max(1e-3, bud * (bl.bud[0] + (full - bl.bud[0]) * open) * dry)
    const along = Math.max(1e-3, bud * (bl.bud[1] + (full - bl.bud[1]) * open) * dry)
    node.scale.set(restScale.x * across, restScale.y * along, restScale.z * across)
  }
}

/** Petals from closed bud (bloom 0) to open (1), then wilting. Outer petals
 * open first; with a tip bone the wilt curl is shared: the base hinges, the
 * tip rolls over. */
function posePetals(petals: Petal[], spec: WiltSpec, wilt: number, bloom: number, flutter: number, time: number) {
  const flutterDeg = spec.flutter ?? 0
  for (const p of petals) {
    const s = stage(wilt, spec.stages.petals, p.delay)
    const curl = spec.petalCurl * p.gain * s
    const open = smooth(0.3 * p.ring, 0.7 + 0.3 * p.ring, bloom)
    _q.setFromAxisAngle(_x, rad(p.tip ? curl * 0.55 : curl))
    p.node.quaternion.copy(p.rest).multiply(_q)
    _face.setFromAxisAngle(p.close, p.closeAngle * (1 - open))
    p.node.quaternion.premultiply(_face)
    if (p.tip) {
      const shiver = flutterDeg * flutter * Math.sin(time * 11 + p.phase)
      _q.setFromAxisAngle(_x, rad(curl * 0.8 + shiver))
      p.tip.node.quaternion.copy(p.tip.rest).multiply(_q)
    }
    const shrink = 1 + (spec.petalShrink - 1) * Math.max(0, s)
    const size = 0.72 + 0.28 * open
    p.node.scale.set(p.restScale.x * size, p.restScale.y * shrink * size, p.restScale.z * size)
  }
}



/** Change the stem's length by moving its upper joints (stem_2 up, and the
 * head) along their parents, and a bud's stalk by moving its middle joint.
 * Shortened segments overlap and lengthened ones stretch between joints, so
 * the stem keeps its thickness and the bloom and bud their size. */
export function setStemLength(rig: Rig, stem: number, bud: number) {
  if (stem !== 1) {
    rig.stems.forEach((b, i) => {
      if (i >= 2) b.restPos.copy(b.node.position.multiplyScalar(stem))
    })
    if (rig.head) rig.head.restPos.copy(rig.head.node.position.multiplyScalar(stem))
  }
  if (bud !== 1)
    for (const o of rig.organs) {
      if (!o.bud) continue
      if (o.stalk[1]) o.stalk[1].restPos.copy(o.stalk[1].node.position.multiplyScalar(bud))
    }
}
