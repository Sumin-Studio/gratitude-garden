import * as THREE from 'three'
import { LIP, OUTER_WALL, SUIBAN } from './suiban'

// The watercolour look for the real flower model, after Japanese woodblock
// lotus prints: cream petals flushing to vivid pink tips, a gold heart, sage
// pads shaded light to dark with pale undersides. Done in the model's own
// material rather than as a post-process (post effects fight the transparent
// window):
//   • palette: the Meshy texture's colours are re-mapped onto the print's
//     (cream/pink petals → cream to pink, greens → sage, yellow → gold);
//   • the rig says what each vertex is (markParts): pads, stalks and stem are
//     always leaf, petals never green, pad edges lighter, like the print;
//   • leaves are one tone each (blurred texel, most of the bump map removed)
//     but keep the light, so pads shade from light to dark; their undersides
//     (back faces) are pale cream;
//   • petals lean on the pigment rather than the light, so they read as washes;
//   • pigment pools softly at the edges of each wash;
//   • paper: soft blotches and grain, fixed to the page (screen), not the plant.
// The dry/dead tint still works: it multiplies the material colour after the remap.

export const wash = {
  /** How far petal lighting is flattened towards the pigment (0 lit … 1 flat). */
  flat: { value: 0.42 },
  /** The same for leaves before their tonal squeeze (see opaque_fragment). */
  leafFlat: { value: 0.12 },
  light: { value: 1.08 },
  /** Pigment pooling at silhouette edges, petals and leaves. */
  edge: { value: 0.35 },
  leafEdge: { value: 0.55 },
  blot: { value: 0.08 },
  grain: { value: 0.02 },
  /** How much of the pads' bump map is removed. */
  leafBump: { value: 0.85 }
}

/** A flower's own petal colours (sRGB): pale → mid → vivid, the gold of its
 * heart, and `key`, the texel colour weights that say how vivid a petal
 * texel is (the lotus: red minus green, i.e. how pink). `heart`: 0 lets
 * petal texels turn gold where the texture is golden (a chrysanthemum's
 * orange), 1 keeps gold off the petals (the lotus). */
export type Palette = { pale: string; mid: string; vivid: string; goldDeep: string; gold: string; key: [number, number, number]; heart: number }

// Sampled from the print. The petals' pale parts, a blush rather than cream
// (Simon: more pink).
export const LOTUS_PALETTE: Palette = {
  pale: '#fbe3e4',
  mid: '#f7c3cc',
  vivid: '#e8768f',
  goldDeep: '#d6a521',
  gold: '#f2d258',
  key: [1, -1, 0],
  heart: 1
}

const PALETTE = {
  SAGE_DEEP: '#245c45',
  SAGE: '#5b9468',
  SAGE_LIGHT: '#9cc28c',
  UNDERSIDE: '#e4e3c4'
}

/** The plant passes through the pot's wall here and there (leaves droop and
 * sway, and nothing stops them). Rather than push it out, which twitches, the
 * plant's shader hides whatever is outside the wall and below the lip: a
 * pad through the wall then simply reads as tucked inside the bowl. In the
 * pot's frame; `fromWorld` is set each frame (Flower). */
export const potCut = {
  fromWorld: { value: new THREE.Matrix4() },
  wall: { value: OUTER_WALL.map(([r, y]) => new THREE.Vector2(r, y)) },
  lip: { value: LIP },
  oval: { value: SUIBAN.oval }
}

const POT_CUT_HEAD = /* glsl */ `
uniform vec2 uPotWall[${OUTER_WALL.length}];
uniform float uPotLip;
uniform float uPotOval;
varying vec3 vPotPos;
float potWall(float y) {
  float r = uPotWall[0].x;
  for (int i = 0; i < ${OUTER_WALL.length - 1}; i++) {
    vec2 a = uPotWall[i];
    vec2 b = uPotWall[i + 1];
    if (y >= a.y && y <= b.y) r = mix(a.x, b.x, (y - a.y) / max(b.y - a.y, 1e-4));
  }
  if (y > uPotWall[${OUTER_WALL.length - 1}].y) r = uPotWall[${OUTER_WALL.length - 1}].x;
  return r;
}
`

