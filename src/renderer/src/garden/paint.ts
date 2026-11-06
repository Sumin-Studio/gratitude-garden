import * as THREE from 'three'
import { makeWatercolour } from '../flowers/watercolour'
import { SUN } from './layout'

// The garden's paint: the flower's watercolour material, plus what a whole
// scene needs. Every surface reads the same sun map (dapple.ts) along the sun's
// direction, so the maple's shade falls over lawn, stone, pots and fence alike
// without a shadow pass. Its world position is on hand for painted detail.

export const shared = {
  uTime: { value: 0 },
  uDapple: { value: null as THREE.Texture | null },
  /** Size of the target being painted on, in pixels. */
  uScreen: { value: new THREE.Vector2(1, 1) },
  /** Where the paper grain is pinned: a fixed point of the garden on screen
   * (CSS px from the bottom left) and how far in the view is against home
   * (Look sets it each frame; Film reads it), so the grain moves and scales
   * with the garden instead of sitting on the window. */
  uPaperAt: { value: new THREE.Vector3(0, 0, 1) }
}

/** The pale air the far meadow lightens into. */
export const HAZE = '#dbeee0'

/** The side of the square the sun map covers, in world units. */
export const DAPPLE_SIZE = 40

const sun = new THREE.Vector3(...SUN).normalize()
function linear(hex: string) {
  const c = new THREE.Color(hex)
  return [c.r, c.g, c.b]
}
const glsl3 = (v: number[]) => `vec3(${v.map((n) => n.toFixed(3)).join(', ')})`

/** The wind, 0 calm to 1 at the height of a gust: long slow waves rolling
 * across the garden, shared by grass and flowers so they move as one. */
export const WIND = /* glsl */ `
uniform float uWind;
float windAt(vec2 p, float t) {
  float wave = sin(p.x * 0.21 + p.y * 0.13 - t * 0.62) * 0.65 + sin(p.x * 0.08 - p.y * 0.11 - t * 0.27) * 0.35;
  float g = 0.5 + 0.5 * wave;
  return (g * g * (3.0 - 2.0 * g)) * uWind;
}`

/** The look's dials, live uniforms: the browser version's sliders (Tune.tsx)
 * turn these. The values here are the defaults the app ships with. */
export const tune = {
  grassBright: { value: 1.2 },
  grassSat: { value: 1.1 },
  sat: { value: 1.14 },
  fish: { value: 0.17 },
  wind: { value: 1.15 },
  fade: { value: 1.05 },
  glow: { value: 0 },
  paper: { value: 1.09 },
  ripples: { value: 1 },
  shadows: { value: 2.5 },
  /** 0 off; up to 1, fewer colours, mixed by an ordered dither. */
  dither: { value: 1 },
  /** Size of a dither pixel, in screen points. */
  pixel: { value: 0.75 },
  /** The camera, in degrees: turned round the garden, tilted down, and the
   * lens's width (narrow is nearly flat, for the isometric look). Not uniforms;
   * Look.tsx eases towards them. */
  turn: { value: 11 },
  tilt: { value: 16.5 },
  lens: { value: 12 },
  /** The sky: hour of the day (0–24), how overcast (0–1), how hard it rains (0–1). */
  hour: { value: 13 },
  cloud: { value: 0 },
  rain: { value: 0 },
  /** The glass under the callout sheet (Film's lens, ui/lens.ts), after the
   * liquid-glass post (Kubai087, docs/GRATITUDE-PLAN.md), on Simon's numbers
   * from the Glass sliders (ui/glass.ts, which sets these): blur 4 px,
   * saturate 1.09, brightness 0.96, a 24 px refraction band pulling 1.1 x
   * the band at the rim, red and blue split ±15 %. */
  glassBlur: { value: 4 },
  glassSat: { value: 1.09 },
  glassBright: { value: 0.96 },
  glassBand: { value: 24 },
  glassPull: { value: 1.1 },
  glassDisp: { value: 0.15 }
}

