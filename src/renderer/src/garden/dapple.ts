import * as THREE from 'three'
import { MAPLE, mulberry, SUN } from './layout'
import { DAPPLE_SIZE, shared } from './paint'

// The sun map: a top-down picture of where sunlight lands, white in sun and
// black in shade, drawn once on a canvas (and again when a flower is planted or
// put down): slow cloud shade over the hills, the maple, and the plants' shade.

const PX = 1024
const K = PX / DAPPLE_SIZE

const toPx = (w: number) => (w / DAPPLE_SIZE + 0.5) * PX
/** Ground point under height `y` along the sun's ray. */
const fall = (x: number, y: number, z: number): [number, number] => [x - (SUN[0] / SUN[1]) * y, z - (SUN[2] / SUN[1]) * y]

/** What casts on the ground: its foot, how wide it is and how tall it stands. */
export type Caster = { x: number; y: number; z: number; r: number; h: number }

const canvas = typeof document === 'undefined' ? null : document.createElement('canvas')
const layer = typeof document === 'undefined' ? null : document.createElement('canvas')

/** Draws the map; `pots` is what stands on the ground. */
export function bakeDapple(pots: Caster[]) {
  if (!canvas || !layer) return
  canvas.width = canvas.height = layer.width = layer.height = PX
  // On the CPU: thousands of shapes, and only one upload at the end.
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  const l = layer.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, PX, PX)
  // Shapes go on a layer and the layer is blurred once, not each shape.
  const paintLayer = (blur: number, shapes: () => void) => {
    l.clearRect(0, 0, PX, PX)
    shapes()
    g.filter = `blur(${blur}px)`
    g.drawImage(layer, 0, 0)
    g.filter = 'none'
  }

  // Cloud shade: soft pools over the lawn, stretched along the sun's direction.
  const rnd = mulberry(23)
  const pools = Array.from({ length: 34 }, () => ({
    x: -18 + rnd() * 36,
    z: -18 + rnd() * 34,
    a: 0.9 + rnd() * 2.1,
    b: 0.5 + rnd() * 1.1,
    turn: 0.55 + rnd() * 0.5
  }))
  paintLayer(34, () => {
    l.fillStyle = 'rgba(0, 0, 0, 0.28)'
    for (const p of pools) {
      l.beginPath()
      l.ellipse(toPx(p.x), toPx(p.z), p.a * K, p.b * K, p.turn, 0, Math.PI * 2)
      l.fill()
    }
  })
  // The maple's shade: each layer's shadow along the sun, pricked all over
  // with small sun flecks where light gets through the leaves.
  const fleck = mulberry(61)
  paintLayer(2.5, () => {
    l.fillStyle = 'rgba(0, 0, 0, 0.62)'
    const falls = MAPLE.plates.map((p) => ({ p, at: fall(p.at[0], p.at[1], p.at[2]) }))
    for (const { p, at } of falls) {
      l.beginPath()
      l.ellipse(toPx(at[0]), toPx(at[1]), p.r[0] * K, p.r[2] * K, 0, 0, Math.PI * 2)
      l.fill()
    }
    l.globalCompositeOperation = 'destination-out'
    l.fillStyle = 'rgba(0, 0, 0, 0.85)'
    for (const { p, at } of falls) {
      for (let i = 0; i < 55; i++) {
        const a = fleck() * Math.PI * 2
        const d = Math.sqrt(fleck())
        // Seen from the low camera the ground is squashed front to back, so
        // flecks are drawn long across and short in depth to read as round.
        const r = (0.12 + fleck() * fleck() * 0.4) * K
        l.beginPath()
        l.ellipse(toPx(at[0] + Math.cos(a) * d * p.r[0]), toPx(at[1] + Math.sin(a) * d * p.r[2]), r * 0.8, r * 1.9, 0.15, 0, Math.PI * 2)
        l.fill()
      }
    }
    l.globalCompositeOperation = 'source-over'
  })
  // The plants' shade, pooled: every shadow drawn solid on one layer, so where
  // a group's shadows overlap they merge rather than stack, then blurred and
  // laid down once, light, the way a watercolour glaze pools under a bed.
  if (pots.length) {
    l.clearRect(0, 0, PX, PX)
    l.fillStyle = '#000'
    for (const p of pots) {
      const [sx, sz] = fall(p.x, p.y + p.h, p.z)
      l.beginPath()
      l.ellipse(toPx((p.x + sx) / 2), toPx((p.z + sz) / 2), (p.r + Math.hypot(sx - p.x, sz - p.z) / 2) * K, p.r * 0.8 * K, Math.atan2(sz - p.z, sx - p.x), 0, Math.PI * 2)
      l.fill()
    }
    g.filter = 'blur(7px)'
    g.globalAlpha = 0.4
    g.drawImage(layer, 0, 0)
    g.globalAlpha = 1
    g.filter = 'none'
  }
  const texture = (shared.uDapple.value as THREE.CanvasTexture | null) ?? new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  shared.uDapple.value = texture
}