const vec3 = (hex: string) => {
  const c = new THREE.Color().setStyle(hex, THREE.NoColorSpace)
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`
}

const GLSL_HEAD = /* glsl */ `
uniform float uWashFlat;
uniform float uWashLeafFlat;
uniform float uWashLight;
uniform float uWashEdge;
uniform float uWashLeafEdge;
uniform float uWashBlot;
uniform float uWashGrain;
uniform float uWashLeafBump;
uniform vec3 WC_CREAM;
uniform vec3 WC_PINK;
uniform vec3 WC_PINK_VIVID;
uniform vec3 WC_GOLD_DEEP;
uniform vec3 WC_GOLD;
uniform vec3 uWcKey;
uniform float uWcHeart;
varying vec3 vWcPart;
${Object.entries(PALETTE)
  .map(([k, hex]) => `const vec3 WC_${k} = ${vec3(hex)};`)
  .join('\n')}

float wcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wcNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wcHash(i), wcHash(i + vec2(1.0, 0.0)), f.x),
             mix(wcHash(i + vec2(0.0, 1.0)), wcHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Linear texels in (crisp and slightly blurred), linear print colour out, with
// how much of it is leaf in .a. Classification happens in sRGB, where "pink",
// "green" and "gold" mean what they look like; the rig overrides it where it
// knows better (part: x leaf, y petal, z pad rim).
vec4 wcPalette(vec3 lin, vec3 soft, vec3 part, bool front) {
  vec3 c = pow(max(lin, 0.0), vec3(1.0 / 2.2));
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 cs = pow(max(soft, 0.0), vec3(1.0 / 2.2));
  float sL = dot(cs, vec3(0.2126, 0.7152, 0.0722));
  float isLeaf = smoothstep(0.3, 0.7, part.x);
  float isPetal = smoothstep(0.2, 0.6, part.y);
  // A pale vein inside a pad is still pad: judge green on the blurred texel too.
  float green = max(
    smoothstep(0.015, 0.09, c.g - c.r) * (1.0 - smoothstep(0.86, 0.95, L)),
    smoothstep(0.04, 0.1, cs.g - cs.r) * (1.0 - smoothstep(0.8, 0.9, sL))
  );
  green = max(green * (1.0 - isPetal), isLeaf);
  float gold = smoothstep(0.26, 0.45, min(c.r, c.g) - c.b) * (1.0 - green) * (1.0 - isPetal * uWcHeart);
  float pink = smoothstep(0.02, 0.2, dot(c, uWcKey));

  // Cream at the base, flushing pink, vivid at the tips.
  // Never quite white: a little of the pink everywhere.
  vec3 petal = mix(WC_CREAM, WC_PINK, max(0.1, smoothstep(0.0, 0.6, pink)));
  petal = mix(petal, WC_PINK_VIVID, smoothstep(0.45, 1.0, pink) * 0.75);
  petal *= mix(0.94, 1.02, smoothstep(0.5, 0.95, L));

  // One sage tone per area; the light does the shading. Rims run lighter.
  vec3 leaf = mix(WC_SAGE_DEEP, WC_SAGE, 0.45 + 0.55 * smoothstep(0.15, 0.45, sL));
  leaf = mix(leaf, WC_SAGE_LIGHT, 0.45 * smoothstep(0.2, 1.0, part.z) * isLeaf);
  // Gentle: the cracked mesh shows back faces through hairline gaps, which
  // would read as pale specks at full strength.
  if (!front) leaf = mix(leaf, WC_UNDERSIDE, 0.35 * isLeaf);

  vec3 heart = mix(WC_GOLD_DEEP, WC_GOLD, smoothstep(0.4, 0.8, L));

  vec3 col = mix(mix(petal, leaf, green), heart, gold);
  return vec4(pow(col, vec3(2.2)), green);
}
void main() {`

const srgb = (hex: string) => new THREE.Color().setStyle(hex, THREE.NoColorSpace)

export function makeWatercolour(material: THREE.MeshStandardMaterial, opts: { potCut?: boolean; palette?: Palette; vertexPaint?: boolean } = {}) {
  if (opts.vertexPaint) material.defines = { ...material.defines, WC_VERTEX_PAINT: '' }
  const pal = opts.palette ?? LOTUS_PALETTE
  // Per material, so each flower keeps its own colours on the shared program.
  const colours = {
    WC_CREAM: { value: srgb(pal.pale) },
    WC_PINK: { value: srgb(pal.mid) },
    WC_PINK_VIVID: { value: srgb(pal.vivid) },
    WC_GOLD_DEEP: { value: srgb(pal.goldDeep) },
    WC_GOLD: { value: srgb(pal.gold) },
    uWcKey: { value: new THREE.Vector3(...pal.key) },
    uWcHeart: { value: pal.heart }
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, colours)
    if (opts.potCut) {
      shader.uniforms.uPotFromWorld = potCut.fromWorld
      shader.uniforms.uPotWall = potCut.wall
      shader.uniforms.uPotLip = potCut.lip
      shader.uniforms.uPotOval = potCut.oval
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'uniform mat4 uPotFromWorld;\nvarying vec3 vPotPos;\nvoid main() {')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n  vPotPos = (uPotFromWorld * modelMatrix * vec4(transformed, 1.0)).xyz;'
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', POT_CUT_HEAD + 'void main() {')
        .replace(
          '#include <clipping_planes_fragment>',
          /* glsl */ `#include <clipping_planes_fragment>
          if (vPotPos.y < uPotLip && length(vec2(vPotPos.x, vPotPos.z / uPotOval)) > potWall(vPotPos.y) - 0.004) discard;`
        )
    }
    shader.uniforms.uWashFlat = wash.flat
    shader.uniforms.uWashLeafFlat = wash.leafFlat
    shader.uniforms.uWashLight = wash.light
    shader.uniforms.uWashEdge = wash.edge
    shader.uniforms.uWashLeafEdge = wash.leafEdge
    shader.uniforms.uWashBlot = wash.blot
    shader.uniforms.uWashGrain = wash.grain
    shader.uniforms.uWashLeafBump = wash.leafBump
    // Per-vertex parts from the rig (see markParts); 0 where absent.
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec3 wcPart;\nvarying vec3 vWcPart;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWcPart = wcPart;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', GLSL_HEAD)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `float wcLeaf = 0.0;
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          vec4 wcPaint = wcPalette(sampledDiffuseColor.rgb, texture2D(map, vMapUv, 1.5).rgb, vWcPart, gl_FrontFacing);
          sampledDiffuseColor.rgb = wcPaint.rgb;
          wcLeaf = wcPaint.a;
          diffuseColor *= sampledDiffuseColor;
        #elif defined( USE_COLOR ) && defined( WC_VERTEX_PAINT )
          // Untextured models (autorig --paint): their baked vertex colours
          // take the texture's place, through the same palette. (Not the
          // basin: its vertex colours are its painted band, kept as they are.)
          vec4 wcPaint = wcPalette(vColor.rgb, vColor.rgb, vWcPart, gl_FrontFacing);
          diffuseColor.rgb *= wcPaint.rgb;
          wcLeaf = wcPaint.a;
        #endif`
      )
      // (Vertex colours on an untextured model are already painted in above.)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#if defined( USE_COLOR ) && !defined( WC_VERTEX_PAINT )
          diffuseColor.rgb *= vColor.rgb;
        #endif`
      )
      // Leaves lose most of their bump detail; petals keep theirs.
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, wcLeaf * uWashLeafBump));`
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `{
          // Washes: petals lean on the pigment. Leaves keep their light, but
          // squeezed into a painter's tonal range: shadowed sage to a lifted
          // highlight, never blown out where a pad faces the light.
          float wcFlat = mix(uWashFlat, uWashLeafFlat, wcLeaf);
          vec3 wcPetalLight = mix(outgoingLight, diffuseColor.rgb * uWashLight, wcFlat);
          float wcLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          float wcShade = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)) / max(wcLum, 1e-4);
          vec3 wcLeafLight = diffuseColor.rgb * (0.58 + 0.5 * smoothstep(0.1, 1.8, wcShade));
          outgoingLight = mix(wcPetalLight, wcLeafLight, wcLeaf);
          // Pigment pools where a wash turns away from you.
          float wcFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
          float wcEdge = (1.0 - smoothstep(0.0, 0.55, wcFacing)) * mix(uWashEdge, uWashLeafEdge, wcLeaf);
          outgoingLight = mix(outgoingLight, pow(outgoingLight, vec3(1.4)) * 0.92, wcEdge);
          // Paper: soft blotches and grain, fixed to the page.
          vec2 wcPx = gl_FragCoord.xy;
          float wcBlot = wcNoise(wcPx / 42.0) * 0.6 + wcNoise(wcPx / 12.0) * 0.4;
          outgoingLight *= 1.0 + (wcBlot - 0.5) * uWashBlot + (wcHash(floor(wcPx)) - 0.5) * uWashGrain;
        }
        #include <opaque_fragment>`
      )
  }
  // Distinct program from undecorated standard materials.
  material.customProgramCacheKey = () => `sip-watercolour${opts.potCut ? '-cut' : ''}${opts.vertexPaint ? '-paint' : ''}`
  material.needsUpdate = true
}

