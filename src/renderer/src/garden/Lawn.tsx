import { useMemo } from 'react'
import * as THREE from 'three'
import { heightAt, mulberry, pondDist, POND } from './layout'
import { glsl3, linear, tune, wash, WIND, type PaintOptions } from './paint'

// The lawn is velvet on soft hills: a sheet of the same colour under a great
// many very fine blades, combed in a slow swirl so the light catches it in
// long streaks. The camera never moves, so blades grow only where it can see.
//
// None of it writes depth: the ink pass would rule hairlines across the far
// ground, right through the fog. It doesn't need depth anyway. With a fixed
// camera it can be painted back to front: the sheet (its rows already run that
// way), the pond and flowers, then the blades sorted far to near, which test
// against the flowers' depth so grass still stands in front of them.

const FAR_EDGE = -8
/** No blades past here: far off, grass is only the wash, and any stroke shows as a scratch when zoomed. */
const BLADE_EDGE = -1
const BLADES = 120000
const BANK = 9000

const DEEP = glsl3(linear('#5a9a7c'))
const MID = glsl3(linear('#8cba88'))
const LIGHT = glsl3(linear('#c9d9a0'))
/** The shade among the roots, as a multiplier. */
const ROOTS = 'vec3(0.86, 0.9, 0.92)'
const SAND = glsl3(linear('#e6d8b6'))
const SAND_DARK = glsl3(linear('#cdbb94'))

const NOISE = /* glsl */ `
float nHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(nHash(i), nHash(i + vec2(1.0, 0.0)), f.x), mix(nHash(i + vec2(0.0, 1.0)), nHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`

/** Colour of the hill at P: broad sheen across each hill, finer combed streaks.
 * Worked out once per blade, in the vertex shader; per pixel on the sheet. */
const velvet = (noise: string, p: string) => /* glsl */ `
vec2 warp = vec2(${noise}(${p} * 0.28), ${noise}(${p}.yx * 0.28 + 5.0));
float sheen = ${noise}(${p} * 0.22 + warp * 1.2) * 0.85 + ${noise}(${p} * vec2(0.6, 1.1) + warp) * 0.15;
// Broad flat washes with soft edges, like gouache laid in layers.
vec3 lawn = mix(${DEEP}, ${MID}, smoothstep(0.28, 0.54, sheen));
lawn = mix(lawn, ${LIGHT}, smoothstep(0.52, 0.78, sheen));
`
// Sheet and blades take no light of their own: both are this flat wash, tinted
// only by the shade map. If blades were lit they'd differ from the ground under
// them and show up as individual hairs.
// Soft shadows: big blurry cloud shadows drifting slowly across the meadow
// with the wind, cool and blue-green like a gouache glaze. Worked out at each
// pixel's ground position, so a blade and the ground under it always agree.
const FLAT = (shade: number[], sun: number[]) =>
  `outgoingLight = diffuseColor.rgb * mix(${glsl3(shade)}, ${glsl3(sun)}, sunlit);
   vec2 drift = vGw.xz * vec2(0.075, 0.11) - vec2(uTime * 0.035, uTime * 0.012);
   float cloud = wcNoise(drift) * 0.7 + wcNoise(drift * 2.3 + 3.1) * 0.3;
   float shadow = smoothstep(0.5, 0.78, cloud) * uShadows;
   outgoingLight *= mix(vec3(1.0), ${glsl3(CLOUD)}, min(shadow, 1.0) * 0.32);
   outgoingLight = mix(vec3(dot(outgoingLight, vec3(0.3, 0.59, 0.11))), outgoingLight, uGrassSat) * uGrassBright;`

const DIALS = { uGrassBright: tune.grassBright, uGrassSat: tune.grassSat, uShadows: tune.shadows }
const DIAL_HEAD = 'uniform float uGrassBright;\nuniform float uGrassSat;\nuniform float uShadows;'
/** A cloud's shadow on the grass, as a multiplier: cooler and a little darker. */
const CLOUD = [0.62, 0.8, 0.86]

const SHADE: [number[], number[]] = [
  [0.6, 0.78, 0.8],
  [1.12, 1.08, 0.9]
]

