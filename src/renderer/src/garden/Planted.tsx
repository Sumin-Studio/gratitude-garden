import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { loadFlower } from '../flowers/models'
import { poseRig } from '../flowers/rig'
import { potCut } from '../flowers/watercolour'
import { FLOWER_SPECS } from '../flowers/specs'
import { character, groundOf, heightAt, mulberry, WATER_Y, type Slot } from './layout'
import { bladeMaterial, bladeStroke, normalAt } from './Lawn'
import { paint, shared, tune, wash, WIND, type PaintOptions } from './paint'
import type { FlowerId } from '../../../shared/diary'
import type { GardenFlower } from './types'

// The planted flowers: lotuses in the pond, blossom, chrysanthemum and shrub
// in the grass. Each is its real model, rigged and posed at full growth once,
// then frozen: its skinning is baked into plain geometry, so thirty flowers are
// one instanced draw per part instead of thirty skinned meshes. Planted out,
// a lotus has no pot: only the plant is kept, standing straight in the grass.
// It moves by its own rig: the same poseRig the pad uses is run at the far end of
// a gust, once for the stem and once for what trails behind it (pads, stalks and
// bloom), and again for its flutter, where every petal tip and leaf rim has its
// own phase. Those bone-driven poses are stored per vertex; each flower replays
// them on the grass's wind, so its parts move separately, not as one shape.

type Part = { geometry: THREE.BufferGeometry; material: THREE.Material }

/** The plant stands in the water on its stem: its root is this far under it. */
const SINK = 0.5
/** In the grass, the root sits just under the surface. */
const LAND_SINK = 0.16
/** A ground cover sits on the lawn, not in it: its mat would vanish. */
const SINK_OF: Partial<Record<FlowerId, number>> = { daisy: 0.03, nemophila: 0.03 }

/** Degrees of the rig's brush bend at the height of a gust. */
const GUST_DEG = 20

const SWAY = /* glsl */ `
  vec3 at = instanceMatrix[3].xyz;
  // Exactly the grass's wind, at this spot; the rig's trailing parts lag it.
  float gust = windAt(at.xz, uTime) - 0.2;
  // Each leaf and stalk catches it at its own moment.
  float trail = windAt(at.xz, uTime - 0.3 - aPart * 1.1) - 0.2;
  // The rig's flutter: every petal tip and leaf rim on its own phase, stronger
  // in a gust. Two baked moments of its cycle, a quarter apart, replay it.
  float beat = uTime * 2.3 + fract(at.x * 0.73 + at.z * 0.41) * 6.28;
  float flutter = 0.7 + 1.3 * windAt(at.xz, uTime - 0.2);
  // Between gusts the air never quite stops: each flower, and each leaf on
  // it, keeps a slow sway at its own tempo, so nothing ever stands still.
  float tempo = 0.8 + fract(at.x * 0.31 + at.z * 0.17) * 0.5;
  float idle = (sin(uTime * tempo + at.z * 2.0) * 0.26 + sin(uTime * tempo * 1.9 + at.x) * 0.1) * uWind;
  float idleTrail = sin(uTime * (0.9 + aPart * 0.6) + aPart * 6.28 + at.x) * 0.3 * uWind;
  transformed += aStemPose * (gust + idle + aCharacter.y) + aTrailPose * (trail + idleTrail) + aBudPose * aCharacter.x
    + (aFlutterA * cos(beat) + aFlutterB * sin(beat)) * flutter
    // Carried and put down, it swings on its own momentum (Planted's springs).
    + aStemPose * aSwing.x + aTrailPose * aSwing.y;`

/** Where every vertex is right now, in the root's frame. */
function skinned(mesh: THREE.SkinnedMesh) {
  const pos = mesh.geometry.getAttribute('position')
  const out = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  mesh.skeleton.update()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    mesh.applyBoneTransform(i, v).applyMatrix4(mesh.matrixWorld).toArray(out, i * 3)
  }
  return out
}

function bake(mesh: THREE.SkinnedMesh) {
  const src = mesh.geometry
  const pos = src.getAttribute('position')
  const normal = src.getAttribute('normal')
  const out = skinned(mesh)
  const outNormal = new Float32Array(pos.count * 3)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    a.fromBufferAttribute(pos, i)
    n.fromBufferAttribute(normal, i)
    b.copy(a).addScaledVector(n, 0.01)
    mesh.applyBoneTransform(i, a).applyMatrix4(mesh.matrixWorld)
    mesh.applyBoneTransform(i, b).applyMatrix4(mesh.matrixWorld)
    b.sub(a).normalize().toArray(outNormal, i * 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(outNormal, 3))
  // Untextured models (iris, lily) are painted by vertex colour and have no
  // use for uvs, which would put them over the 16 attributes a shader gets.
  const textured = Boolean((mesh.material as THREE.MeshStandardMaterial).map)
  for (const name of [textured ? 'uv' : 'color', 'wcPart']) {
    const attr = src.getAttribute(name)
    if (attr) geo.setAttribute(name, attr)
  }
  geo.setAttribute('aPart', new THREE.BufferAttribute(partPhases(mesh), 1))
  geo.setIndex(src.getIndex())
  return geo
}

/** 0..1 per vertex, different for each leaf, stalk and bud: from the number in
 * the name of the bone that mostly moves it. */