const PETAL = /^(bud[_.\- ]?\d+[_.\- ])?petal/i
const RIM = /_rim/i
const STALK = /^stalk[_.\- ]?(\d+)/i
const BUD = /^bud[_.\- ]?(\d+)/i

/** Tag every vertex from its skin weights: x = pad, stalk or stem (always
 * leaf, whatever the texture says, which also hides UV-seam bleed), y = petal
 * (never green), z = pad rim (lighter, like the print). A bud's own stalk is
 * left to the texture: its lower half is green sepals, its tip pink. */
export function markParts(mesh: THREE.SkinnedMesh, opts: { textureBranches?: boolean } = {}) {
  const geo = mesh.geometry
  // A model built in code (the daisy) tags its own vertices: its stalks sit
  // under the bloom bones but are leaf.
  if (geo.getAttribute('wcPart')) return
  const idx = geo.getAttribute('skinIndex')
  const wt = geo.getAttribute('skinWeight')
  if (!idx || !wt || !mesh.skeleton) return
  const names = mesh.skeleton.bones.map((b) => b.name)
  const budStalks = new Set(names.map((n) => BUD.exec(n)?.[1]).filter(Boolean))
  const kind = names.map((n) => {
    const stalk = STALK.exec(n)
    if (stalk) return budStalks.has(stalk[1]) ? 0 : 1
    // A bush whose small flowers are painted onto its leaves (the shrub):
    // its branches are left to the texture, or they'd be painted green.
    if (opts.textureBranches && /^branch/i.test(n)) return 0
    if (/^(leaf|stem|branch)/i.test(n)) return RIM.test(n) ? 3 : 1
    return PETAL.test(n) || /^bloom/i.test(n) ? 2 : 0
  })
  const out = new Float32Array(idx.count * 3)
  for (let i = 0; i < idx.count; i++) {
    for (let k = 0; k < 4; k++) {
      const w = wt.getComponent(i, k)
      const kd = kind[idx.getComponent(i, k)]
      if (kd === 1 || kd === 3) out[i * 3] += w
      if (kd === 2) out[i * 3 + 1] += w
      if (kd === 3) out[i * 3 + 2] += w
    }
  }
  geo.setAttribute('wcPart', new THREE.BufferAttribute(out, 3))
}
