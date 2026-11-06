import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { wake } from './pace'

// Rain falls into the pot when you drink: the visible cause of the recovery
// that follows, as much rain as you drank (a drop per 25 ml). It's pixel
// rain: each drop is a streak one pixel-block wide with a bright head and a
// tail that dithers away, drawn on the screen's own block grid (2 CSS px a
// block) so it stays hard-edged pixel art however the flower is posed. Into
// soil a drop soaks away; into a basin of water it rings out as a pixel
// ripple.

type Drop = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  x: number
  z: number
  y0: number
  delay: number
  t: number
  splash: number
}

// Slower than real rain, so the fall reads: from just above the frame's top
// edge (RAIN_TOP over the soil), about half a second down.
const GRAVITY = 14
const RAIN_TOP = 1.9
/** Seconds from a drink until the first droplet lands. */
export const DROP_LAND = Math.sqrt((2 * RAIN_TOP) / GRAVITY)
const ML_PER_DROP = 25
const MIN_DROPS = 4
const MAX_DROPS = 48
const SPLASH = 0.16
const RIPPLE = 0.9
/** A pixel block, in CSS px. */
const BLOCK = 2

export type Soil = { y: number; radius: number; half: number; water?: boolean }

// Shared by the drop and the ripple: snap each fragment to the centre of its
// screen-space block (BLOCK CSS px) and read the quad's uv there, so every
// block is one flat colour. Plus a 4×4 ordered dither for fades.
const COMMON = /* glsl */ `
uniform float uPx;
uniform float uFade;
varying vec2 vUv;
vec2 blockUv() {
  vec2 c = (floor(gl_FragCoord.xy / uPx) + 0.5) * uPx;
  vec2 d = c - gl_FragCoord.xy;
  return vUv + dFdx(vUv) * d.x + dFdy(vUv) * d.y;
}
float bayer(vec2 p) {
  vec2 q = mod(p, 4.0);
  int i = int(q.x) + 4 * int(q.y);
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i] + 0.5) / 16.0;
}
`

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

// A falling drop: a column one block wide, bright head at the bottom, its
// tail fading up the quad in dithered steps.
const dropFrag = /* glsl */ `
${COMMON}
void main() {
  vec2 uv = blockUv();
  // One block wide, whatever the quad's size on screen.
  float bw = uPx * abs(dFdx(vUv.x));
  if (abs(uv.x - 0.5) > 0.5 * bw || uv.y < 0.0 || uv.y > 1.0) discard;
  float bh = uPx * abs(dFdy(vUv.y));
  // Head: the leading (bottom) block, nearly white; then a clear blue body
  // whose tail dithers away.
  vec3 head = vec3(0.88, 0.97, 1.0);
  vec3 body = vec3(0.36, 0.68, 0.98);
  vec3 col = uv.y < bh ? head : body;
  float a = (1.0 - smoothstep(0.35, 1.0, uv.y)) * uFade;
  if (a < bayer(floor(gl_FragCoord.xy / uPx))) discard;
  gl_FragColor = vec4(col, 1.0);
}`

// A ripple on the water: a ring one block thick that widens (the mesh scales)
// and dithers away.
const rippleFrag = /* glsl */ `
${COMMON}
void main() {
  vec2 uv = blockUv();
  float r = length(uv - 0.5) * 2.0;
  float bw = uPx * length(vec2(dFdx(vUv.x), dFdy(vUv.x))) * 2.0;
  if (abs(r - 0.9) > 0.5 * bw) discard;
  if (uFade < bayer(floor(gl_FragCoord.xy / uPx))) discard;
  gl_FragColor = vec4(0.9, 0.97, 1.0, 1.0);
}`

// Soaking into soil: a short flat smear of blocks that dithers away.
const soakFrag = /* glsl */ `
${COMMON}
void main() {
  vec2 uv = blockUv();
  if (length(uv - 0.5) > 0.5) discard;
  if (uFade < bayer(floor(gl_FragCoord.xy / uPx))) discard;
  gl_FragColor = vec4(0.36, 0.68, 0.98, 1.0);
}`

function material(frag: string, px: number) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: frag,
    uniforms: { uPx: { value: px }, uFade: { value: 1 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  })
}

