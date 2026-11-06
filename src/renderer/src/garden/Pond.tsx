import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { supersample } from '../flowers/Ink'
import { mulberry, pondDist, pondEdge, POND, SUN, WATER_Y } from './layout'
import { DAPPLE_SIZE, shared, tune } from './paint'

// The koi pond. Bowl, water and fish are their own small scene, drawn each frame
// into a target; a sheet lying on the lawn shows that target wherever it has
// anything in it. Pixelation was too much (Simon), so it now runs at full size;
// PIXEL_SIZE and PALETTE_LEVELS still bring the chunky pixels back.

/** Device pixels per pond pixel: the one number to turn. 1 is smooth, 6 is chunky. */
export const PIXEL_SIZE = 1
/** Tones per channel in the palette step; 0 turns it off. */
const PALETTE_LEVELS = 0

const FISH_Y = -0.4
const FLOOR_Y = -0.62
const KOI = [
  { base: '#ee6a34', patch: '#f4b45c', length: 1.05 },
  { base: '#f4efe4', patch: '#f4efe4', length: 0.95 },
  { base: '#f4efe4', patch: '#d24a32', length: 1.15 },
  { base: '#e8a088', patch: '#f4efe4', length: 0.9 },
  { base: '#d84a30', patch: '#f4efe4', length: 0.85 }
]