function partPhases(mesh: THREE.SkinnedMesh) {
  const part = mesh.skeleton.bones.map((b) => {
    const n = /^(?:leaf|stalk|bud)[_.\- ]?(\d+)/i.exec(b.name)?.[1]
    return n === undefined ? 0 : (Number(n) * 0.618 + 0.2) % 1
  })
  const idx = mesh.geometry.getAttribute('skinIndex')
  const wt = mesh.geometry.getAttribute('skinWeight')
  const out = new Float32Array(idx.count)
  for (let i = 0; i < idx.count; i++) {
    let best = 0
    for (let k = 1; k < 4; k++) if (wt.getComponent(i, k) > wt.getComponent(i, best)) best = k
    out[i] = part[idx.getComponent(i, best)]
  }
  return out
}

/** One rig pose, stored on the geometry as offsets from the rest pose. */
function storePose(mesh: THREE.SkinnedMesh, geo: THREE.BufferGeometry, name: string) {
  const posed = skinned(mesh)
  const rest = geo.getAttribute('position').array
  for (let i = 0; i < posed.length; i++) posed[i] -= rest[i]
  geo.setAttribute(name, new THREE.BufferAttribute(posed, 3))
}

const LOTUS: PaintOptions = {
  key: 'lotus',
            vertexHead: `${WIND}\nattribute vec3 aStemPose;\nattribute vec3 aTrailPose;\nattribute vec4 aBud;\n#define aBudPose aBud.xyz\n#define aPart aBud.w\nattribute vec3 aFlutterA;\nattribute vec3 aFlutterB;\nattribute vec2 aCharacter;\nattribute vec2 aSwing;`,
            vertex: SWAY,
            // The stem stops at the surface.
            head: `const float WATER = ${WATER_Y.toFixed(3)};`,
            fragment: 'if (vGw.y < WATER) discard;',
            fog: 0.35,
            shade: [
              [0.96, 0.94, 0.95],
              [1.03, 1.02, 1.0]
            ],
            // Gouache colour for the open garden: coral petals going plum in
            // their shadows, pads a fresh lime-emerald.
            after: /* glsl */ `{
              vec3 c = outgoingLight;
              float lum = dot(c, vec3(0.3, 0.59, 0.11));
              float pink = smoothstep(0.015, 0.12, c.r - c.g);
              float green = smoothstep(0.01, 0.08, c.g - c.r);
              c = mix(c, c * vec3(1.0, 0.62, 0.66), pink * 0.78);
              c = mix(c, c * vec3(0.78, 0.52, 0.7), pink * 0.8 * (1.0 - smoothstep(0.25, 0.7, lum)));
              c = mix(c, c * vec3(0.7, 1.05, 0.62), green);
              outgoingLight = c;
            }`
          }

/** Flowers in the grass: the same wind and rig, nothing cut at the water, and
 * coloured the lotus's way: clean, bright colour from the flower's own albedo
 * (not the lit result, which goes muddy), a touch more vivid, graded across
 * each petal from pale where it faces you to rich at its rims, with only a
 * light hint of shade. Leaves take the lotus's fresh greens. */
const PLANT: PaintOptions = {
  ...LOTUS,
  key: 'plant',
  head: undefined,
  fragment: undefined,
  after: /* glsl */ `{
    vec3 albedo = diffuseColor.rgb;
    float aLum = dot(albedo, vec3(0.3, 0.59, 0.11));
    // How lit this spot is, relative to its colour: kept as a light hint only.
    float lit = clamp(dot(outgoingLight, vec3(0.3, 0.59, 0.11)) / max(aLum, 1e-3), 0.0, 2.0);
    float green = smoothstep(0.01, 0.08, albedo.g - max(albedo.r, albedo.b));
    float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
    // Petals: vivid, pale towards where they face you, deepest at the rims.
    vec3 vivid = clamp(mix(vec3(aLum), albedo, 1.35) * 1.12, 0.0, 1.0);
    vec3 pale = mix(vivid, vec3(1.0, 0.97, 0.96), 0.5);
    vec3 petal = mix(vivid, pale, smoothstep(0.35, 0.95, facing));
    petal *= 0.88 + 0.14 * smoothstep(0.2, 1.4, lit);
    // Leaves: the lotus's lime-emerald, flat and fresh.
    vec3 leaf = albedo * vec3(0.78, 1.12, 0.66) * (0.82 + 0.26 * smoothstep(0.2, 1.4, lit));
    outgoingLight = mix(petal, leaf, green);
  }`
}

const baked = new Map<FlowerId, Promise<Part[]>>()

