import type { FlowerId } from '../../../shared/diary'
import type { Palette } from './watercolour'

// Data-only description of each flower type. The placeholder builder turns a
// spec into a block model; the rig driver uses the `wilt` half of the spec to
// pose *any* model that follows the rig contract (see docs/FLOWERS.md).

export type Deg = number

export type Stage = [from: number, to: number]

export type WiltSpec = {
  /** Per stem segment, bend at full wilt, around the segment's local `stemAxis`. */
  stemBend: Deg[]
  /** Local axis stems bend around. +Z bends the top towards screen left. */
  stemAxis: [number, number, number]
  /** Extra head rotation at full wilt, around `headAxis` (local). */
  headDroop: Deg
  headAxis: [number, number, number]
  /** Grown and watered, the bloom nods towards the screen so you see its face.
   * Applied around the world's left-right axis, so it doesn't depend on bone roll. */
  faceTilt: Deg
  /** Petals rotate around their local X (hinge). + folds them outward/down. */
  petalCurl: Deg
  /** Petals also shrivel along their length (1 = no change). */
  petalShrink: number
  /** Leaves rotate around their local Z. + sags them downward. (On stalked
   * pads, autorig v2: the whole pad droops outward.) */
  leafSag: Deg
  /** Stalked pads only: tilt the face towards the viewer when fresh. */
  leafFace?: Deg
  /** Stalked pads only: lean out from the stem at rest. */
  leafSpread?: Deg
  /** Pad rims curl down at full wilt. */
  leafCurl?: Deg
  /** Side stalks bow outward at full wilt (spread along the stalk). */
  stalkSag?: Deg
  /** Side stalks lean out from the stem at rest, so pads don't crowd it. */
  stalkSpread?: Deg
  /** A bud's stalk leans out further, so the bud stands clear of the bloom. */
  budSpread?: Deg
  /** Petal tips and pad rims flutter after a cursor brush, at most this much. */
  flutter?: Deg
  /** A side bud (a small bloom) shut, as a share of its size open. */
  budSize?: number
  /** Spikes and clumps (autorig v3): branches bow out by `sag` when thirsty,
   * start furled up by `furl` (degrees), unfurl in turn over `stagger` of the
   * growth, and start `grow` smaller. Full grown they are `scale` of the
   * model's (default 1); the flowers they carry keep their own size. */
  branch?: { sag: Deg; furl: Deg; stagger: number; grow: number; scale?: number }
  /** autorig v3 flowers: open from growth `from`, each over `span`, spread
   * over `stagger` (bottom up if `up`, from the middle out if `outward`,
   * else scattered); a shut bud is
   * `bud` = [across, along] of the open size, and open they reach `size`
   * of the model's (default 1). */
  bloom?: { from: number; span: number; stagger: number; up: boolean; bud: [number, number]; size?: number; outward?: boolean }
  /** Full grown (the goal reached): pads scale by `leaves`, the main stem
   * stretches by `stem`. */
  mature?: { leaves: number; stem: number }
  /** How far along the thirst curve each part starts and finishes moving. */
  stages: { stem: Stage; head: Stage; petals: Stage; leaves: Stage; color: Stage }
  /** Recovery spring. Lower damping = more overshoot when you drink. */
  spring: { stiffness: number; damping: number }
}

export type PetalRing = {
  count: number
  /** Petal block size: width, length, thickness. */
  size: [number, number, number]
  /** Tilt away from the head's up axis when hydrated. 0 = upright cup, 90 = flat ray. */
  open: Deg
  /** Ring rotation offset around the head. */
  phase: Deg
  /** Distance of the hinge from the head centre. */
  radius: number
  /** Height of the hinge above the head origin. */
  lift: number
}

export type LeafSpec = {
  /** Which stem segment it grows from, and how far along it (0..1). */
  segment: number
  along: number
  /** Direction around the stem, degrees. 0 = screen right, 180 = screen left. */
  side: Deg
  /** Tilt up from horizontal when hydrated. */
  tilt: Deg
  size: [number, number, number]
}

