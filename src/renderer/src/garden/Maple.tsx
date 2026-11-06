import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { heightAt, MAPLE, mulberry, SUN } from './layout'
import { shared, wash, WIND } from './paint'

// The maple over the back of the lawn: a few thousand small star-shaped leaf
// cards laid on flat layered plates, lit from the sun's side so light comes
// through the top and the inside stays deep. Its shade on the lawn is in the
// sun map (dapple.ts). Now and then a leaf lets go and drifts down.
//
// It moves in the wind as one tree, all in the vertex shader (no CPU per
// frame): the whole canopy leans with the gust and rocks back, each branch
// flexes from the fork with a phase of its own, more the further out it
// reaches, and the hanging sprays swing most at their tips. The bark runs the
// same sway, so limbs carry their leaves. Driven by the wind dial; reduced
// motion stands it still.

const LEAVES_PER_PLATE = 750
const FALLING = 28
/** Sprays hanging under each layer's rim, and leaves in each. */
const SPRAYS = 16
const PER_SPRAY = 22

const calm = matchMedia('(prefers-reduced-motion: reduce)')
/** Where the limbs leave the trunk. */
const FORK = new THREE.Vector3(MAPLE.trunk[0] + 0.9, 4.4, MAPLE.trunk[1] + 0.8)
/** 1 swaying, 0 still (reduced motion). */
const swayOn = { value: 1 }

/** The sway, in world units, of a point of the tree: `phase` its branch's
 * (0..1), `tip` how far down a hanging spray (0..1), `branch` 1 above the fork. */
const SWAY = /* glsl */ `
${WIND}
uniform float uMapleSway;
attribute vec3 aSway;
vec3 mapleSway(vec3 p, float phase, float tip, float branch) {
  float t = uTime;
  // The way the gusts push the meadow's grass (Lawn.tsx).
  vec3 dir = normalize(vec3(1.0, 0.0, 0.35));
  float gust = windAt(vec2(${MAPLE.trunk[0].toFixed(2)}, ${MAPLE.trunk[1].toFixed(2)}), t);
  // The whole tree leans with the gust and rocks back as it eases, more the higher up.
  float h = clamp(p.y / ${FORK.y.toFixed(2)}, 0.0, 2.2);
  float lean = (gust * 0.5 + 0.08 * uWind * sin(t * 0.7 + 0.5)) * h * h * 0.035;
  // Each branch flexes from the fork, out of step with the others.
  float reach = clamp(length(p.xz - vec2(${FORK.x.toFixed(2)}, ${FORK.z.toFixed(2)})) / 9.0, 0.0, 1.3) * branch;
  float flex = windAt(p.xz, t - 0.6 - phase * 0.8) * 0.55 + uWind * 0.16 * sin(t * 1.1 + phase * 6.2832);
  vec3 off = dir * lean + (dir - vec3(0.0, 0.25, 0.0)) * flex * reach * reach * 0.22;
  // The hanging sprays swing on their own, most at the bottom.
  float swing = sin(t * 1.7 + phase * 6.2832 + p.y * 0.9) * (0.3 + 0.7 * gust);
  off += (dir * swing + vec3(-dir.z, 0.0, dir.x) * 0.4 * cos(t * 1.3 + phase * 4.0)) * tip * tip * 0.09 * uWind;
  return off * uMapleSway;
}`

/** Undo a matrix's rotation and uniform scale: world offset into its own space. */
const intoLocal = (m: string, off: string) => `transpose(mat3(${m})) * ${off} / dot(${m}[0].xyz, ${m}[0].xyz)`
const sun = new THREE.Vector3(...SUN).normalize()
const DEEP = new THREE.Color('#2f5a26')
const MID = new THREE.Color('#5f9a33')
const LIT = new THREE.Color('#c4e070')
const TURNED = [new THREE.Color('#d9a441'), new THREE.Color('#c8643a'), new THREE.Color('#9fbf4a')]