function bakeFlower(kind: FlowerId) {
  const known = baked.get(kind)
  if (known) return known
  const made = loadFlower(kind).then(({ rig }) => {
    const spec = FLOWER_SPECS[kind]
    // No pot, so nothing for the plant to be hidden behind (watercolour.ts).
    potCut.lip.value = -100
    rig.root.updateMatrixWorld(true)
    const pose = (sway: number, swayLag: number) => {
      poseRig(rig, spec.wilt, { stem: 0, head: 0, petals: 0, growth: 1, mature: 1, time: 0, sway, swayLag })
      rig.root.updateMatrixWorld(true)
    }
    pose(0, 0)
    const parts: Part[] = []
    const meshes: { mesh: THREE.SkinnedMesh; geometry: THREE.BufferGeometry }[] = []
    const seen = new Set<THREE.Material>()
    rig.root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh || !mesh.visible) return
      const material = mesh.material as THREE.MeshStandardMaterial
      if (!seen.has(material)) {
        seen.add(material)
        // The rig's clip plane is at the mud of the one flower at the origin.
        material.clippingPlanes = []
        paint(material, kind === 'lotus' ? LOTUS : PLANT, true)
      }
      const geometry = bake(mesh)
      meshes.push({ mesh, geometry })
      parts.push({ geometry, material })
    })
    pose(GUST_DEG, 0)
    for (const { mesh, geometry } of meshes) storePose(mesh, geometry, 'aStemPose')
    pose(0, GUST_DEG)
    for (const { mesh, geometry } of meshes) storePose(mesh, geometry, 'aTrailPose')
    // The rig's own flutter (petals at sin(time * 11 + phase)), at two moments a
    // quarter of a petal's cycle apart.
    for (const [name, time] of [
      ['aFlutterA', 0],
      ['aFlutterB', Math.PI / 22]
    ] as const) {
      poseRig(rig, spec.wilt, { stem: 0, head: 0, petals: 0, growth: 1, mature: 1, time, flutter: 1 })
      rig.root.updateMatrixWorld(true)
      for (const { mesh, geometry } of meshes) storePose(mesh, geometry, name)
    }
    // The rig less far along: a bloom not quite fully open.
    poseRig(rig, spec.wilt, { stem: 0, head: 0, petals: 0, growth: 0.5, mature: 1, time: 0 })
    rig.root.updateMatrixWorld(true)
    for (const { mesh, geometry } of meshes) {
      storePose(mesh, geometry, 'aBudPose')
      // The bud pose and the part's phase share one attribute: a shader gets
      // 16, and the instanced ones already take six.
      const bud = geometry.getAttribute('aBudPose')
      const phase = geometry.getAttribute('aPart')
      const both = new Float32Array(bud.count * 4)
      for (let i = 0; i < bud.count; i++) both.set([bud.getX(i), bud.getY(i), bud.getZ(i), phase.getX(i)], i * 4)
      geometry.setAttribute('aBud', new THREE.BufferAttribute(both, 4))
      geometry.deleteAttribute('aBudPose')
      geometry.deleteAttribute('aPart')
    }
    return parts
  })
  baked.set(kind, made)
  return made
}

const Y = new THREE.Vector3(0, 1, 0)
const turnOf = (s: Slot) => (s.turn - 0.5) * 0.9
const _turn = new THREE.Quaternion()
const _tilt = new THREE.Quaternion()
const _axis = new THREE.Vector3()

/** The flower in focus, as it stands now: a few hundred of its model's own
 * points (every part of its kind), carried by its instance's matrix (place,
 * size, growth, lean), in the world. Look projects them so the callout's
 * brackets sit on the flower's edges; a box's corners would stand well clear
 * of it once the camera looks down. Set while the garden is up. */
export const plantBox: { of: ((i: number) => THREE.Vector3[] | null) | null } = { of: null }
/** How many points stand for a flower's outline. */
const OUTLINE = 320

/** Where a flower's root sits, as a matrix, leaning (lx, lz) radians about it. */
function placed(s: Slot, lx = 0, lz = 0) {
  // Each turns a little, but they all keep facing the way the bloom was posed.
  _turn.setFromAxisAngle(Y, turnOf(s))
  const lean = Math.hypot(lx, lz)
  if (lean > 1e-6) _turn.premultiply(_tilt.setFromAxisAngle(_axis.set(lz / lean, 0, -lx / lean), lean))
  const sink = s.land ? SINK_OF[s.kind as FlowerId] ?? LAND_SINK : SINK
  // A lawn plant's own height: stretched or squat up its stem.
  const tall = s.tall ?? 1
  return new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y + ((s.rise ?? 0) - sink) * s.scale, s.z), _turn, new THREE.Vector3(s.scale, s.scale * tall, s.scale))
}

// Momentum. Each flower hangs on two springs: its lean, which a carried flower's
// speed pushes back against the way it moves (and lifting or dropping it nods),
// and what trails behind, which follows the lean a beat later. Let go, both
// swing past rest a few times and settle. Part of the lean tips the whole plant
// on its root; the rest bends it by its own rig, the same poses the wind uses.
const LEAN_PER_SPEED = 0.09
const LEAN_MAX = 0.36
const NOD = 0.05
const LEAN_HZ = 1.25
const LEAN_DAMP = 0.38
const TRAIL_HZ = 1.0
const TRAIL_DAMP = 0.42
/** Share of the lean that tips the plant on its root rather than bending it. */
const TIP = 0.55
const GUST_RAD = (GUST_DEG * Math.PI) / 180

type Swing = { px: number; py: number; pz: number; vx: number; vy: number; vz: number; lx: number; lz: number; wx: number; wz: number; tx: number; tz: number; ux: number; uz: number }
const still = (s: Slot): Swing => ({ px: s.x, py: s.y, pz: s.z, vx: 0, vy: 0, vz: 0, lx: 0, lz: 0, wx: 0, wz: 0, tx: 0, tz: 0, ux: 0, uz: 0 })

/** One damped spring step, both axes: returns the new velocity. */
const spring = (x: number, v: number, goal: number, hz: number, damp: number, dt: number) => {
  const w = hz * 2 * Math.PI
  return v + (w * w * (goal - x) - 2 * damp * w * v) * dt
}

