import * as THREE from 'three'
import { buildPatch, frame, lin, mix3, mulberry, PART, stalk, type HeadArgs, type PatchKind, type Vert } from './patch'

// Baby blue eyes (nemophila), on the same patch builder as the daisies
// (patch.ts): small five-petal cups, sky blue fading to a white throat with
// a ring of fine blue dots and a pale yellow-green middle, on short soft
// stems over feathery lobed leaves. Dense and low, it should read as a cool
// blue wash with white eyes, against the daisies' warm white and gold.

const COL = {
  sky: lin('#7fb3ff'),
  deep: lin('#4d8ef0'),
  white: lin('#fbfdff'),
  dot: lin('#3f6fc8'),
  centre: lin('#e6eda6'),
  centreDeep: lin('#c9d77e')
}

/** One cup: stalk, a pale yellow-green middle, five rounded petals rising
 * into a shallow bowl, white at the throat, blue towards the rim, a dot on
 * each petal near the throat. */
function nemophilaHead({ sink, bone, xf, seed, height, face, scale, greens }: HeadArgs) {
  const r = mulberry(Math.floor(seed * 1e6))
  stalk(sink, bone, xf, height, 0.0045 * scale, greens.stalk)
  const at = frame(new THREE.Vector3(0, height, 0), face)
  // The middle: a little raised boss.
  const mid = 0.007 * scale
  const centre: Vert[] = [{ p: at(0, 0.006 * scale, 0), c: COL.centre, part: PART.heart }]
  const N = 6
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2
    centre.push({ p: at(Math.cos(a) * mid, 0.002 * scale, Math.sin(a) * mid), c: COL.centreDeep, part: PART.heart })
  }
  sink.piece(
    bone,
    centre,
    Array.from({ length: N }, (_, k) => [0, 1 + ((k + 1) % N), 1 + k]),
    xf
  )
  const len = (0.04 + r() * 0.008) * scale
  const wide = (0.03 + r() * 0.005) * scale
  // Some cups a deeper blue, some paler: a haze, not a flat fill.
  const rim = mix3(COL.sky, COL.deep, r() * 0.8)
  const phase = r() * Math.PI * 2
  // How far the cup's sides rise (radians from flat).
  const cup = 0.5 + r() * 0.2
  for (let k = 0; k < 5; k++) {
    const a = phase + (k / 5) * Math.PI * 2 + (r() - 0.5) * 0.15
    const ox = Math.cos(a)
    const oz = Math.sin(a)
    // Out along the petal (u) and across it (w), rising into the bowl.
    const pt = (u: number, w: number) => {
      const d = mid * 0.6 + u * len * Math.cos(cup * u)
      const y = 0.001 + u * len * Math.sin(cup * u)
      return at(ox * d - oz * w, y, oz * d + ox * w)
    }
    const throat = mix3(COL.white, rim, 0.1)
    const half = mix3(COL.white, rim, 0.55)
    sink.piece(
      bone,
      [
        { p: pt(0, 0), c: COL.white, part: PART.petal },
        { p: pt(0.35, wide * 0.32), c: throat, part: PART.petal },
        { p: pt(0.35, -wide * 0.32), c: throat, part: PART.petal },
        { p: pt(0.7, wide * 0.5), c: half, part: PART.petal },
        { p: pt(0.7, -wide * 0.5), c: half, part: PART.petal },
        { p: pt(0.95, wide * 0.3), c: rim, part: PART.petal },
        { p: pt(0.95, -wide * 0.3), c: rim, part: PART.petal },
        { p: pt(1.04, 0), c: rim, part: PART.petal }
      ],
      [
        [0, 1, 2],
        [1, 3, 2],
        [2, 3, 4],
        [3, 5, 4],
        [4, 5, 6],
        [5, 7, 6]
      ],
      xf
    )
    // The dot: a speck sitting just proud of the petal, near the throat.
    const ds = 0.0035 * scale
    const dc = pt(0.3, 0)
    const lift = at(0, 0.0008, 0).sub(at(0, 0, 0))
    sink.piece(
      bone,
      [
        { p: dc.clone().add(lift).add(at(ox * ds, 0, oz * ds).sub(at(0, 0, 0))), c: COL.dot, part: PART.petal },
        { p: dc.clone().add(lift).add(at(-oz * ds, 0, ox * ds).sub(at(0, 0, 0))), c: COL.dot, part: PART.petal },
        { p: dc.clone().add(lift).add(at(oz * ds, 0, -ox * ds).sub(at(0, 0, 0))), c: COL.dot, part: PART.petal }
      ],
      [[0, 1, 2]],
      xf
    )
  }
}

export const NEMOPHILA: PatchKind = {
  name: 'nemophila',
  seed: 20261106,
  radius: 1.5,
  heads: 52,
  sectors: 10,
  blades: 340,
  leaves: 72,
  // Soft mid greens, a touch cooler than the daisies' meadow.
  greens: {
    deep: lin('#4f8a5c'),
    mid: lin('#6aa36a'),
    light: lin('#94c286'),
    leaf: lin('#5c9a66'),
    leafTip: lin('#8cbf80'),
    stalk: lin('#6a9f68')
  },
  stalkMid: 0.17,
  stalkRim: 0.08,
  scale: [1.25, 1.6],
  head: nemophilaHead,
  leaf: 'lobed'
}

export const buildNemophila = () => buildPatch(NEMOPHILA)