export type FlowerSpec = {
  id: FlowerId
  label: string
  /** Uniform scale so every type fits the window. */
  scale: number
  /** The pot: `height` is where the plant stands (the suiban's floor, under
   * the water), `width` its span. Null: a garden plant with no pot, standing
   * on the ground (no glaze, nothing hidden by a pot's wall). */
  pot: { width: number; height: number } | null
  /** A GLB's height above the soil (default 2): a wide bush stands lower so
   * it fits the window. */
  height?: number
  /** Plant a GLB by where it leaves the soil, not its bounding box's middle
   * (a plant that leans). */
  rootAtBase?: boolean
  /** Colour the branches from the texture instead of always as leaf: for a
   * bush whose small flowers are painted onto its leaves. */
  textureBranches?: boolean
  /** The watercolour's petal colours (default: the lotus's pinks). */
  palette?: Palette
  /** Upper stem length as a share of the model's (below 1 shortens). */
  stemLength?: number
  /** A bud's stalk, the same way (above 1 lengthens). */
  budLength?: number
  stem: { segments: number; length: number; thickness: number; taper: number }
  head: {
    /** Rest rotation of the head around local X, + tilts the face towards the viewer. */
    pitch: Deg
    /** Centre block: width, height, depth (a disc is a flat wide box). */
    core: [number, number, number]
    rings: PetalRing[]
  }
  leaves: LeafSpec[]
  wilt: WiltSpec
}

// The lotus (Meshy model, auto-rigged: resources/flowers/lotus.glb). The
// geometry below is only its grey stand-in, used if the model can't load.
const lotus: FlowerSpec = {
  id: 'lotus',
  label: 'Lotus',
  scale: 1,
  pot: { width: 1.56, height: 0.13 },
  // A little lotus in a water basin: a shorter stalk than the Meshy model's.
  stemLength: 0.75,
  stem: { segments: 6, length: 0.25, thickness: 0.05, taper: 0.92 },
  head: {
    pitch: 0,
    core: [0.16, 0.1, 0.16],
    rings: [
      { count: 6, size: [0.13, 0.3, 0.04], open: 22, phase: 0, radius: 0.06, lift: 0.03 },
      { count: 8, size: [0.15, 0.32, 0.04], open: 52, phase: 22, radius: 0.1, lift: 0 }
    ]
  },
  leaves: [
    { segment: 1, along: 0.4, side: 20, tilt: 8, size: [0.56, 0.04, 0.42] },
    { segment: 2, along: 0.2, side: 200, tilt: 12, size: [0.5, 0.04, 0.38] }
  ],
  wilt: {
    // A long, soft stem carrying a heavy bloom: it bows from the middle up,
    // the bloom hangs, its outer petals fall open, the pads sag at the edges.
    // Kept modest: the bloom is wide, and fully wilted it has to stay in the window.
    stemBend: [1, 3, 5, 8, 11, 12],
    stemAxis: [0, 0.2, 1],
    headDroop: 52,
    headAxis: [0.3, 0, 1],
    faceTilt: 22,
    petalCurl: 38,
    petalShrink: 0.88,
    leafSag: 32,
    leafFace: 12,
    leafSpread: 4,
    leafCurl: 26,
    stalkSag: 16,
    stalkSpread: 5,
    budSpread: 16,
    flutter: 9,
    budSize: 0.72,
    mature: { leaves: 1.14, stem: 1.12 },
    stages: {
      stem: [0.05, 0.95],
      head: [0.2, 1],
      petals: [0.45, 1],
      leaves: [0, 0.75],
      color: [0.3, 1]
    },
    spring: { stiffness: 110, damping: 9 }
  }
}

// The three below are Meshy models rigged by autorig v3 (`--mode spike` /
// `--mode clump`): no single bloom on a stem, but many flowers (bloom_N) on
// branches (branch_N_K). Their placeholder geometry is a rough stand-in.