/** Moves a flower's springs on by dt. False once it has settled. */
function swing(w: Swing, s: Slot, dt: number) {
  // How fast it's carried, well smoothed: a pointer's speed flickers frame to
  // frame, and the bloom, far up the stem, would shake with it.
  const k = 1 - Math.exp(-dt * 6)
  w.vx += ((s.x - w.px) / dt - w.vx) * k
  w.vy += ((s.y - w.py) / dt - w.vy) * k
  w.vz += ((s.z - w.pz) / dt - w.vz) * k
  w.px = s.x
  w.py = s.y
  w.pz = s.z
  // The bloom hangs back from where it's going; going up or down, it nods.
  const side = s.turn > 0.5 ? 1 : -1
  let gx = -w.vx * LEAN_PER_SPEED + w.vy * NOD * side
  let gz = -w.vz * LEAN_PER_SPEED
  // Eases into its furthest lean rather than hitting a wall.
  const g = Math.hypot(gx, gz)
  if (g > 1e-6) {
    const soft = (LEAN_MAX * Math.tanh(g / LEAN_MAX)) / g
    gx *= soft
    gz *= soft
  }
  w.wx = spring(w.lx, w.wx, gx, LEAN_HZ, LEAN_DAMP, dt)
  w.wz = spring(w.lz, w.wz, gz, LEAN_HZ, LEAN_DAMP, dt)
  w.lx += w.wx * dt
  w.lz += w.wz * dt
  w.ux = spring(w.tx, w.ux, w.lx, TRAIL_HZ, TRAIL_DAMP, dt)
  w.uz = spring(w.tz, w.uz, w.lz, TRAIL_HZ, TRAIL_DAMP, dt)
  w.tx += w.ux * dt
  w.tz += w.uz * dt
  const moving = Math.abs(w.vx) + Math.abs(w.vy) + Math.abs(w.vz) > 1e-3
  const swinging = Math.abs(w.lx) + Math.abs(w.lz) + Math.abs(w.tx) + Math.abs(w.tz) + (Math.abs(w.wx) + Math.abs(w.wz) + Math.abs(w.ux) + Math.abs(w.uz)) * 0.1 > 2e-4
  if (!moving && !swinging) Object.assign(w, still(s))
  return moving || swinging
}

const PADS_EACH = 3

/** What a lily does to the water round it: shade under the pads, a soft pink
 * reflection of the bloom towards you, and slow rings spreading out. Drawn flat
 * on the surface, one quad per flower. */
const marksMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Under the plant, not over it: with the depth test off a pond full of
    // lotuses stacked these into a grey mat drawn across their own pads and
    // stems (Simon: "weird grey layer thing"). Offset so the water doesn't fight it.
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: { uTime: shared.uTime, uRipples: tune.ripples },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      varying float vPhase;
      void main() {
        vP = position.xz;
        vPhase = fract(instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.61);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      varying float vPhase;
      uniform float uTime;
      uniform float uRipples;
      float hash(float x) { return fract(sin(x * 91.17) * 43758.5453); }
      // One ripple, now and then: every flower keeps its own slow time, most
      // cycles nothing happens, and no two are the same size or shape.
      float ripple(vec2 p, float angle, float seed) {
        float speed = 0.035 + 0.05 * hash(seed);
        float clock = uTime * speed + hash(seed + 1.0) * 40.0;
        float cycle = floor(clock);
        float t = clock - cycle;
        float on = step(0.62, hash(cycle + seed * 7.0));
        float reach = 0.3 + 0.4 * hash(cycle + seed);
        float size = 0.14 + reach * sqrt(t);
        // Not a circle: a wobbling, slightly stretched loop that breaks up.
        float bent = length(p * vec2(1.0, 1.0 + 0.25 * hash(cycle + seed + 2.0)))
          + 0.018 * sin(angle * 3.0 + cycle * 2.0 + uTime * 0.3)
          + 0.012 * sin(angle * 7.0 - cycle + uTime * 0.4);
        float broken = 0.5 + 0.5 * sin(angle * (2.0 + floor(hash(cycle + seed + 3.0) * 3.0)) + cycle * 3.0);
        return on * smoothstep(0.045, 0.0, abs(bent - size)) * sin(t * 3.1416) * (1.0 - t) * mix(0.35, 1.0, broken);
      }
      void main() {
        vec2 p = vP / 2.6;
        float r = length(p);
        float angle = atan(p.y, p.x);
        float rings = ripple(p, angle, vPhase * 17.0) + 0.7 * ripple(p, angle, vPhase * 31.0 + 5.0);
        // Light per flower: a bed of them pools, it doesn't go opaque.
        float shade = exp(-r * r * 9.0) * 0.13;
        // The bloom's reflection, a soft smear broken up by the moving surface.
        float shimmer = 0.03 * sin(p.y * 22.0 + uTime * 0.5 + vPhase * 9.0) + 0.02 * sin(p.y * 41.0 - uTime * 0.37);
        vec2 q = p - vec2(shimmer + 0.02 * sin(uTime * 0.4 + vPhase * 6.0), 0.3);
        float mirror = exp(-(q.x * q.x * 30.0 + q.y * q.y * 14.0)) * 0.14;
        vec3 col = vec3(0.04, 0.16, 0.34) * shade + vec3(0.95, 0.55, 0.6) * mirror + vec3(0.86, 0.95, 1.0) * rings * 0.1 * uRipples;
        float a = shade + mirror + rings * 0.1 * uRipples;
        if (a < 0.003) discard;
        gl_FragColor = vec4(col / a, min(a, 1.0));
      }`
  })

/** Under a carried flower: a soft shadow lying on whatever is below it, there
 * to show exactly where it will land. */
function dropShadow() {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: 'varying vec2 vP; void main() { vP = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      uniform float uOpacity;
      void main() {
        float r = length(vP);
        float soft = exp(-r * r * 3.4) * (1.0 - smoothstep(0.82, 1.0, r));
        float rim = smoothstep(0.05, 0.0, abs(r - 0.86));
        gl_FragColor = vec4(0.03, 0.12, 0.25, uOpacity * (soft * 0.75 + rim * 0.3));
      }`
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  mesh.renderOrder = -9.25
  mesh.visible = false
  mesh.frustumCulled = false
  return mesh
}

const UP = new THREE.Vector3(0, 0, 1)

/** The light on the hills comes from the left and in front (Lawn.tsx), so a
 * plant's shadow falls to its right and behind it. */
