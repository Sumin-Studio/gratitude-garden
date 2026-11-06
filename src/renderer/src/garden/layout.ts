// Where everything in the garden is, as plain numbers, no three.js. World
// units are about a metre; y is up. Rolling grass with no walls: the hills run
// on until they dissolve into the blue, and the pond lies in the middle ground.

/** Where the sun is, from the ground: back-left, high up. */
export const SUN: [number, number, number] = [-0.42, 1, -0.62]

export const POND = { x: -4.1, z: 6.2, rx: 4.5, rz: 3.5 }

/** How far out the bank is at this bearing, as a share of the ellipse. */
export function pondEdge(angle: number) {
  return 1 + 0.06 * Math.sin(2 * angle + 1) + 0.05 * Math.sin(3 * angle + 2.2) + 0.025 * Math.sin(5 * angle)
}

/** Distance from the bank as a share of the radius: < 0 inside, 0 on it. */
export function pondDist(x: number, z: number) {
  const dx = (x - POND.x) / POND.rx
  const dz = (z - POND.z) / POND.rz
  return Math.hypot(dx, dz) / pondEdge(Math.atan2(dz, dx)) - 1
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** The lawn: soft round hills, level at the pond's bank. */
export function heightAt(x: number, z: number) {
  const swell =
    1.5 * (Math.sin(x * 0.17 + 0.6) * 0.5 + 0.5) * (Math.sin(z * 0.2 + 1.4) * 0.5 + 0.5) +
    0.5 * (Math.sin(x * 0.29 - z * 0.16 + 2) * 0.5 + 0.5)
  return swell * smooth(0.02, 0.7, pondDist(x, z))
}

export function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `land`: planted in the grass (y follows the hills), not in the pond. */
export type Slot = { x: number; y: number; z: number; turn: number; scale: number; rise?: number; land?: boolean; tall?: number; kind?: string }

/** A flower's differences from every other, always the same for its id. */
export function character(id: string) {
  let seed = 7
  for (let i = 0; i < id.length; i++) seed = (Math.imul(seed, 31) + id.charCodeAt(i)) | 0
  const rnd = mulberry(seed)
  return {
    /** Height off the water, in the plant's own units. */
    rise: -0.2 + rnd() * 0.58,
    /** How much further to size it. */
    size: 0.78 + rnd() * 0.44,
    /** How far it's turned, 0..1. */
    turn: rnd(),
    /** How much less open the bloom is, 0 fully open. */
    closed: rnd() * rnd() * 0.5,
    /** A standing lean, as a share of a gust. */
    lean: (rnd() - 0.5) * 0.5,
    /** How much taller or shorter than grown, lawn plants only. */
    tall: 0.8 + rnd() * 0.42
  }
}

/** The water's surface. */
export const WATER_Y = -0.1

/** The pond runs off the left of the frame: flowers stay right of this. */
const IN_VIEW = -5.7
/** The part of the pond the camera can see, across. */
const SHOWN = { x: (IN_VIEW + POND.x + POND.rx) / 2, rx: (POND.x + POND.rx - IN_VIEW) / 2 }

/** Keeps a point in the water, clear of the bank and in view. */
export function inWater(x: number, z: number): [number, number] {
  x = Math.max(x, IN_VIEW)
  const d = pondDist(x, z) + 0.13
  if (d <= 0) return [x, z]
  const k = 1 / (1 + d)
  return [POND.x + (x - POND.x) * k, POND.z + (z - POND.z) * k]
}

/** Somewhere on the lawn in view, kept off the pond and its bank. */
/** The lawn's left edge: in the back (behind the pond) it runs on past the
 * pond's side to the maple, so flowers can grow beside the tree (Simon); in
 * front, the pond runs off the frame. */
const leftOf = (z: number) => (z < 3 ? -10.5 : IN_VIEW + 0.4)
/** The lawn's right edge: nothing grows past here (Simon: the right of the
 * frame stays open), about x 4 in the back to 5.8 in front. */
const rightOf = (z: number) => 4.2 + 0.1 * (z + 4.5)

export function onLand(x: number, z: number): [number, number] {
  x = Math.min(Math.max(x, leftOf(z)), rightOf(z))
  z = Math.min(Math.max(z, -4.5), 11)
  const d = pondDist(x, z)
  if (d >= 0.28) return [x, z]
  const k = 1.28 / (1 + d)
  return [POND.x + (x - POND.x) * k, POND.z + (z - POND.z) * k]
}

/** Clear of the pond and its bank, and on the lawn in view: what onLand keeps. */
const fits = (x: number, z: number) => x >= leftOf(z) && x <= rightOf(z) && z >= -4.5 && z <= 11 && pondDist(x, z) >= 0.28

/** Where a carried flower may stand: in the water for a lotus, on the grass for the rest. */
export const settle = (s: Slot, x: number, z: number) => (s.land ? onLand(x, z) : inWater(x, z))

/** The surface a flower stands on here. */
export const groundOf = (s: Slot) => (s.land ? heightAt(s.x, s.z) : WATER_Y)

/** A group of one kind: its middle, how many it holds before the next group
 * starts, how far it spreads, and how much bigger it grows than the kind's
 * usual size. */
type Drift = { at: [number, number]; n: number; r: number; size?: number }
const drift = (x: number, z: number, n: number, r: number, size?: number): Drift => ({ at: [x, z], n, r, size })

/** The beds, planted like a perennial border round the pond, seen from the
 * home camera. Tall at the back: white shrubs as anchors along the far edge,
 * blue blossom spires in threes and fives between them, a gap at x 3 to 5 so
 * the eye runs on to the far lake. Coral chrysanthemums through the middle
 * distance, the pond's lotus pink carried up the lawn. Iris on the pond's
 * banks, the big group on the far-left bank under the maple's edge, answered across the lawn by blue baby blue eyes; lily of the valley
 * in the maple's shade; white jasmine mounds down the right side. Low daisy
 * and baby blue eyes patches spill along the front edge and the pond's rim,
 * white daisies answering the white shrubs. The lawn in the middle (x 2 to 6,
 * z 2 to 8) is left open, but for a single patch that breaks the rhythm.
 *
 * Each kind fills its groups in order, the first one wholly before the next,
 * and the first group of every kind sits round the pond's right bank (the
 * heart of the picture), so a garden of five flowers is already a planting,
 * not a scatter. Past every group's capacity, each widens in turn. */
// (Simon 2026-11-06: the groups right of x 2 moved 2 to the left, and those
// still past the right edge (rightOf) moved to the back shore under the
// maple, so the planting gathers on the left and the tree frames it.)
const DRIFTS: Record<string, Drift[]> = {
  shrub: [drift(0.2, -3.5, 1, 0), drift(3.9, -3.8, 1, 0), drift(-2.8, -3.9, 1, 0), drift(-7.6, -3.9, 1, 0)],
  blossom: [drift(1.3, -1.7, 3, 0.5), drift(-5.4, -4.1, 5, 0.95), drift(-1.2, -2.7, 3, 0.5), drift(2.6, -3.8, 1, 0), drift(2.9, 2.3, 1, 0)],
  chrysanthemum: [drift(1.9, 1.5, 3, 0.55), drift(2.6, -1.6, 3, 0.6), drift(3.4, 0.2, 1, 0), drift(0.2, 0.2, 3, 0.5), drift(3.6, 1.8, 1, 0)],
  iris: [drift(1.2, 3.6, 3, 0.45), drift(-4.4, 1.3, 5, 0.75), drift(3.6, 6.2, 3, 0.55), drift(-0.3, 9.3, 1, 0)],
  lily: [drift(-2.3, -1.0, 5, 0.7), drift(-5.6, -0.4, 3, 0.5), drift(-3.8, -2.6, 3, 0.45), drift(-6.6, 1.9, 1, 0)],
  jasmine: [drift(4.0, 3.7, 3, 0.75), drift(0.6, 8.5, 1, 0), drift(4.2, 8.6, 1, 0)],
  daisy: [],
  nemophila: []
}
/** The ground patches (daisy, baby blue eyes) spread over the open lawn as a
 * meadow, not heaped in a few beds (Simon): places on a jittered grid over
 * the lawn, clear of the pond and of every other kind's groups, taken in
 * farthest-first order from the pond's right bank, so the first few are
 * already spread across the garden and later ones fill the gaps. The two
 * kinds take alternate places, one patch each. */
const GROUND: [number, number][] = (() => {
  const rnd = mulberry(23)
  const beds = Object.entries(DRIFTS).flatMap(([, ds]) => ds)
  const open: [number, number][] = []
  for (let x = -10; x <= 9; x += 1.0)
    for (let z = -4.2; z <= 10.8; z += 1.0) {
      const px = x + (rnd() - 0.5) * 0.55
      const pz = z + (rnd() - 0.5) * 0.55
      if (!fits(px, pz) || pondDist(px, pz) < 0.4) continue
      if (beds.some((d) => Math.hypot(px - d.at[0], pz - d.at[1]) < 1.2 * Math.max(d.r, 0.55) + 0.6)) continue
      open.push([px, pz])
    }
  const order: [number, number][] = []
  let next = open.reduce((b, p) => (Math.hypot(p[0] - 1, p[1] - 4) < Math.hypot(b[0] - 1, b[1] - 4) ? p : b))
  while (open.length) {
    order.push(next)
    open.splice(open.indexOf(next), 1)
    if (!open.length) break
    next = open.reduce((b, p) => (near(p) > near(b) ? p : b))
  }
  function near(p: [number, number]) {
    return Math.min(...order.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])))
  }
  // Both kinds start by the pond: the second place (baby blue eyes' first) is
  // the next nearest to it, not the farthest.
  let j = 1
  for (let k = 2; k < order.length; k++) if (Math.hypot(order[k][0] - 1, order[k][1] - 4) < Math.hypot(order[j][0] - 1, order[j][1] - 4)) j = k
  ;[order[1], order[j]] = [order[j], order[1]]
  return order
})()
DRIFTS.daisy = GROUND.filter((_, i) => i % 2 === 0).map(([x, z], i) => drift(x, z, 1, 0, 1.35 + (i % 3) * 0.08))
DRIFTS.nemophila = GROUND.filter((_, i) => i % 2 === 1).map(([x, z], i) => drift(x, z, 1, 0, 1.3 + (i % 3) * 0.08))