/** The ground's normal here, for the blades to share the hill's light. */
export function normalAt(x: number, z: number) {
  const e = 0.2
  return new THREE.Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize()
}

/** One fine stroke, base to tip, leaning along +z. */
export function bladeStroke() {
  const w = 0.5
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, -w * 0.5, 0.55, 0.18, w * 0.5, 0.55, 0.18, 0, 1, 0.55], 3))
  geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4])
  const n = new Float32Array(15)
  for (let i = 1; i < 15; i += 3) n[i] = 1
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3))
  return geo
}

const HILL_LIGHT = /* glsl */ `
  // Light and shade on the hills: the sunny slopes warm and bright, the ones
  // turned away cool and deeper, so the ground has form, not just colour.
  float hill = clamp(dot(normalize(vHill), normalize(vec3(-0.5, 0.8, 0.35))), 0.0, 1.0);
  diffuseColor.rgb *= mix(vec3(0.72, 0.82, 0.88), vec3(1.1, 1.08, 0.98), smoothstep(0.5, 0.95, hill));`

/** Grass shortens gradually towards the shore, down to a low fringe at the sand. */
function shoreHeight(x: number, z: number) {
  const t = Math.min(1, Math.max(0, (pondDist(x, z) - 0.15) / 0.7))
  return 0.22 + 0.78 * t * t * (3 - 2 * t)
}

let bladePaint: THREE.Material | null = null
/** The blades' paint: shared with the tufts round each lawn plant (Planted.tsx),
 * so they sway and colour as one meadow. Each needs an aHill attribute. */
export function bladeMaterial() {
  if (bladePaint) return bladePaint
  bladePaint = wash(
    '#ffffff',
    {
      key: 'blade',
      vertexHead: `${NOISE}\n${WIND}\nattribute vec3 aHill;\nvarying vec3 vHill;\nvarying float vTip;\nvarying float vGust;\nvarying vec3 vLawn;`,
      vertex: /* glsl */ `
        vTip = position.y;
        vHill = aHill;
        vec3 at = instanceMatrix[3].xyz;
        vec2 bladeAt = at.xz;
        ${velvet('nNoise', 'bladeAt')}
        vLawn = lawn;
        // Slow gusts rolling across the meadow; the flowers ride the same wave.
        float gust = windAt(at.xz, uTime);
        vGust = gust * smoothstep(0.0, 6.0, at.z);
        float shiver = sin(uTime * 1.8 + at.x * 1.3 - at.z * 1.1);
        // In world units: a blade is squashed thin in its own space, so the
        // push goes through its axes, undoing the instance's scale.
        vec3 push = vec3(1.0, 0.0, 0.35) * (1.05 * gust - 0.2 + 0.15 * shiver) * position.y * position.y * length(instanceMatrix[1].xyz) / 0.36;
        vec3 bx = instanceMatrix[0].xyz;
        vec3 bz = instanceMatrix[2].xyz;
        transformed.x += dot(push, bx) / dot(bx, bx);
        transformed.z += dot(push, bz) / dot(bz, bz);`,
      uniforms: DIALS,
      head: `${DIAL_HEAD}\nvarying vec3 vHill;\nvarying float vTip;\nvarying float vGust;\nvarying vec3 vLawn;`,
      fragment: /* glsl */ `
        // A gust bends the tips over, and they catch the light.
        diffuseColor.rgb *= vLawn * (1.0 + 0.3 * vGust * vTip * vTip);
        // Soft shade down among the roots, open light at the tips.
        diffuseColor.rgb *= mix(${ROOTS}, vec3(1.0), smoothstep(0.0, 0.85, vTip));
        ${HILL_LIGHT}`,
      shade: SHADE,
      after: FLAT(...SHADE)
    },
    { side: THREE.DoubleSide, depthWrite: false }
  )
  return bladePaint
}