// A blue blossom: a tall spike of florets over a fan of grassy leaves. The
// leaves unfurl up the stem, then the florets open from the bottom up, as a
// delphinium's do. Thirsty, the tall stem bows from the middle and the
// florets nod.
const blossom: FlowerSpec = {
  id: 'blossom',
  label: 'Blossom',
  scale: 1,
  pot: { width: 1.56, height: 0.13 },
  palette: {
    pale: '#e3eaf8',
    mid: '#9fb7ea',
    vivid: '#3f5fc8',
    goldDeep: '#d39a2a',
    gold: '#f1cf63',
    key: [-0.5, -0.5, 1],
    heart: 1
  },
  stem: { segments: 8, length: 0.24, thickness: 0.035, taper: 0.9 },
  head: {
    pitch: 0,
    core: [0.1, 0.16, 0.1],
    rings: [{ count: 5, size: [0.08, 0.14, 0.03], open: 60, phase: 0, radius: 0.04, lift: 0 }]
  },
  leaves: [
    { segment: 0, along: 0.3, side: 30, tilt: 20, size: [0.4, 0.03, 0.12] },
    { segment: 0, along: 0.3, side: 210, tilt: 20, size: [0.4, 0.03, 0.12] }
  ],
  wilt: {
    stemBend: [0, 1, 2, 4, 6, 8, 9, 10],
    stemAxis: [0, 0.2, 1],
    headDroop: 40,
    headAxis: [0.3, 0, 1],
    faceTilt: 0,
    petalCurl: 30,
    petalShrink: 0.86,
    leafSag: 28,
    flutter: 7,
    branch: { sag: 30, furl: 45, stagger: 0.45, grow: 0.5 },
    bloom: { from: 0.34, span: 0.24, stagger: 0.38, up: true, bud: [0.32, 0.55] },
    stages: {
      stem: [0.05, 0.95],
      head: [0.2, 1],
      petals: [0.4, 1],
      leaves: [0, 0.75],
      color: [0.3, 1]
    },
    spring: { stiffness: 120, damping: 9 }
  }
}

// A chrysanthemum bush: a clump of stalks and glossy leaves under six orange
// heads. The stalks fan out from the crown, the buds come up scattered and
// open one by one. Thirsty, the clump slumps open and the heavy heads hang.
const chrysanthemum: FlowerSpec = {
  id: 'chrysanthemum',
  label: 'Chrysanthemum',
  scale: 1,
  height: 1.8,
  pot: { width: 1.56, height: 0.13 },
  palette: {
    pale: '#fde3c4',
    mid: '#f3a255',
    vivid: '#d4552a',
    goldDeep: '#c98f1c',
    gold: '#f0c94a',
    key: [1, -0.5, -0.5],
    heart: 0.6
  },
  stem: { segments: 3, length: 0.3, thickness: 0.05, taper: 0.9 },
  head: {
    pitch: 0,
    core: [0.12, 0.06, 0.12],
    rings: [{ count: 12, size: [0.07, 0.2, 0.03], open: 70, phase: 0, radius: 0.06, lift: 0 }]
  },
  leaves: [
    { segment: 0, along: 0.6, side: 20, tilt: 15, size: [0.34, 0.04, 0.18] },
    { segment: 1, along: 0.4, side: 200, tilt: 15, size: [0.34, 0.04, 0.18] }
  ],
  wilt: {
    stemBend: [2, 3, 4],
    stemAxis: [0, 0.2, 1],
    headDroop: 48,
    headAxis: [0.3, 0, 1],
    faceTilt: 0,
    petalCurl: 34,
    petalShrink: 0.84,
    leafSag: 30,
    flutter: 6,
    branch: { sag: 24, furl: 40, stagger: 0.3, grow: 0.45 },
    // Buds wait until the stalks are tall enough to carry them visibly.
    bloom: { from: 0.48, span: 0.24, stagger: 0.24, up: false, bud: [0.42, 0.5] },
    stages: {
      stem: [0.05, 0.95],
      head: [0.15, 1],
      petals: [0.4, 1],
      leaves: [0, 0.8],
      color: [0.3, 1]
    },
    spring: { stiffness: 100, damping: 8 }
  }
}