/** How big each kind stands, against the lotus: its size and how much that varies. */
const SIZE = { shrub: [1.05, 0.16], blossom: [1.02, 0.2], chrysanthemum: [0.74, 0.14], iris: [1.04, 0.16], lily: [0.74, 0.14], jasmine: [0.88, 0.14], daisy: [1.0, 0.14], nemophila: [1.0, 0.14] } as Record<string, [number, number]>

/** How far a group's plants stand apart, against its radius. */
const SPREAD = 1.5

/** How many of a kind the beds hold before they start to widen. */
export const bedRoom = (kind: string) => (DRIFTS[kind] ?? DRIFTS.chrysanthemum).reduce((n, d) => n + d.n, 0)

/** The `k`th plant of a lawn kind: its group's first plant near the middle,
 * the rest round it on a golden-angle spiral, a little taller in the middle. */
export function bedSlot(kind: string, k: number): Slot {
  const drifts = DRIFTS[kind] ?? DRIFTS.chrysanthemum
  const room = bedRoom(kind)
  const round = Math.floor(k / room)
  let left = k % room
  let g = 0
  while (left >= drifts[g].n) left -= drifts[g++].n
  const d = drifts[g]
  // Its place in the group, counting the rounds before: each round widens it.
  const j = left + round * d.n
  const rnd = mulberry(kind.length * 101 + k * 7 + 3)
  // A wider ring each round, so a single still gets company, never a stack.
  // Spread out within a group, so a bed reads as plants side by side, not one
  // heap (Simon): half as wide again as it was.
  const r = d.n === 1 && round === 0 ? 0 : SPREAD * Math.max(d.r, 0.55) * Math.sqrt((j + 0.45) / Math.max(d.n, 1.6))
  const a = j * 2.39996 + d.at[0] * 1.7 + g
  const wild = 0.12 + 0.1 * d.r
  const jx = (rnd() - 0.5) * wild
  const jz = (rnd() - 0.5) * wild
  // A plant that would land in the pond (or off the lawn) goes to the other
  // side of its group instead: pushed out, they'd all stack on the bank.
  const [cx, cz] = onLand(...d.at)
  const at = (side: number): [number, number] => [cx + side * Math.cos(a) * r + jx, cz + side * Math.sin(a) * r * 0.8 + jz]
  const [x, z] = onLand(...(fits(...at(1)) || !fits(...at(-1)) ? at(1) : at(-1)))
  const [base, spread] = SIZE[kind] ?? [0.85, 0.15]
  const middle = 1.06 - 0.12 * Math.min(1, j / Math.max(d.n, 1))
  return { x, z, y: heightAt(x, z), turn: rnd(), scale: (base + (rnd() - 0.5) * spread) * (d.size ?? 1) * middle, land: true, kind }
}