export function Lawn() {
  const sheet = useMemo(() => {
    // The meadow ends at FAR_EDGE; the painted distance takes over there.
    const geo = new THREE.PlaneGeometry(130, 40, 260, 120)
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, 0, FAR_EDGE + 20)
    const pos = geo.getAttribute('position')
    const shore = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)))
      shore[i] = pondDist(pos.getX(i), pos.getZ(i))
    }
    geo.setAttribute('aShore', new THREE.BufferAttribute(shore, 1))
    geo.computeVertexNormals()
    const material = wash('#ffffff', {
      key: 'lawn',
      vertexHead: 'attribute float aShore;\nvarying float vShore;\nvarying vec3 vHill;',
      vertex: 'vHill = normal; vShore = aShore;',
      uniforms: DIALS,
      head: `${DIAL_HEAD}\nvarying float vShore;\nvarying vec3 vHill;`,
      fragment: `${velvet('wcNoise', 'vGw.xz')} diffuseColor.rgb = lawn;
        // The shore: sand at the water, grit thinning out into the grass.
        float grit = wcNoise(vGw.xz * 2.2) * 0.6 + wcNoise(vGw.xz * 7.0) * 0.4;
        float bay = wcNoise(vGw.xz * 0.55 + 4.0);
        float beach = 1.0 - smoothstep(0.02, 0.14, vShore + (grit - 0.5) * 0.12 + (bay - 0.5) * 0.14);
        vec3 sand = mix(${SAND_DARK}, ${SAND}, smoothstep(0.3, 0.7, grit));
        diffuseColor.rgb = mix(diffuseColor.rgb, sand, beach);
        // The ground sits in the grass's own shade, as dark as the roots.
        diffuseColor.rgb *= mix(${ROOTS}, vec3(1.0), beach);
        ${HILL_LIGHT}`,
      shade: SHADE,
      after: FLAT(...SHADE)
    })
    material.depthWrite = false
    const mesh = new THREE.Mesh(geo, material)
    mesh.renderOrder = -10
    return mesh
  }, [])

  const blades = useMemo(() => {
    const material = bladeMaterial()
    const geo = bladeStroke()
    const total = BLADES + BANK
    const hills = new Float32Array(total * 3)
    const mesh = new THREE.InstancedMesh(geo, material, total)
    mesh.frustumCulled = false
    const rnd = mulberry(4)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const c = new THREE.Color()
    let i = 0
    const spots: [number, number, number][] = []
    const put = (x: number, z: number, height: number) => {
      // Combed: a slow swirl across the hills, every blade near its neighbours.
      const comb = 2.2 + Math.sin(x * 0.3 + z * 0.2) * 0.9 + Math.sin(z * 0.45 - 1) * 0.7 + (rnd() - 0.5) * 0.5
      q.setFromAxisAngle(up, comb)
      m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.02, z), q, new THREE.Vector3(0.026 + rnd() * 0.016, height, height))
      mesh.setMatrixAt(i, m)
      const t = 0.995 + rnd() * 0.01
      mesh.setColorAt(i, c.setRGB(t, t, t))
      normalAt(x, z).toArray(hills, i * 3)
      i++
    }
    for (let tries = 0; spots.length < BLADES && tries < BLADES * 8; tries++) {
      // Only what the fixed camera can see, thicker near it.
      const z = 15.5 - Math.pow(rnd(), 1.5) * (15.5 - BLADE_EDGE)
      const half = 6.5 + (15.5 - z) * 0.4 + 2
      const x = (rnd() * 2 - 1) * half
      if (pondDist(x, z) < 0.15) continue
      // Grass shrinks with distance beyond what perspective does, so the far
      // meadow reads as far.
      const far = Math.min(1, Math.max(0, (11 - z) / (11 - BLADE_EDGE)))
      spots.push([x, z, (0.34 + rnd() * 0.26) * shoreHeight(x, z) * (1 - 0.72 * far)])
    }
    while (spots.length < total) {
      const a = rnd() * Math.PI * 2
      const r = 1.16 + Math.pow(rnd(), 2) * 0.2
      const dx = Math.cos(a) * POND.rx
      const dz = Math.sin(a) * POND.rz
      const edge = r * (1 / (1 + pondDist(POND.x + dx, POND.z + dz)))
      const bx = POND.x + dx * edge
      const bz = POND.z + dz * edge
      spots.push([bx, bz, (0.34 + rnd() * 0.26) * shoreHeight(bx, bz)])
    }
    spots.sort((a, b) => a[1] - b[1])
    for (const [x, z, h] of spots) put(x, z, h)
    mesh.count = i
    mesh.renderOrder = -8
    geo.setAttribute('aHill', new THREE.InstancedBufferAttribute(hills, 3))
    return mesh
  }, [])

  // White petals blown across the grass, like the reference's.
  const petals = useMemo(() => {
    const material = wash('#ffffff', { key: 'fleck', shade: [[1, 1, 1], [1.05, 1.05, 1.03]] }, { side: THREE.DoubleSide, depthWrite: false })
    const geo = new THREE.CircleGeometry(0.042, 8)
    const mesh = new THREE.InstancedMesh(geo, material, 130)
    mesh.frustumCulled = false
    const rnd = mulberry(19)
    const m = new THREE.Matrix4()
    const e = new THREE.Euler()
    const q = new THREE.Quaternion()
    const c = new THREE.Color()
    let i = 0
    for (let n = 0; i < mesh.count && n < 4000; n++) {
      const x = -10 + rnd() * 18
      const z = 2 + rnd() * 13
      if (pondDist(x, z) < 0.2 || Math.sin(x * 0.9) + Math.sin(z * 1.1) < 0.5) continue
      e.set(-1.3 + rnd() * 0.8, rnd() * 6, rnd())
      m.compose(new THREE.Vector3(x, heightAt(x, z) + 0.26, z), q.setFromEuler(e), new THREE.Vector3(1, 1, 1))
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.set(rnd() < 0.3 ? '#dcd9f2' : '#ffffff'))
      i++
    }
    mesh.count = i
    mesh.renderOrder = -7
    return mesh
  }, [])

  // Pebbles and gravel along the waterline, in clusters, a few big stones among them.
  const stones = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 1)
    const pos = geo.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + 0.16 * Math.sin(pos.getX(i) * 4 + pos.getZ(i) * 3)
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * 0.55, pos.getZ(i) * k)
    }
    geo.computeVertexNormals()
    const material = wash('#ffffff', {
      key: 'pebble',
      shade: [
        [0.86, 0.86, 0.88],
        [1.03, 1.02, 0.98]
      ]
    }, { depthWrite: false })
    const rnd = mulberry(29)
    const tones = ['#b9b2a2', '#cfc8b6', '#9c9a90', '#a8a498', '#d9d0bc', '#8f8c86']
    const list: { x: number; z: number; r: number; c: string }[] = []
    while (list.length < 110) {
      const a = rnd() * Math.PI * 2
      if (Math.sin(a * 3 + 1) + Math.sin(a * 5) < 0.5 + rnd()) continue
      const r = 1 + rnd() * rnd() * 0.12
      const big = rnd() < 0.05
      const dx = Math.cos(a) * POND.rx
      const dz = Math.sin(a) * POND.rz
      const edge = r * (1 / (1 + pondDist(POND.x + dx, POND.z + dz)))
      list.push({ x: POND.x + dx * edge, z: POND.z + dz * edge, r: big ? 0.13 + rnd() * 0.1 : 0.03 + rnd() * 0.06, c: tones[Math.floor(rnd() * tones.length)] })
    }
    list.sort((p, q) => p.z - q.z)
    const mesh = new THREE.InstancedMesh(geo, material, list.length)
    mesh.frustumCulled = false
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const c = new THREE.Color()
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, rnd() * 6.28)
      m.compose(new THREE.Vector3(p.x, heightAt(p.x, p.z) + p.r * 0.2, p.z), q, new THREE.Vector3(p.r * (1 + rnd() * 0.5), p.r, p.r))
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.set(p.c))
    })
    mesh.renderOrder = -8.5
    return mesh
  }, [])

  return (
    <>
      <primitive object={sheet} />
      <primitive object={stones} />
      <primitive object={blades} />
      <primitive object={petals} />
    </>
  )
}