/** One leaf: seven pointed lobes round a stalk at the bottom, cut from a card. */
const LEAF = {
  vertexHead: /* glsl */ `varying vec2 vLeaf;`,
  vertex: /* glsl */ `vLeaf = uv;`,
  head: /* glsl */ `varying vec2 vLeaf;`,
  fragment: /* glsl */ `
    vec2 q = vLeaf - vec2(0.5, 0.42);
    float a = atan(q.x, q.y);
    float lobe = pow(0.5 + 0.5 * cos(a * 7.0), 1.6);
    float r = (0.17 + 0.29 * lobe) * smoothstep(3.1, 2.3, abs(a));
    if (length(q) > r) discard;`,
  // Light through the leaves: a glow of their own colour, so the canopy
  // reads as lit from above rather than a dark mass.
  after: /* glsl */ `outgoingLight += diffuseColor.rgb * 0.22;`,
  // Leaves are above their own shade; the sun map would darken them.
  shade: [
    [1, 1, 1],
    [1, 1, 1]
  ] as [number[], number[]]
}

function leafMaterial(sway = false) {
  if (!sway) return wash('#ffffff', { key: 'maple-leaf', ...LEAF }, { side: THREE.DoubleSide })
  return wash(
    '#ffffff',
    {
      key: 'maple-leaf-sway',
      ...LEAF,
      vertexHead: `${LEAF.vertexHead}\n${SWAY}`,
      // Each card moves whole, from where it hangs, with a little flutter of its own.
      vertex: /* glsl */ `${LEAF.vertex}
        vec3 at = instanceMatrix[3].xyz;
        vec3 off = mapleSway(at, aSway.x, aSway.y, 1.0);
        off.y += sin(uTime * 4.3 + aSway.x * 40.0 + at.x * 3.0) * 0.012 * uWind * uMapleSway;
        transformed += ${intoLocal('instanceMatrix', 'off')};`,
      uniforms: { uMapleSway: swayOn }
    },
    { side: THREE.DoubleSide }
  )
}

type Plate = (typeof MAPLE.plates)[number]

/** A random point in a plate, mostly near its upper skin; returns how much it faces the sun. */
function inPlate(rnd: () => number, plate: Plate, out: THREE.Vector3) {
  const a = rnd() * Math.PI * 2
  // Upper half mostly: a plate is a domed layer, not a ball.
  const y = Math.pow(rnd(), 0.6) * 1.3 - 0.45
  const s = Math.sqrt(Math.max(0, 1 - y * y)) * (0.55 + Math.sqrt(rnd()) * 0.45)
  out.set(Math.cos(a) * s, y, Math.sin(a) * s)
  const lit = out.clone().normalize().dot(sun)
  // Droop at the rim: the tips of each layer hang a little.
  out.y -= s * s * 0.5
  out.set(out.x * plate.r[0] + plate.at[0], out.y * plate.r[1] + plate.at[1], out.z * plate.r[2] + plate.at[2])
  return lit
}