/** Lotuses grow in the pond: the first `n` of a fixed set of places, spread
 * over the water, so earlier flowers stay put as more are added. */
export function slots(n: number): Slot[] {
  const rnd = mulberry(7)
  const all: [number, number][] = []
  for (let i = 0; i < 200; i++) {
    const a = i * 2.39996
    const r = 0.155 * Math.sqrt(i + 0.5)
    const x = SHOWN.x + Math.cos(a) * r * SHOWN.rx
    const z = POND.z + Math.sin(a) * r * POND.rz
    if (pondDist(x, z) < -0.13 && x > IN_VIEW) all.push([x, z])
  }
  // Stepping through the list, so a few flowers are scattered, not bunched.
  const taken: [number, number][] = []
  for (let i = 0; taken.length < n && i < all.length; i++) taken.push(all[(i * 13 + 4) % all.length])
  // Past the pond's capacity, overlap rather than vanish.
  const open = taken.length
  while (taken.length < n) taken.push(taken[taken.length % open])
  return taken.slice(0, n).map(([x, z]) => ({ x, z, y: WATER_Y, turn: rnd(), scale: 0.72 + rnd() * 0.08 }))
}

/** The maple at the back-left: its trunk, and its foliage as flat layered
 * plates, the way a Japanese maple grows, reaching out over the lawn. Centre
 * and radii of each plate. */