// A dense shrub: a dome of small dark leaves, starred with little white
// flowers. It grows as a round bush filling out from the crown; the flowers
// come late and all at once, popping open across it. Thirsty, it barely
// moves (woody), only the outer sprays sag.
const shrub: FlowerSpec = {
  id: 'shrub',
  label: 'Shrub',
  scale: 1,
  // Most of its flowers are painted onto the leaves in the texture.
  textureBranches: true,
  height: 1.15,
  pot: { width: 1.56, height: 0.13 },
  // White, with a blush, so it doesn't read as holes in the paper.
  palette: {
    pale: '#fbf0ee',
    mid: '#f3dde0',
    vivid: '#e7b8c3',
    goldDeep: '#d0a43a',
    gold: '#f1d77a',
    key: [1, -1, 0],
    heart: 1
  },
  stem: { segments: 2, length: 0.2, thickness: 0.05, taper: 0.9 },
  head: {
    pitch: 0,
    core: [0.5, 0.4, 0.5],
    rings: []
  },
  leaves: [
    { segment: 0, along: 0.6, side: 20, tilt: 25, size: [0.4, 0.05, 0.3] },
    { segment: 0, along: 0.6, side: 200, tilt: 25, size: [0.4, 0.05, 0.3] }
  ],
  wilt: {
    stemBend: [1, 2],
    stemAxis: [0, 0.2, 1],
    headDroop: 30,
    headAxis: [0.3, 0, 1],
    faceTilt: 0,
    petalCurl: 20,
    petalShrink: 0.8,
    leafSag: 18,
    flutter: 4,
    branch: { sag: 14, furl: 30, stagger: 0.35, grow: 0.5 },
    // The model's flowers are tiny: open, they're drawn a touch larger.
    bloom: { from: 0.55, span: 0.16, stagger: 0.28, up: false, bud: [0.25, 0.35], size: 1.15 },
    stages: {
      stem: [0.05, 0.95],
      head: [0.2, 1],
      petals: [0.3, 1],
      leaves: [0.1, 0.9],
      color: [0.35, 1]
    },
    spring: { stiffness: 140, damping: 11 }
  }
}

// The iris and the lily of the valley are untextured Meshy models: autorig
// finds their flowers by shape and bakes the colours in (`--paint`).

// An iris spray: a loose fan of lilac fringed flowers on long thin stalks,
// buds along them. A garden plant, so no pot: it stands on the ground. The
// stalks rise and fan out first; the flowers come late, scattered.
const iris: FlowerSpec = {
  id: 'iris',
  label: 'Iris',
  scale: 1,
  rootAtBase: true,
  height: 1.6,
  pot: null,
  palette: {
    pale: '#efeafb',
    mid: '#c6b8f0',
    vivid: '#8b74d6',
    goldDeep: '#d6a521',
    gold: '#f2d258',
    key: [-0.5, -0.5, 1],
    heart: 0
  },
  stem: { segments: 4, length: 0.3, thickness: 0.025, taper: 0.9 },
  head: {
    pitch: 0,
    core: [0.05, 0.05, 0.05],
    rings: [{ count: 6, size: [0.08, 0.16, 0.02], open: 70, phase: 0, radius: 0.03, lift: 0 }]
  },
  leaves: [],
  wilt: {
    stemBend: [2, 3],
    stemAxis: [0, 0.2, 1],
    headDroop: 40,
    headAxis: [0.3, 0, 1],
    faceTilt: 0,
    petalCurl: 30,
    petalShrink: 0.84,
    leafSag: 24,
    flutter: 8,
    // Thin stalks: a gentle furl, or young ones bunch into a knot.
    branch: { sag: 22, furl: 22, stagger: 0.4, grow: 0.55 },
    bloom: { from: 0.45, span: 0.22, stagger: 0.3, up: false, bud: [0.3, 0.6] },
    stages: {
      stem: [0.05, 0.95],
      head: [0.15, 1],
      petals: [0.35, 1],
      leaves: [0, 0.8],
      color: [0.3, 1]
    },
    spring: { stiffness: 110, damping: 8 }
  }
}