export function Droplets({ drinkKey, ml, soil }: { drinkKey: number; ml: number; soil: Soil }) {
  const group = useRef<THREE.Group>(null)
  const drops = useRef<Drop[]>([])
  const camera = useThree((s) => s.camera)
  const dpr = useThree((s) => s.viewport.dpr)
  const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  const flat = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), [])
  const px = BLOCK * dpr

  // Only new drinks spawn drops; a soil change (flower switch) must not replay one.
  const seen = useRef(drinkKey)
  useEffect(() => {
    const g = group.current
    if (drinkKey === seen.current || !g) return
    seen.current = drinkKey
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const count = Math.max(MIN_DROPS, Math.min(MAX_DROPS, Math.round(ml / ML_PER_DROP)))
    // A bigger drink rains longer: ~0.7 s for a glass, up to 1.4 s.
    const spread = Math.min(1.4, 0.07 * count)
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(quad, material(dropFrag, px))
      mesh.renderOrder = 3
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * soil.radius * 0.8
      const d: Drop = {
        mesh,
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        // DROP_LAND to the soil for the first drop; the flower waits for it.
        y0: soil.y + RAIN_TOP + Math.random() * 0.5,
        delay: (i / count) * spread + Math.random() * 0.03,
        t: 0,
        splash: -1
      }
      mesh.visible = false
      g.add(mesh)
      drops.current.push(d)
    }
  }, [drinkKey, ml, quad, px, soil])

  useFrame((_, dt) => {
    const g = group.current
    if (!g || !drops.current.length) return
    wake()
    drops.current = drops.current.filter((d) => {
      d.t += Math.min(dt, 1 / 20)
      const t = d.t - d.delay
      if (t < 0) return true
      const m = d.mesh
      m.visible = true
      if (d.splash < 0) {
        const y = d.y0 - 0.5 * GRAVITY * t * t
        const v = GRAVITY * t
        // Upright, facing the camera; the streak lengthens as it speeds up,
        // its head (the quad's bottom) at the drop.
        const len = 0.08 + Math.min(0.2, v * 0.016)
        m.quaternion.copy(camera.quaternion)
        m.scale.set(0.06, len, 1)
        m.position.set(d.x, Math.max(y, soil.y) + len / 2, d.z)
        if (y <= soil.y) d.splash = 0
        return true
      }
      d.splash += Math.min(dt, 1 / 20)
      if (m.geometry !== flat) {
        m.geometry = flat
        m.material.dispose()
        m.material = material(soil.water ? rippleFrag : soakFrag, px)
        m.quaternion.identity()
      }
      const k = Math.min(1, d.splash / (soil.water ? RIPPLE : SPLASH))
      const ease = 1 - Math.pow(1 - k, 2)
      m.position.set(d.x, soil.y + 0.004, d.z)
      // A ripple widens; a soak spreads a little.
      const r = soil.water ? 0.06 + 0.3 * ease : 0.07 + 0.05 * ease
      m.scale.set(r, 1, r)
      m.material.uniforms.uFade.value = (soil.water ? 0.8 : 1) * (1 - k)
      if (k >= 1) {
        m.material.dispose()
        g.remove(m)
        return false
      }
      return true
    })
  })

  return <group ref={group} />
}

/** Where the soil is, from the model's `pot` node (or a sensible default). */
export function findSoil(root: THREE.Object3D): Soil {
  const pot = root.getObjectByName('pot')
  // A garden plant with no pot: drops land on the ground round its base.
  if (root.userData.ground) return { y: 0, radius: 0.3, half: 0.5 }
  if (!pot) return { y: 0.6, radius: 0.3, half: 0.36 }
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(pot)
  const narrow = Math.min(box.max.x - box.min.x, box.max.z - box.min.z)
  const wide = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
  // A basin of water: drops land on its surface.
  const water = root.getObjectByName('water')
  if (water) {
    const y = water.getWorldPosition(new THREE.Vector3()).y
    return { y, radius: narrow * 0.42, half: wide / 2, water: true }
  }
  return { y: box.max.y, radius: narrow * 0.42, half: narrow / 2 }
}