/** (Moved 2 to the right of where it first stood, Simon 2026-11-06.) */
export const MAPLE = {
  trunk: [-9.8, -5.3] as [number, number],
  plates: [
    { at: [-7.7, 8.4, -6.0], r: [3.6, 1.0, 2.6] },
    { at: [-10.2, 7.4, -5.0], r: [4.2, 1.2, 3.0] },
    { at: [-7.0, 7.0, -2.6], r: [4.0, 1.1, 2.8] },
    { at: [-3.6, 6.6, -1.6], r: [3.4, 1.0, 2.4] },
    { at: [-1.0, 6.9, -3.8], r: [2.6, 0.8, 2.0] },
    { at: [-12.2, 6.2, -2.0], r: [3.0, 1.0, 2.3] },
    { at: [-9.2, 5.6, -0.4], r: [3.2, 1.0, 2.3] },
    { at: [-5.8, 5.0, 0.8], r: [2.8, 0.85, 2.0] },
    { at: [-2.4, 4.8, 1.0], r: [2.0, 0.65, 1.5] }
  ] as { at: [number, number, number]; r: [number, number, number] }[]
}

/** Clumps of ornamental grass: [x, z, size]. By the pond's banks and at the
 * ends of the beds, the way a gardener softens an edge. */
export const GRASSES: [number, number, number][] = [
  [1.5, 5.6, 1.6],
  [-1.7, 1.0, 1.25],
  [1.9, 10.2, 1.4],
  [-8.4, -1.8, 1.4],
  [1.2, -2.6, 1.2],
  [-5.4, 1.5, 1.2]
]