function canopy() {
  const rnd = mulberry(91)
  const count = MAPLE.plates.length * (LEAVES_PER_PLATE + SPRAYS * PER_SPRAY)
  const geo = new THREE.PlaneGeometry(1, 1)
  // Per leaf: its branch's phase, how far down a hanging spray it is.
  const sway = new Float32Array(count * 3)
  geo.setAttribute('aSway', new THREE.InstancedBufferAttribute(sway, 3))
  const mesh = new THREE.InstancedMesh(geo, leafMaterial(true), count)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const p = new THREE.Vector3()
  const c = new THREE.Color()
  const top = Math.max(...MAPLE.plates.map((pl) => pl.at[1]))
  let i = 0
  for (const [n, plate] of MAPLE.plates.entries()) {
    const phase = phaseOf(n)
    // Lower layers sit in the shade of the ones above.
    const under = 1 - Math.min(1, (top - plate.at[1]) / 3.5) * 0.35
    for (let j = 0; j < LEAVES_PER_PLATE; j++) {
      const lit = inPlate(rnd, plate, p)
      // Faces the open side (the camera looks in low, so flat-lying leaves
      // would show edge-on), tipped every which way, spun round its stalk.
      e.set(-0.35 + (rnd() - 0.5) * 1.3, (rnd() - 0.5) * 1.1, rnd() * Math.PI * 2)
      q.setFromEuler(e)
      const s = 0.3 + rnd() * 0.16
      m.compose(p, q, new THREE.Vector3(s, s, s))
      mesh.setMatrixAt(i, m)
      sway[i * 3] = phase
      const t = THREE.MathUtils.clamp(0.5 + lit * 0.6 + (rnd() - 0.5) * 0.35, 0, 1) * under
      c.copy(DEEP).lerp(MID, Math.min(1, t * 1.6)).lerp(LIT, Math.max(0, t * 1.6 - 0.6))
      mesh.setColorAt(i, c)
      i++
    }
    // Sprays: from points round the rim, leaves cascade down and outwards,
    // so the layer's lower edge hangs ragged instead of flat.
    for (let k = 0; k < SPRAYS; k++) {
      const a = rnd() * Math.PI * 2
      const rim = 0.7 + rnd() * 0.3
      const drop = 0.7 + rnd() * 1.3
      const x0 = plate.at[0] + Math.cos(a) * rim * plate.r[0]
      const z0 = plate.at[2] + Math.sin(a) * rim * plate.r[2]
      const y0 = plate.at[1] - plate.r[1] * 0.4
      for (let j = 0; j < PER_SPRAY; j++) {
        const t = j / PER_SPRAY
        const out = 0.35 * t
        p.set(
          x0 + Math.cos(a) * out + (rnd() - 0.5) * 0.45 * (1 - t * 0.5),
          y0 - drop * t * t - rnd() * 0.15,
          z0 + Math.sin(a) * out + (rnd() - 0.5) * 0.45 * (1 - t * 0.5)
        )
        e.set(-0.2 + (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2, rnd() * Math.PI * 2)
        q.setFromEuler(e)
        const sz = (0.3 + rnd() * 0.14) * (1 - t * 0.35)
        m.compose(p, q, new THREE.Vector3(sz, sz, sz))
        mesh.setMatrixAt(i, m)
        sway[i * 3] = phase
        // The longer the spray, the more its tip swings.
        sway[i * 3 + 1] = t * Math.min(1, drop / 1.4)
        // Hanging tips catch the light on their outer side.
        const lit = 0.35 + 0.4 * Math.max(0, Math.cos(a) * -sun.x + Math.sin(a) * -sun.z) + (rnd() - 0.5) * 0.3
        c.copy(DEEP).lerp(MID, Math.min(1, lit * 1.6)).lerp(LIT, Math.max(0, lit * 1.6 - 0.75))
        mesh.setColorAt(i, c)
        i++
      }
    }
  }
  return mesh
}

/** A branch's phase, the same for its limb and its leaves. */
const phaseOf = (n: number) => (n * 0.618) % 1

/** Trunk and limbs: tapered dark strokes from the ground to each plate. */
function limbs() {
  const group = new THREE.Group()
  // The bark bends with the same sway, per vertex: the trunk leans from the
  // ground, limbs flex from the fork. Roots stay put.
  const bark = wash('#3a2c22', {
    key: 'maple-bark-sway',
    vertexHead: SWAY,
    vertex: /* glsl */ `
      vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vec3 off = mapleSway(wp, aSway.x, 0.0, aSway.z) * aSway.y;
      transformed += ${intoLocal('modelMatrix', 'off')};`,
    uniforms: { uMapleSway: swayOn }
  })
  /** Every vertex of a piece: its branch's phase, whether it sways, whether it flexes as a branch. */
  const tag = (geo: THREE.BufferGeometry, phase: number, moves: number, branch: number) => {
    const n = geo.getAttribute('position').count
    const a = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) a.set([phase, moves, branch], k * 3)
    geo.setAttribute('aSway', new THREE.BufferAttribute(a, 3))
  }
  const [tx, tz] = MAPLE.trunk
  // The lawn draws no depth, so nothing may reach below the grass: the trunk
  // stands on it, flares out, and its roots run over it and taper away.
  const base = new THREE.Vector3(tx, heightAt(tx, tz), tz)
  const fork = FORK.clone()
  const limb = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, sway = { phase: 0, moves: 1, branch: 0 }) => {
    const len = from.distanceTo(to)
    // Rings along it, so it can bend rather than tilt.
    const geo = new THREE.CylinderGeometry(r1, r0, len, 7, sway.moves ? 6 : 1)
    geo.translate(0, len / 2, 0)
    tag(geo, sway.phase, sway.moves, sway.branch)
    const mesh = new THREE.Mesh(geo, bark)
    mesh.position.copy(from)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
    group.add(mesh)
  }
  limb(base, fork, 0.34, 0.2)
  // The flare: a short cone, wide on the ground.
  const flare = new THREE.CylinderGeometry(0.34, 0.66, 0.6, 9, 1)
  flare.translate(0, 0.3, 0)
  tag(flare, 0, 1, 0)
  const foot = new THREE.Mesh(flare, bark)
  foot.position.copy(base)
  group.add(foot)
  // Roots out over the grass, mostly towards the open lawn.
  const rnd = mulberry(17)
  for (let k = 0; k < 6; k++) {
    const a = -1.2 + k * 0.62 + (rnd() - 0.5) * 0.3
    const len = 0.9 + rnd() * 0.9
    const from = new THREE.Vector3(base.x + Math.cos(a) * 0.3, base.y + 0.28, base.z + Math.sin(a) * 0.3)
    const ex = base.x + Math.cos(a) * len
    const ez = base.z + Math.sin(a) * len
    const to = new THREE.Vector3(ex, heightAt(ex, ez) + 0.02, ez)
    const mid = from.clone().lerp(to, 0.45)
    mid.y = Math.max(mid.y - 0.12, heightAt(mid.x, mid.z) + 0.06)
    const still = { phase: 0, moves: 0, branch: 0 }
    limb(from, mid, 0.17, 0.1, still)
    limb(mid, to, 0.1, 0.015, still)
  }
  for (const [n, plate] of MAPLE.plates.entries()) {
    const end = new THREE.Vector3(plate.at[0], plate.at[1] - plate.r[1] * 0.6, plate.at[2])
    const mid = fork.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.5, 0))
    const branch = { phase: phaseOf(n), moves: 1, branch: 1 }
    limb(fork, mid, 0.2, 0.12, branch)
    limb(mid, end, 0.12, 0.04, branch)
  }
  return group
}