// A lily of the valley in the app's pot: two broad leaves, about 60% of the
// stalk's height, and an arching stalk of small white bells above and in
// front of them, green buds at its tip. The leaves rise and
// unroll first, the stalk arches up after them, and the bells swell from
// buds and open last, hanging down. Thirsty, the leaves flop open.
const lily: FlowerSpec = {
  id: 'lily',
  label: 'Lily of the valley',
  scale: 1,
  // It leans well over to one side: planted by its base, in the basin's middle.
  rootAtBase: true,
  pot: { width: 1.56, height: 0.13 },
  palette: {
    pale: '#fbfbf4',
    mid: '#eef3dd',
    vivid: '#c7dca8',
    goldDeep: '#d6a521',
    gold: '#f2d258',
    key: [-0.5, 1, -0.5],
    heart: 1
  },
  stem: { segments: 3, length: 0.3, thickness: 0.03, taper: 0.9 },
  head: {
    pitch: 0,
    core: [0.06, 0.08, 0.06],
    rings: [{ count: 6, size: [0.05, 0.08, 0.02], open: 30, phase: 0, radius: 0.02, lift: 0 }]
  },
  leaves: [
    { segment: 0, along: 0.5, side: 20, tilt: 60, size: [0.7, 0.03, 0.2] },
    { segment: 0, along: 0.5, side: 200, tilt: 60, size: [0.7, 0.03, 0.2] }
  ],
  wilt: {
    stemBend: [2, 3],
    stemAxis: [0, 0.2, 1],
    headDroop: 22,
    headAxis: [0.3, 0, 1],
    faceTilt: 0,
    petalCurl: 24,
    petalShrink: 0.85,
    leafSag: 30,
    flutter: 6,
    // (Meshy's leaves towered over the bells: autorig shrinks them at rig
    // time, --shrink-leaves. The arching stalk spans the crown's sectors, so
    // a gentle sag: a deep one shears it.)
    branch: { sag: 15, furl: 55, stagger: 0.35, grow: 0.5 },
    bloom: { from: 0.5, span: 0.2, stagger: 0.28, up: true, bud: [0.45, 0.55] },
    stages: {
      stem: [0.05, 0.95],
      head: [0.2, 1],
      petals: [0.4, 1],
      leaves: [0, 0.75],
      color: [0.3, 1]
    },
    spring: { stiffness: 110, damping: 9 }
  }
}

// A jasmine: a low rounded bush of glossy dark leaves, covered last in small
// white stars. Untextured (its pot cut away, --cut-pot); the stars are found
// from their centres and grown out over their flat petals (--flat-petals).
// The bush fills out from the crown, the leaves unfurl, then the stars open
// scattered all over it.
const jasmine: FlowerSpec = {
  id: 'jasmine',
  label: 'Jasmine',
  scale: 1,
  height: 0.95,
  pot: { width: 1.56, height: 0.13 },
  palette: {
    pale: '#fdfdf8',
    mid: '#f6f4e6',
    vivid: '#ece6c8',
    goldDeep: '#d6a521',
    gold: '#f2d258',
    key: [0.5, 0.5, -1],
    heart: 0
  },
  stem: { segments: 2, length: 0.2, thickness: 0.04, taper: 0.9 },
  head: {
    pitch: 0,
    core: [0.4, 0.3, 0.4],
    rings: []
  },
  leaves: [
    { segment: 0, along: 0.6, side: 20, tilt: 25, size: [0.4, 0.04, 0.2] },
    { segment: 0, along: 0.6, side: 200, tilt: 25, size: [0.4, 0.04, 0.2] }
  ],
  wilt: {
    stemBend: [1, 2],
    stemAxis: [0, 0.2, 1],
    headDroop: 30,
    headAxis: [0.3, 0, 1],
    faceTilt: 0,
    petalCurl: 22,
    petalShrink: 0.82,
    leafSag: 20,
    flutter: 5,
    branch: { sag: 16, furl: 35, stagger: 0.35, grow: 0.5 },
    bloom: { from: 0.55, span: 0.18, stagger: 0.27, up: false, bud: [0.3, 0.5] },
    stages: {
      stem: [0.05, 0.95],
      head: [0.2, 1],
      petals: [0.3, 1],
      leaves: [0.1, 0.9],
      color: [0.35, 1]
    },
    spring: { stiffness: 130, damping: 10 }
  }
}

