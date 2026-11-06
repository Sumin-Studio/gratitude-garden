import * as THREE from 'three'
import { buildPatch, frame, lin, mix3, mulberry, PART, stalk, type HeadArgs, type PatchKind, type Vert } from './patch'

// The daisy patch (patch.ts builds it): small white daisies, a few washed
// pale blue, with pale gold hearts, over short grass and rosette leaves,
// after an anime meadow.

const COL = {
  white: lin('#fdfdf9'),
  whiteTip: lin('#f3f2ea'),
  blue: lin('#dfe8f8'),
  blueTip: lin('#c3d3f0'),
  gold: lin('#f7df78'),
  goldDeep: lin('#e8c452')
}

/** One daisy: stalk, gold heart, a ring of five to seven kite petals. */
function daisyHead({ sink, bone, xf, seed, height, face, scale, greens }: HeadArgs) {
  const r = mulberry(Math.floor(seed * 1e6))
  const petals = r() < 0.12 ? 5 : r() < 0.85 ? 6 : 7
  const blue = r() < 0.22
  stalk(sink, bone, xf, height, 0.004 * scale, greens.stalk)
  const at = frame(new THREE.Vector3(0, height, 0), face)
  const heartR = 0.017 * scale
  const heart: Vert[] = [{ p: at(0, 0.011 * scale, 0), c: COL.gold, part: PART.heart }]
  const N = 8
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2
    heart.push({ p: at(Math.cos(a) * heartR, 0.004 * scale, Math.sin(a) * heartR), c: COL.goldDeep, part: PART.heart })
  }
  sink.piece(
    bone,
    heart,
    Array.from({ length: N }, (_, k) => [0, 1 + ((k + 1) % N), 1 + k]),
    xf
  )
  const base = blue ? COL.blue : COL.white
  const tip = blue ? COL.blueTip : COL.whiteTip
  const len = (0.052 + r() * 0.012) * scale
  const wide = (0.017 + r() * 0.004) * scale
  const phase = r() * Math.PI * 2
  for (let k = 0; k < petals; k++) {
    const a = phase + (k / petals) * Math.PI * 2 + (r() - 0.5) * 0.25
    const l = len * (0.9 + r() * 0.2)
    const ox = Math.cos(a)
    const oz = Math.sin(a)
    // Dished: the tip lifts a touch, so the ring catches the light.
    const pt = (u: number, w: number) => at(ox * (heartR * 0.75 + u * l) - oz * w, (0.002 + 0.09 * u * u * l) * scale, oz * (heartR * 0.75 + u * l) + ox * w)
    sink.piece(
      bone,
      [
        { p: pt(0, 0), c: mix3(base, COL.gold, 0.12), part: PART.petal },
        { p: pt(0.4, wide * 0.5), c: base, part: PART.petal },
        { p: pt(0.4, -wide * 0.5), c: base, part: PART.petal },
        { p: pt(0.82, wide * 0.36), c: mix3(base, tip, 0.6), part: PART.petal },
        { p: pt(0.82, -wide * 0.36), c: mix3(base, tip, 0.6), part: PART.petal },
        { p: pt(1, 0), c: tip, part: PART.petal }
      ],
      [
        [0, 1, 2],
        [1, 3, 2],
        [2, 3, 4],
        [3, 5, 4]
      ],
      xf
    )
  }
}

export const DAISY: PatchKind = {
  name: 'daisy',
  seed: 20261105,
  radius: 1.5,
  heads: 46,
  sectors: 10,
  blades: 400,
  leaves: 60,
  greens: {
    deep: lin('#4b8a55'),
    mid: lin('#6aa25e'),
    light: lin('#8fbd6f'),
    leaf: lin('#4f9160'),
    leafTip: lin('#7fb673'),
    stalk: lin('#5a9560')
  },
  stalkMid: 0.21,
  stalkRim: 0.1,
  scale: [1.3, 1.65],
  head: daisyHead,
  leaf: 'spoon'
}

export const buildDaisy = () => buildPatch(DAISY)