/** Leaves that let go: each falls, twirling and drifting with the wind,
 * lies on the grass a moment, and is gone. */
function falling() {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), leafMaterial(), FALLING)
  mesh.frustumCulled = false
  const rnd = mulberry(5)
  const leaves = Array.from({ length: FALLING }, (_, i) => {
    mesh.setColorAt(i, rnd() < 0.55 ? TURNED[i % TURNED.length] : MID)
    return { period: 10 + rnd() * 9, off: rnd() * 30, spin: 1.5 + rnd() * 2, size: 0.24 + rnd() * 0.1 }
  })
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  // Where a leaf is `t` seconds after letting go from `from`.
  const drift = (from: THREE.Vector3, t: number, i: number): [number, number] => [
    from.x + t * 0.32 + Math.sin(t * 1.3 + i) * 0.45,
    from.z + t * 0.16 + Math.sin(t * 0.9 + i * 2) * 0.3
  ]
  const update = (time: number) => {
    leaves.forEach((f, i) => {
      const cycle = Math.floor((time + f.off) / f.period)
      const t = time + f.off - cycle * f.period
      // A new place to fall from each time round.
      const pick = mulberry(i * 977 + cycle * 31)
      const plate = MAPLE.plates[Math.floor(pick() * MAPLE.plates.length)]
      inPlate(pick, plate, p)
      p.y -= plate.r[1] * 0.5
      // Lands where the ground is under it when it gets that low, and stays.
      const landT = Math.max(0, p.y - heightAt(...drift(p, (p.y - 0.5) / 0.85, i))) / 0.85
      const tt = Math.min(t, landT)
      const [x, z] = drift(p, tt, i)
      const down = t >= landT
      p.set(x, down ? heightAt(x, z) + 0.03 : p.y - tt * 0.85, z)
      if (down) e.set(-Math.PI / 2, 0, i)
      else e.set(Math.sin(t * f.spin) * 1.2 - 0.6, t * f.spin * 0.7, Math.cos(t * f.spin * 0.8) * 0.9)
      q.setFromEuler(e)
      const shown = THREE.MathUtils.clamp((f.period - t) / 1.5, 0, 1) * THREE.MathUtils.clamp(t / 0.6, 0, 1)
      s.setScalar(f.size * shown)
      m.compose(p, q, s)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
  }
  return { mesh, update }
}

export function Maple() {
  const leaves = useMemo(canopy, [])
  const wood = useMemo(limbs, [])
  const drift = useMemo(falling, [])
  useFrame(() => {
    swayOn.value = calm.matches ? 0 : 1
    // With reduced motion the clock stands still: no leaf hangs frozen mid-air.
    drift.mesh.visible = !calm.matches
    if (drift.mesh.visible) drift.update(shared.uTime.value)
  })
  return (
    <>
      <primitive object={wood} />
      <primitive object={leaves} />
      <primitive object={drift.mesh} />
    </>
  )
}