// The daisy patch is built in code (daisy.ts), no Meshy model: a low carpet
// of small white daisies, a few pale blue, on short stalks over a mat of
// grass and rosette leaves. A garden plant: no pot, it stands on the ground.
// Young, the mat is a few green sprigs furled up at the crown; the mat
// spreads flat and the heads come up and open from the middle out, until
// the carpet domes a little and spills over the edge. Thirsty, the mat
// flops flat and the heads nod and shrink.
const daisy: FlowerSpec = {
  id: 'daisy',
  label: 'Daisy patch',
  scale: 1,
  rootAtBase: true,
  // Authored at about this height, so it's used as built: a carpet, not a bush.
  height: 0.3,
  pot: null,
  // White, with a pale blue wash for the odd head; gold hearts (heart 0 lets
  // the yellow through on bloom vertices).
  palette: {
    pale: '#fdfdf8',
    mid: '#e2e9f7',
    vivid: '#b8c9ec',
    goldDeep: '#e3bd4a',
    gold: '#f8e287',
    key: [-0.5, -0.5, 1],
    heart: 0
  },
  stem: { segments: 2, length: 0.1, thickness: 0.04, taper: 0.9 },
  head: {
    pitch: 0,
    core: [0.5, 0.2, 0.5],
    rings: []
  },
  leaves: [
    { segment: 0, along: 0.5, side: 20, tilt: 10, size: [0.4, 0.03, 0.2] },
    { segment: 0, along: 0.5, side: 200, tilt: 10, size: [0.4, 0.03, 0.2] }
  ],
  wilt: {
    // The whole carpet barely tips; it's the heads that show thirst.
    stemBend: [1, 2],
    stemAxis: [0, 0.2, 1],
    headDroop: 55,
    headAxis: [0.3, 0, 1],
    faceTilt: 0,
    petalCurl: 20,
    petalShrink: 0.8,
    leafSag: 20,
    flutter: 9,
    // The mat's sectors lie 20° above flat: a 14° sag lays them down.
    // The mat is wide: young, its sectors start small (grow 0.72), or the
    // furled sprigs would stand tall.
    branch: { sag: 14, furl: 50, stagger: 0.4, grow: 0.72 },
    // Heads come up early and keep coming, middle first, the rim last.
    bloom: { from: 0.22, span: 0.2, stagger: 0.5, up: false, bud: [0.35, 0.45], outward: true },
    stages: {
      stem: [0.05, 0.95],
      head: [0.15, 1],
      petals: [0.35, 1],
      leaves: [0, 0.8],
      color: [0.3, 1]
    },
    spring: { stiffness: 120, damping: 9 }
  }
}

// Baby blue eyes (nemophila), on the daisies' patch builder (nemophila.ts):
// a low haze of sky-blue cups with white throats over feathery leaves. A
// garden plant like the daisies, grown and posed the same way; the cups
// come up a little later and all over, the way a field hazes blue.
const nemophila: FlowerSpec = {
  ...daisy,
  id: 'nemophila',
  label: 'Baby blue eyes',
  height: 0.26,
  // Sky blue at the rim to white at the throat; pale yellow-green middles.
  palette: {
    pale: '#f7fbff',
    mid: '#a9cbff',
    vivid: '#4d8ef0',
    goldDeep: '#c4d27a',
    gold: '#e4eca8',
    key: [-0.6, -0.4, 1],
    heart: 0
  },
  wilt: {
    ...daisy.wilt,
    headDroop: 50,
    bloom: { from: 0.26, span: 0.2, stagger: 0.46, up: false, bud: [0.35, 0.45], outward: true }
  }
}

export const FLOWER_SPECS: Record<FlowerId, FlowerSpec> = { lotus, blossom, chrysanthemum, shrub, iris, lily, jasmine, daisy, nemophila }