export type PaintOptions = {
  /** Names the shader; give each different combination its own. */
  key: string
  /** Declarations for the vertex shader. */
  vertexHead?: string
  /** Runs first in the vertex shader; moves `transformed`. */
  vertex?: string
  /** Declarations for the fragment shader. */
  head?: string
  /** Runs after the material's colour; sets `diffuseColor`. */
  fragment?: string
  /** Colour multipliers in full shade and in full sun. */
  shade?: [number[], number[]]
  /** Runs last, with `outgoingLight` and `sunlit` (0..1). */
  after?: string
  /** How much of the fog it takes, 1 = all (flowers hold their colour longer). */
  fog?: number
  /** Extra uniforms. */
  uniforms?: Record<string, THREE.IUniform>
}

const SHADE: [number[], number[]] = [
  [0.74, 0.8, 0.84],
  [1.08, 1.05, 0.95]
]


const VERTEX_HEAD = /* glsl */ `
uniform float uTime;
varying vec3 vGw;
`
const FRAGMENT_HEAD = /* glsl */ `
uniform float uTime;
uniform sampler2D uDapple;
uniform vec2 uScreen;
varying vec3 vGw;
float gardenSun(vec3 p) {
  vec2 g = p.xz - ${glsl3([sun.x, sun.z, 0])}.xy / ${sun.y.toFixed(3)} * p.y;
  // The leaves stir: the map drifts a little, more in some places than others.
  g += 0.09 * vec2(sin(uTime * 0.37 + g.y * 0.7), cos(uTime * 0.29 + g.x * 0.6));
  return texture2D(uDapple, g / ${DAPPLE_SIZE.toFixed(1)} + 0.5).r;
}
`

/** Adds the garden's sun and hooks to a material. Pass `washed` when it
 * already has the watercolour (the lotus's, from models.ts). */
export { linear, glsl3 }

export function paint<M extends THREE.MeshStandardMaterial>(material: M, opts: PaintOptions, washed = false): M {
  if (!washed) makeWatercolour(material)
  const base = material.onBeforeCompile
  const [dark, light] = opts.shade ?? SHADE
  material.onBeforeCompile = (shader, renderer) => {
    base.call(material, shader, renderer)
    shader.uniforms.uTime = shared.uTime
    shader.uniforms.uDapple = shared.uDapple
    shader.uniforms.uScreen = shared.uScreen
    shader.uniforms.uWind = tune.wind
    Object.assign(shader.uniforms, opts.uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${VERTEX_HEAD}${opts.vertexHead ?? ''}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${opts.vertex ?? ''}`)
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        vec4 gw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          gw = instanceMatrix * gw;
        #endif
        vGw = (modelMatrix * gw).xyz;`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FRAGMENT_HEAD}${opts.head ?? ''}\nvoid main() {`)
      // Right after the colour step, which the watercolour may have rewritten
      // (models.ts's vertex paint), so anchored on the step after it.
      .replace('#include <alphamap_fragment>', `${opts.fragment ?? ''}\n#include <alphamap_fragment>`)
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `// The wash's pow() can leave a stray NaN, a black speck once resolved.
        if (!(outgoingLight.r + outgoingLight.g + outgoingLight.b >= 0.0)) outgoingLight = diffuseColor.rgb * 0.6;
        float sunlit = gardenSun(vGw);
        outgoingLight *= mix(${glsl3(dark)}, ${glsl3(light)}, sunlit);
        ${opts.after ?? ''}
        // Air: the far meadow goes pale. Measured from the home camera, so
        // zooming in doesn't clear it.
        float gfog = max(length(vGw.xz - vec2(0.0, 30.0)) - 34.0, 0.0) / 14.0;
        outgoingLight = mix(outgoingLight, ${glsl3(linear(HAZE))}, (1.0 - exp(-gfog * gfog)) * 0.7 * ${(opts.fog ?? 1).toFixed(2)});
        #include <opaque_fragment>`
      )
  }
  material.customProgramCacheKey = () => `sip-garden-${opts.key}`
  material.needsUpdate = true
  return material
}

/** A plain painted colour (vertex or instance colours multiply it). */
export function wash(color: THREE.ColorRepresentation, opts: PaintOptions, extra: THREE.MeshStandardMaterialParameters = {}) {
  return paint(new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra }), opts)
}