const SHADOW_DIR = new THREE.Vector2(0.62, -0.42).normalize()

/** Where a lawn plant meets the grass: a faint, cool contact shade right under
 * it, drawn under the blades so the grass stands in it, and carried with the
 * plant when it's dragged. The shade it casts is in the sun map (dapple.ts),
 * pooled with its neighbours'. Lotuses have their pads' shade instead. */
const groundShadeMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    vertexShader: 'varying vec2 vP; void main() { vP = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float a = exp(-r * r * 2.2) * (1.0 - smoothstep(0.75, 1.0, r));
        gl_FragColor = vec4(0.1, 0.24, 0.3, a * 0.3);
      }`
  })

/** The ground patches lie flat: only a faint shade right under them, not a shrub's. */
const LOW_SHADE: Partial<Record<FlowerId, number>> = { daisy: 0.4, nemophila: 0.4 }

function groundShadeMatrix(s: Slot) {
  const low = LOW_SHADE[s.kind as FlowerId] ?? 1
  const reach = 0.2 * s.scale * low
  const x = s.x + SHADOW_DIR.x * reach
  const z = s.z + SHADOW_DIR.y * reach
  const y = heightAt(x, z) + 0.02
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.atan2(-SHADOW_DIR.y, SHADOW_DIR.x)))
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(0.75 * s.scale * low, 0.45 * s.scale * low, 1))
}

/** A lily pad: a flat disc with its notch, lying on the water, facing up. */
function padGeometry() {
  const n = 30
  const notch = 0.2
  const positions = [0, 0, 0]
  const index: number[] = []
  for (let i = 0; i <= n; i++) {
    const a = notch + (i / n) * (Math.PI * 2 - notch * 2)
    const r = 1 + 0.03 * Math.sin(a * 5) + 0.02 * Math.sin(a * 3 + 1)
    positions.push(Math.cos(a) * r, 0, Math.sin(a) * r)
    if (i < n) index.push(0, i + 2, i + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

const padMaterial = () =>
  wash(
    '#ffffff',
    {
      key: 'pad',
      vertexHead: 'varying vec2 vPad;',
      vertex: /* glsl */ `
        vPad = position.xz;
        vec3 at = instanceMatrix[3].xyz;
        transformed.y += 0.05 * sin(uTime * 0.8 + at.x * 1.3 + at.z) * length(position.xz);`,
      head: 'varying vec2 vPad;',
      // Pale veins from the middle, a lighter wash, a darker rim.
      fragment: /* glsl */ `
        float r = length(vPad);
        float vein = pow(abs(cos(atan(vPad.y, vPad.x) * 7.0)), 40.0) * smoothstep(0.08, 0.25, r) * 0.2;
        diffuseColor.rgb = mix(diffuseColor.rgb * (1.02 - 0.16 * smoothstep(0.72, 1.0, r)), vec3(0.62, 0.8, 0.6), vein * 0.5);`,
      shade: [
        [0.96, 0.98, 0.96],
        [1.02, 1.02, 1.0]
      ]
    },
    { side: THREE.DoubleSide, roughness: 1 }
  )

/** The pads round flower `i`: fixed to it, so they travel when it's carried. */
function padMatrix(s: Slot, i: number, k: number) {
  const rnd = mulberry(i * 7 + k + 1)
  const a = (k / PADS_EACH) * Math.PI * 2 + rnd() * 1.4 + i
  const size = (k === 0 ? 0.5 : 0.32 + rnd() * 0.16) * s.scale
  const d = (k === 0 ? 0.1 : 0.5 + rnd() * 0.18) * s.scale
  return new THREE.Matrix4().compose(
    new THREE.Vector3(s.x + Math.cos(a) * d, s.y + 0.02, s.z + Math.sin(a) * d * 0.8),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28),
    new THREE.Vector3(size, 1, size)
  )
}

function markMatrix(s: Slot) {
  return new THREE.Matrix4().compose(new THREE.Vector3(s.x, WATER_Y + 0.01, s.z), new THREE.Quaternion(), new THREE.Vector3(s.scale, 1, s.scale))
}

/** Every kind's instances are indexed by flower, so one index means the same
 * flower everywhere; a flower of another kind takes up its slot at size zero. */
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

/** Tall grass round each lawn plant's foot, the meadow's own blades, so the
 * stem rises out of it and the nearest blades stand in front. */
const TUFT = 60
const _tm = new THREE.Matrix4()
const _tq = new THREE.Quaternion()
const _tp = new THREE.Vector3()
const _ts = new THREE.Vector3()
function setTuft(mesh: THREE.InstancedMesh, hills: Float32Array, i: number, s: Slot) {
  const rnd = mulberry(i * 131 + 17)
  // Lifted out, the grass springs back flat; set down, it closes round again.
  const grow = s.land ? Math.max(0, 1 - (s.y - groundOf(s)) * 6) : 0
  for (let k = 0; k < TUFT; k++) {
    const n = i * TUFT + k
    const a = rnd() * Math.PI * 2
    const out = 0.12 + Math.sqrt(rnd()) * 0.88
    const r = out * 0.6 * s.scale
    const x = s.x + Math.cos(a) * r
    const z = s.z + Math.sin(a) * r * 0.8
    // Tallest close in to the stem, down to lawn height at the edge.
    const h = (0.62 + rnd() * 0.48) * (1 - 0.45 * out) * grow
    if (h <= 0.01) {
      mesh.setMatrixAt(n, HIDDEN)
      continue
    }
    _tq.setFromAxisAngle(Y, 2.2 + (rnd() - 0.5) * 1.4)
    _tm.compose(_tp.set(x, heightAt(x, z) - 0.02, z), _tq, _ts.set(0.026 + rnd() * 0.016, h, h))
    mesh.setMatrixAt(n, _tm)
    normalAt(x, z).toArray(hills, n * 3)
  }
}

export type Mover = (i: number) => void

/** How grown each flower shows, 0..1, by id, while it's being bloomed (a
 * visit from the pad); otherwise its own `growth` (the plant still in the
 * pot's), or full grown. */
export const growing = new Map<string, number>()
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** A young plant is smaller and its bloom still closed: it opens from about
 * half way, as the pad's flower does (rig.ts). It grows fastest early (an
 * ease-out), so a day's two or three things show: 0 → 10 % is 28 → 42 % of
 * its size, not the 1 % a smoothstep gave (Simon: "why didn't it grow?"). */
const sizeAt = (g: number) => 0.28 + 0.72 * (1 - (1 - Math.min(1, Math.max(0, g))) ** 2)
const budAt = (g: number) => 1 - smooth(0.4, 0.95, g)

export function Planted({
  flowers,
  spots,
  mover,
  onReady
}: {
  flowers: GardenFlower[]
  /** Where each flower is; edited in place while one is carried. */
  spots: Slot[]
  mover: React.MutableRefObject<Mover | null>
  onReady?: () => void
}) {
  const kinds = useMemo(() => [...new Set(flowers.map((f) => f.flower))].sort().join(), [flowers])
  const [parts, setParts] = useState<{ kind: FlowerId; parts: Part[] }[] | null>(null)
  /** Every kind has been tried (baked, or failed and left out). */
  const [allIn, setAllIn] = useState(false)
  useEffect(() => {
    let alive = true
    const list = kinds ? (kinds.split(',') as FlowerId[]) : []
    // Each kind joins the garden as soon as it's baked, lotus first, and one
    // failing to load doesn't take the others with it.
    setParts(null)
    setAllIn(false)
    const order = [...list].sort((a, b) => (a === 'lotus' ? -1 : b === 'lotus' ? 1 : 0))
    ;(async () => {
      for (const kind of order) {
        const t0 = performance.now()
        try {
          const own = await bakeFlower(kind)
          if (!alive) return
          console.info(`garden: ${kind} baked in ${Math.round(performance.now() - t0)} ms`)
          setParts((was) => [...(was ?? []).filter((p) => p.kind !== kind), { kind, parts: own }])
        } catch (e) {
          console.warn(`garden: ${kind} failed to load`, e)
        }
        // Let a frame through between kinds.
        await new Promise((r) => setTimeout(r, 0))
      }
      if (alive) setAllIn(true)
    })()
    return () => {
      alive = false
    }
  }, [kinds])
  const isLotus = (i: number) => flowers[i]?.flower === 'lotus'

  const swings = useMemo(() => spots.map(still), [spots])
  /** Each flower's place among those of its own kind: its instance in that kind's meshes. */
  const slot = useMemo(() => {
    const nth: Record<string, number> = {}
    return flowers.map((f) => (nth[f.flower] = (nth[f.flower] ?? -1) + 1))
  }, [flowers])

  const shape = flowers.map((f) => `${f.id}:${f.flower}`).join()
  const meshes = useMemo(() => {
    if (!parts || !flowers.length) return []
    const matrices = spots.map((s) => placed(s))
    return parts.flatMap(({ kind, parts: own }) => {
      // Only this kind's flowers: a model drawn hidden for every other flower
      // still costs its every vertex.
      const idx = flowers.flatMap((f, i) => (f.flower === kind ? [i] : []))
      if (!idx.length) return []
      const looks = new Float32Array(idx.length * 2)
      idx.forEach((i, j) => {
        const c = character(flowers[i].id)
        // How open each bloom is, the lawn's a little less varied than the pond's.
        looks[j * 2] = kind === 'lotus' ? c.closed : c.closed * 0.7
        looks[j * 2 + 1] = c.lean
      })
      const looksAttr = new THREE.InstancedBufferAttribute(looks, 2)
      /** Each flower's bend on its own momentum, stem then trail; every part reads it. */
      const bends = new THREE.InstancedBufferAttribute(new Float32Array(idx.length * 2), 2).setUsage(THREE.DynamicDrawUsage)
      return own.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, idx.length)
        part.geometry.setAttribute('aCharacter', looksAttr)
        part.geometry.setAttribute('aSwing', bends)
        idx.forEach((i, j) => mesh.setMatrixAt(j, matrices[i]))
        mesh.frustumCulled = false
        mesh.renderOrder = -9
        // No raycasting: double-click picks from the slots on screen (Look.tsx).
        mesh.raycast = () => {}
        return { kind, mesh, bends, looks: looksAttr, idx }
      })
    })
    // Rebuilt only when which flowers stand where changes, not when one of
    // them grows (a diary update mid-visit would rebuild and recompile them
    // all, and the bloom would stall).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, shape, spots])

  const pads = useMemo(() => {
    if (!flowers.length) return null
    const mesh = new THREE.InstancedMesh(padGeometry(), padMaterial(), flowers.length * PADS_EACH)
    // The same greens as the model's leaves, so the pads read as one plant.
    const greens = ['#4f9a68', '#5ba872', '#46905f', '#68ad78']
    const c = new THREE.Color()
    spots.forEach((s, i) => {
      for (let k = 0; k < PADS_EACH; k++) {
        mesh.setMatrixAt(i * PADS_EACH + k, isLotus(i) ? padMatrix(s, i, k) : HIDDEN)
        mesh.setColorAt(i * PADS_EACH + k, c.set(greens[(i * 3 + k) % greens.length]))
      }
    })
    mesh.frustumCulled = false
    mesh.renderOrder = -9.2
    mesh.raycast = () => {}
    return mesh
  }, [flowers.length, spots])

  const marks = useMemo(() => {
    if (!flowers.length) return null
    const geo = new THREE.PlaneGeometry(5.2, 5.2)
    geo.rotateX(-Math.PI / 2)
    const mesh = new THREE.InstancedMesh(geo, marksMaterial(), flowers.length)
    spots.forEach((s, i) => mesh.setMatrixAt(i, isLotus(i) ? markMatrix(s) : HIDDEN))
    mesh.frustumCulled = false
    mesh.renderOrder = -9.3
    mesh.raycast = () => {}
    return mesh
  }, [flowers.length, spots])
  const shade = useMemo(() => {
    if (!flowers.length) return null
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), groundShadeMaterial(), flowers.length)
    spots.forEach((s, i) => mesh.setMatrixAt(i, s.land ? groundShadeMatrix(s) : HIDDEN))
    mesh.frustumCulled = false
    mesh.renderOrder = -9.6
    mesh.raycast = () => {}
    return mesh
  }, [flowers.length, spots])
  const shadow = useMemo(dropShadow, [])
  const tufts = useMemo(() => {
    if (!flowers.length) return null
    const geometry = bladeStroke()
    const hills = new Float32Array(flowers.length * TUFT * 3)
    geometry.setAttribute('aHill', new THREE.InstancedBufferAttribute(hills, 3))
    const mesh = new THREE.InstancedMesh(geometry, bladeMaterial(), flowers.length * TUFT)
    spots.forEach((s, i) => setTuft(mesh, hills, i, s))
    mesh.frustumCulled = false
    // After the meadow's blades, testing against the plants' depth.
    mesh.renderOrder = -7.9
    mesh.raycast = () => {}
    return { mesh, hills }
  }, [flowers.length, spots])

  // The focused flower's box, for the callout's brackets.
  useEffect(() => {
    // Each kind's outline: its parts' points, every nth, about OUTLINE in
    // all, each with the offsets the shader adds for a bloom's openness and
    // the plant's lean (SWAY), so the outline is where it's drawn.
    type Pt = { at: THREE.Vector3; bud: THREE.Vector3; lean: THREE.Vector3 }
    const local = new Map<string, Pt[]>()
    for (const kind of new Set(meshes.map((x) => x.kind))) {
      const pts: Pt[] = []
      const geos = meshes.filter((x) => x.kind === kind).map((x) => x.mesh.geometry)
      const total = geos.reduce((n, g) => n + g.getAttribute('position').count, 0)
      const step = Math.max(1, Math.floor(total / OUTLINE))
      for (const g of geos) {
        const pos = g.getAttribute('position')
        const bud = g.getAttribute('aBud')
        const lean = g.getAttribute('aStemPose')
        for (let v = 0; v < pos.count; v += step)
          pts.push({
            at: new THREE.Vector3().fromBufferAttribute(pos, v),
            bud: bud ? new THREE.Vector3(bud.getX(v), bud.getY(v), bud.getZ(v)) : new THREE.Vector3(),
            lean: lean ? new THREE.Vector3().fromBufferAttribute(lean, v) : new THREE.Vector3()
          })
      }
      local.set(kind, pts)
    }
    const m = new THREE.Matrix4()
    const out = Array.from({ length: OUTLINE * 2 }, () => new THREE.Vector3())
    plantBox.of = (i) => {
      const f = flowers[i]
      const pts = f && local.get(f.flower)
      const own = f && meshes.find((x) => x.kind === f.flower)
      if (!pts || !own) return null
      own.mesh.getMatrixAt(slot[i], m)
      const closed = own.looks.getX(slot[i])
      const lean = own.looks.getY(slot[i])
      const n = Math.min(pts.length, out.length)
      for (let k = 0; k < n; k++) {
        const p = pts[k]
        out[k].copy(p.at).addScaledVector(p.bud, closed).addScaledVector(p.lean, lean).applyMatrix4(m)
      }
      return out.slice(0, n)
    }
    return () => {
      plantBox.of = null
    }
  }, [meshes, flowers, slot])

  // Carrying a flower moves just its instances.
  useEffect(() => {
    mover.current = (i) => {
      const w = swings[i]
      const g = growing.get(flowers[i].id) ?? flowers[i].growth ?? 1
      const m = placed(g < 1 ? { ...spots[i], scale: spots[i].scale * sizeAt(g) } : spots[i], w.lx * TIP, w.lz * TIP)
      for (const { kind, mesh } of meshes) {
        if (kind !== flowers[i].flower) continue
        mesh.setMatrixAt(slot[i], m)
        mesh.instanceMatrix.needsUpdate = true
      }
      if (marks && isLotus(i)) {
        marks.setMatrixAt(i, markMatrix(spots[i]))
        marks.instanceMatrix.needsUpdate = true
      }
      // The shadow lies on the surface below, tilted to it.
      const s = spots[i]
      const lift = s.y - groundOf(s)
      const ground = heightAt(s.x, s.z)
      const y = Math.max(WATER_Y, ground) + 0.03
      const e = 0.25
      const slope = new THREE.Vector3(heightAt(s.x - e, s.z) - heightAt(s.x + e, s.z), 2 * e, heightAt(s.x, s.z - e) - heightAt(s.x, s.z + e))
      if (ground <= WATER_Y + 0.02) slope.set(0, 1, 0)
      shadow.position.set(s.x, y, s.z)
      shadow.quaternion.setFromUnitVectors(UP, slope.normalize())
      shadow.scale.setScalar(s.scale * (1.15 + lift * 0.5))
      shadow.visible = lift > 0.004
      ;(shadow.material as THREE.ShaderMaterial).uniforms.uOpacity.value = Math.min(1, lift * 4)
      if (shade && spots[i].land) {
        shade.setMatrixAt(i, groundShadeMatrix(spots[i]))
        shade.instanceMatrix.needsUpdate = true
      }
      if (tufts && spots[i].land) {
        setTuft(tufts.mesh, tufts.hills, i, spots[i])
        tufts.mesh.instanceMatrix.needsUpdate = true
        tufts.mesh.geometry.getAttribute('aHill').needsUpdate = true
      }
      if (pads && isLotus(i)) {
        for (let k = 0; k < PADS_EACH; k++) pads.setMatrixAt(i * PADS_EACH + k, padMatrix(spots[i], i, k))
        pads.instanceMatrix.needsUpdate = true
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mover, meshes, pads, marks, shade, tufts, shadow, spots, swings, flowers, slot])

  // Growth, for a flower not yet full grown or being bloomed: smaller, its
  // bloom closed, set on its instance only when it changes.
  const shown = useMemo(() => new Map<string, number>(), [meshes])
  const grownMatrix = (i: number, g: number) => placed({ ...spots[i], scale: spots[i].scale * sizeAt(g) })
  useFrame(() => {
    flowers.forEach((f, i) => {
      const g = growing.get(f.id) ?? f.growth ?? 1
      if (g >= 1 && !shown.has(f.id)) return
      const was = shown.get(f.id)
      if (was === g) return
      shown.set(f.id, g)
      // Below 0: not planted yet (the timelapse), so not there at all, pads too.
      const away = g < 0
      if ((was !== undefined && was < 0) !== away) {
        if (isLotus(i)) {
          for (let k = 0; k < PADS_EACH; k++) pads?.setMatrixAt(i * PADS_EACH + k, away ? HIDDEN : padMatrix(spots[i], i, k))
          if (pads) pads.instanceMatrix.needsUpdate = true
          marks?.setMatrixAt(i, away ? HIDDEN : markMatrix(spots[i]))
          if (marks) marks.instanceMatrix.needsUpdate = true
        } else if (spots[i].land) {
          // Its shade on the grass and the tuft at its foot come with it.
          shade?.setMatrixAt(i, away ? HIDDEN : groundShadeMatrix(spots[i]))
          if (shade) shade.instanceMatrix.needsUpdate = true
          if (tufts) {
            if (away) for (let k = 0; k < TUFT; k++) tufts.mesh.setMatrixAt(i * TUFT + k, HIDDEN)
            else setTuft(tufts.mesh, tufts.hills, i, spots[i])
            tufts.mesh.instanceMatrix.needsUpdate = true
            tufts.mesh.geometry.getAttribute('aHill').needsUpdate = true
          }
        }
      }
      const c = character(f.id)
      for (const { kind, mesh, looks, idx } of meshes) {
        if (kind !== f.flower) continue
        const j = idx.indexOf(i)
        mesh.setMatrixAt(j, away ? HIDDEN : grownMatrix(i, g))
        mesh.instanceMatrix.needsUpdate = true
        const closed = kind === 'lotus' ? c.closed : c.closed * 0.7
        looks.setX(j, Math.max(closed, budAt(Math.max(0, g))))
        looks.needsUpdate = true
      }
    })
  })

  // Swing whatever is still moving; the rest isn't touched.
  useFrame((_, rawDt) => {
    if (!meshes.length) return
    const dt = Math.min(rawDt, 1 / 30)
    if (dt <= 0) return
    let changed = false
    spots.forEach((s, i) => {
      const w = swings[i]
      const was = w.lx !== 0 || w.lz !== 0 || w.tx !== 0 || w.tz !== 0
      if (!swing(w, s, dt) && !was) return
      // The bend goes along the rig's own sway, the plant's local x.
      const a = turnOf(s)
      const along = (x: number, z: number) => (x * Math.cos(a) - z * Math.sin(a)) * (1 - TIP)
      const g = growing.get(flowers[i].id) ?? flowers[i].growth ?? 1
      const m = placed(g < 1 ? { ...s, scale: s.scale * sizeAt(g) } : s, w.lx * TIP, w.lz * TIP)
      for (const { kind, mesh, bends } of meshes) {
        if (kind !== flowers[i].flower) continue
        bends.setXY(slot[i], along(w.lx, w.lz) / GUST_RAD, along(w.tx, w.tz) / GUST_RAD)
        mesh.setMatrixAt(slot[i], m)
      }
      changed = true
    })
    if (!changed) return
    for (const { mesh, bends } of meshes) {
      bends.needsUpdate = true
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  // Ready once every kind is in and its shaders are built: a kind baking or
  // compiling later would rebuild the plants and hold the page for a moment,
  // and a bloom playing then (Visit the garden) would stall and then leap.
  const { gl, scene, camera } = useThree()
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  useEffect(() => {
    if (!allIn || !meshes.length) return
    let alive = true
    const done = () => alive && readyRef.current?.()
    gl.compileAsync(scene, camera).then(
      () => setTimeout(done, 0),
      () => done()
    )
    return () => {
      alive = false
    }
  }, [allIn, meshes, gl, scene, camera])
  useEffect(() => () => meshes.forEach(({ mesh }) => mesh.dispose()), [meshes])

  return (
    <>
      {shade && <primitive object={shade} />}
      {marks && <primitive object={marks} />}
      <primitive object={shadow} />
      {pads && <primitive object={pads} />}
      {tufts && <primitive object={tufts.mesh} />}
      {meshes.map(({ mesh: m }) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </>
  )
}