const blue = (hex: string) => {
  const c = new THREE.Color(hex)
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`
}

/** The pond's outline as a flat fan at height `y`, `grow` times its size. */
function fan(y: number, grow: number) {
  const n = 120
  const positions = [POND.x, y, POND.z]
  const index: number[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const r = pondEdge(a) * grow
    positions.push(POND.x + Math.cos(a) * POND.rx * r, y, POND.z + Math.sin(a) * POND.rz * r)
    if (i < n) index.push(0, i + 2, i + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(index)
  return geo
}

/** The bowl: rings from the bank down to the mud. */
function bowl() {
  const rings: [number, number][] = [
    [1.02, 0],
    [0.97, -0.3],
    [0.85, FLOOR_Y],
    [0.5, FLOOR_Y - 0.1],
    [0, FLOOR_Y - 0.14]
  ]
  const n = 72
  const positions: number[] = []
  const index: number[] = []
  rings.forEach(([s, y], k) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const r = s * pondEdge(a)
      positions.push(POND.x + Math.cos(a) * POND.rx * r, y, POND.z + Math.sin(a) * POND.rz * r)
      if (k < rings.length - 1) {
        const j = (i + 1) % n
        index.push(k * n + i, k * n + j, (k + 1) * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i)
      }
    }
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(index)
  return geo
}

/** One koi, nose towards +z, length 1: a spindle body with its fins. */
function koiGeometry() {
  const rows = 12
  const around = 8
  const positions: number[] = []
  const fin: number[] = []
  const index: number[] = []
  for (let i = 0; i <= rows; i++) {
    const t = i / rows
    // Blunt at the nose, widest a third back, drawn out thin to the tail.
    const r = 0.1 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.8) + 0.004
    const z = 0.5 - t * 0.86
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2
      positions.push(Math.cos(a) * r, Math.sin(a) * r * 0.82, z)
      fin.push(0)
      if (i < rows) {
        const l = (k + 1) % around
        const p = i * around
        index.push(p + k, p + l, p + around + k, p + l, p + around + l, p + around + k)
      }
    }
  }
  const tri = (...pts: number[]) => {
    const start = positions.length / 3
    positions.push(...pts)
    for (let i = 0; i < pts.length / 3; i++) fin.push(1)
    for (let i = 1; i < pts.length / 3 - 1; i++) index.push(start, start + i, start + i + 1)
  }
  // Tail, a soft forked fan; pectorals; a dorsal ridge.
  tri(0, 0, -0.34, -0.13, 0, -0.5, -0.04, 0, -0.44, 0, 0, -0.4, 0.04, 0, -0.44, 0.13, 0, -0.5)
  tri(0.07, -0.01, 0.2, 0.25, -0.02, 0.06, 0.17, -0.01, 0.02, 0.07, -0.01, 0.1)
  tri(-0.07, -0.01, 0.2, -0.25, -0.02, 0.06, -0.17, -0.01, 0.02, -0.07, -0.01, 0.1)
  tri(0, 0.07, 0.14, 0, 0.13, 0.02, 0, 0.07, -0.14)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 1))
  geo.setIndex(index)
  return geo
}

const stencilled = {
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.EqualStencilFunc
}

const SWIM = /* glsl */ `
attribute float aFin;
attribute float aSeed;
uniform float uTime;
vec3 swim(vec3 p) {
  // The tail swishes: a wave running back down the body, growing to the tail.
  float s = clamp((0.5 - p.z) / 1.0, 0.0, 1.0);
  p.x += sin(uTime * (3.2 + aSeed) + aSeed * 9.0 - s * 4.2) * 0.17 * s * s;
  // Pectorals sweep gently.
  if (aFin > 0.5 && p.z > 0.0) p.y += sin(uTime * 1.7 + aSeed * 5.0) * 0.05 * abs(p.x) / 0.25;
  return p;
}`

class Fish {
  x: number
  z: number
  heading: number
  phase: number
  constructor(rnd: () => number) {
    const a = rnd() * Math.PI * 2
    const r = 0.25 + rnd() * 0.4
    this.x = POND.x + Math.cos(a) * POND.rx * r
    this.z = POND.z + Math.sin(a) * POND.rz * r
    this.heading = rnd() * Math.PI * 2
    this.phase = rnd() * 40
  }
  step(t: number, dt: number) {
    // A slow wander, with a firm turn home when the bank gets close.
    const wander = Math.sin(t * 0.23 + this.phase) * 0.5 + Math.sin(t * 0.097 + this.phase * 1.7) * 0.42
    const near = pondDist(this.x, this.z) + 0.27
    let turn = wander
    if (near > 0) {
      const home = Math.atan2(POND.z - this.z, POND.x - this.x)
      const off = Math.atan2(Math.sin(home - this.heading), Math.cos(home - this.heading))
      turn = THREE.MathUtils.lerp(wander, Math.sign(off) * 1.6, Math.min(1, near * 6))
    }
    this.heading += turn * dt
    const speed = 0.34 + 0.13 * Math.sin(t * 0.31 + this.phase)
    this.x += Math.cos(this.heading) * speed * dt
    this.z += Math.sin(this.heading) * speed * dt
  }
}

export function Pond() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const low = useMemo(
    () =>
      new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        stencilBuffer: true,
        generateMipmaps: false
      }),
    []
  )

  const pond = useMemo(() => {
    const scene = new THREE.Scene()
    const sunDir = new THREE.Vector3(...SUN).normalize()

    // The bank's outline at lawn height stencils everything below it, so the
    // bowl and water can sit lower without peeking past the rim.
    const mask = new THREE.Mesh(
      fan(0, 1),
      new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp
      })
    )
    mask.renderOrder = -2
    scene.add(mask)

    const bed = new THREE.Mesh(
      bowl(),
      new THREE.ShaderMaterial({
        ...stencilled,
        side: THREE.DoubleSide,
        uniforms: { uDapple: shared.uDapple },
        vertexShader: /* glsl */ `
          varying vec3 vP;
          void main() {
            vP = position;
            gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vP;
          uniform sampler2D uDapple;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          void main() {
            // Blue washes laid by depth: pale over the shallows, ring by ring
            // down to ultramarine in the middle, edges wobbling like a brush.
            vec2 rim = (vP.xz - vec2(${POND.x.toFixed(2)}, ${POND.z.toFixed(2)})) / vec2(${POND.rx.toFixed(2)}, ${POND.rz.toFixed(2)});
            vec2 q = vP.xz * vec2(0.26, 0.42);
            float r = length(rim) + (noise(q + noise(q * 0.7) * 2.0) - 0.5) * 0.5;
            vec3 c = mix(${blue('#3a6e9e')}, ${blue('#5189b6')}, smoothstep(0.26, 0.46, r));
            c = mix(c, ${blue('#7cadcd')}, smoothstep(0.52, 0.72, r));
            c = mix(c, ${blue('#b0d4e2')}, smoothstep(0.76, 0.96, r));
                        // Clear shallows over sand, wet and darker at the waterline.
            c = mix(c, ${blue('#a9c7b8')}, smoothstep(0.86, 0.98, length(rim)));
            c = mix(c, ${blue('#b39a70')}, smoothstep(-0.12, -0.04, vP.y));
            gl_FragColor = vec4(c, 1.0);
          }`
      })
    )
    bed.renderOrder = -1
    scene.add(bed)

    const geometry = koiGeometry()
    const rnd = mulberry(77)
    const count = KOI.length
    const seeds = new Float32Array(count)
    const baseColors = new Float32Array(count * 3)
    const patchColors = new Float32Array(count * 3)
    const c = new THREE.Color()
    KOI.forEach((k, i) => {
      seeds[i] = 0.2 + rnd() * 0.7
      c.set(k.base).toArray(baseColors, i * 3)
      c.set(k.patch).toArray(patchColors, i * 3)
    })
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
    geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(baseColors, 3))
    geometry.setAttribute('aPatch', new THREE.InstancedBufferAttribute(patchColors, 3))

    const time = shared.uTime
    const fishTime = { value: 0 }
    const koi = new THREE.InstancedMesh(
      geometry,
      new THREE.ShaderMaterial({
        ...stencilled,
        side: THREE.DoubleSide,
        uniforms: { uTime: fishTime, uFish: tune.fish },
        vertexShader: /* glsl */ `
          ${SWIM}
          attribute vec3 aBase;
          attribute vec3 aPatch;
          varying vec3 vC;
          varying float vTop;
          void main() {
            vec3 p = swim(position);
            // Patches, different on each fish, along the back.
            float n = sin(p.z * 11.0 + aSeed * 30.0) + sin(p.z * 5.0 - aSeed * 11.0 + p.x * 16.0);
            vC = mix(aBase, aPatch, smoothstep(-0.1, 0.25, n));
            if (aFin > 0.5) vC = mix(vC, vec3(0.95, 0.92, 0.85), 0.55);
            vTop = position.y;
            gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vC;
          varying float vTop;
          uniform float uFish;
          void main() {
            // Seen through water: the top of the back catches a little light,
            // the rest of the colour sinks into the deep blue around it.
            vec3 c = vC * (0.74 + 2.0 * max(vTop, 0.0));
            gl_FragColor = vec4(mix(${blue('#2c5d8c')}, c, uFish), 1.0);
          }`
      }),
      count
    )
    koi.frustumCulled = false
    koi.renderOrder = 1

    const shadows = new THREE.InstancedMesh(
      geometry,
      new THREE.ShaderMaterial({
        ...stencilled,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: fishTime, uFish: tune.fish },
        vertexShader: /* glsl */ `
          ${SWIM}
          void main() {
            vec4 w = instanceMatrix * vec4(swim(position), 1.0);
            w.y = ${(FLOOR_Y + 0.02).toFixed(3)};
            w.xz += vec2(0.14, 0.2);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: 'uniform float uFish; void main() { gl_FragColor = vec4(0.01, 0.06, 0.2, 0.55 * uFish); }'
      }),
      count
    )
    shadows.instanceMatrix = koi.instanceMatrix
    shadows.frustumCulled = false
    shadows.renderOrder = 0

    const water = new THREE.Mesh(
      fan(WATER_Y, 1.1),
      new THREE.ShaderMaterial({
        ...stencilled,
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: time, uRain: tune.rain },
        vertexShader: /* glsl */ `
          varying vec3 vP;
          void main() {
            vP = position;
            gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vP;
          uniform float uTime;
          uniform float uRain;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          void main() {
            vec3 view = normalize(cameraPosition - vP);
            // Reflections: big soft blobs of pale sky drifting on still water.
            vec2 q = vP.xz * vec2(0.3, 0.8);
            float blob = noise(q + uTime * vec2(0.03, 0.012)) * 0.65 + noise(q * 2.1 - uTime * 0.02) * 0.35;
            float fresnel = pow(1.0 - max(view.y, 0.0), 3.0);
            vec3 tint = vec3(0.78, 0.93, 1.0);
            float alpha = fresnel * 0.14 + smoothstep(0.46, 0.76, blob) * 0.34;
            // Rain: drops land all over the pond, each a ring spreading out
            // and fading. One drop per cell of a grid on the water, at its own
            // spot and moment; heavier rain fills more of the cells.
            if (uRain > 0.001) {
              const float CELL = 0.55;
              vec2 g = vP.xz / CELL;
              float rings = 0.0;
              for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {
                vec2 c = floor(g) + vec2(float(dx), float(dy));
                if (hash(c + 3.7) > 0.25 + 0.75 * uRain) continue;
                float period = 1.1 + hash(c + 9.1) * 0.9;
                float t = fract(uTime / period + hash(c));
                // A new spot for every drop.
                float n = floor(uTime / period + hash(c));
                vec2 at = (c + vec2(hash(c + n), hash(c - n + 1.3))) * CELL;
                float r = t * 0.42;
                float d = length(vP.xz - at);
                float ring = (1.0 - smoothstep(0.0, 0.022 + t * 0.02, abs(d - r))) * pow(1.0 - t, 1.6);
                // A second, fainter ring trailing the first.
                ring += 0.5 * (1.0 - smoothstep(0.0, 0.02, abs(d - r * 0.6))) * pow(1.0 - t, 2.2);
                rings = max(rings, ring);
              }
              alpha = max(alpha, rings * (0.35 + 0.35 * uRain));
            }
            gl_FragColor = vec4(tint, clamp(alpha, 0.0, 0.75));
          }`
      })
    )
    water.renderOrder = 2

    scene.add(shadows, koi, water)

    const rand = mulberry(3)
    const fish = KOI.map(() => new Fish(rand))
    return { scene, koi, fish, fishTime }
  }, [])

  // The sheet that shows the target, a little larger than the pond: its
  // outline comes from the target's stair, not this mesh.
  const sheet = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tPond: { value: low.texture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uLow: { value: new THREE.Vector2(1, 1) }
      },
      defines: { LEVELS: PALETTE_LEVELS.toFixed(1), STAIR: PIXEL_SIZE > 1 ? 1 : 0 },
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tPond;
        uniform vec2 uRes;
        uniform vec2 uLow;
        const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
        void main() {
          vec2 uv = gl_FragCoord.xy / uRes;
          vec4 c = texture2D(tPond, uv);
          if (c.a < 0.5) discard;
          vec3 col = c.rgb;
          if (LEVELS > 0.0) {
            // A small palette, ordered-dithered in the pond's own big pixels.
            vec2 px = floor(uv * uLow);
            int i = int(mod(px.x, 4.0)) + 4 * int(mod(px.y, 4.0));
            vec3 s = pow(max(col, 0.0), vec3(1.0 / 2.2));
            s = floor(s * LEVELS + 0.3 + 0.4 * BAYER[i] / 16.0) / LEVELS;
            col = pow(s, vec3(2.2));
          }
          #if STAIR
          // The stair: a dark pixel where the pond meets the lawn.
          vec2 e = 1.0 / uLow;
          float inner = min(min(texture2D(tPond, uv + vec2(e.x, 0.0)).a, texture2D(tPond, uv - vec2(e.x, 0.0)).a),
                            min(texture2D(tPond, uv + vec2(0.0, e.y)).a, texture2D(tPond, uv - vec2(0.0, e.y)).a));
          if (inner < 0.5) col = col * 0.35 + vec3(0.004, 0.012, 0.004);
          #endif
          gl_FragColor = vec4(col, 1.0);
        }`
    })
    const mesh = new THREE.Mesh(fan(0.012, 1.06), material)
    material.depthWrite = false
    material.depthTest = false
    mesh.renderOrder = -9.5
    return mesh
  }, [low])

  useEffect(() => {
    const px = gl.getDrawingBufferSize(new THREE.Vector2())
    const w = Math.max(2, Math.round(px.x / PIXEL_SIZE))
    const h = Math.max(2, Math.round(px.y / PIXEL_SIZE))
    low.setSize(w, h)
    const m = sheet.material as THREE.ShaderMaterial
    m.uniforms.uRes.value.copy(px).multiplyScalar(supersample(dpr))
    m.uniforms.uLow.value.set(w, h)
  }, [gl, low, sheet, size, dpr])

  useEffect(() => () => low.dispose(), [low])

  const _m = useMemo(() => new THREE.Matrix4(), [])
  const _q = useMemo(() => new THREE.Quaternion(), [])
  const _p = useMemo(() => new THREE.Vector3(), [])
  const _s = useMemo(() => new THREE.Vector3(), [])
  const _up = useMemo(() => new THREE.Vector3(0, 1, 0), [])

  // Ahead of Ink, which draws the main scene with this target's fresh picture on the sheet.
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    pond.fishTime.value += dt
    const t = pond.fishTime.value
    pond.fish.forEach((f, i) => {
      f.step(t, dt)
      // +z nose along the heading.
      _q.setFromAxisAngle(_up, Math.PI / 2 - f.heading)
      _p.set(f.x, FISH_Y - i * 0.018, f.z)
      const l = KOI[i].length * 1.1
      _m.compose(_p, _q, _s.set(l, l, l))
      pond.koi.setMatrixAt(i, _m)
    })
    pond.koi.instanceMatrix.needsUpdate = true
    gl.setRenderTarget(low)
    gl.clear()
    gl.render(pond.scene, camera)
    gl.setRenderTarget(null)
  }, 0.5)

  return <primitive object={sheet} />
}
