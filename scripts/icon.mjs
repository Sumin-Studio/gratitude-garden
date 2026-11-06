// The app icon and the menu-bar icons: the lotus at full bloom, dithered.
//   node scripts/icon.mjs            from build/icon-source.png (committed)
//   node scripts/icon.mjs --render   re-render the lotus first (capture studio, needs `pnpm build`)
// Writes build/icon.png (1024), build/icon.icns (every size, via iconutil),
// resources/trayTemplate.png + @2x, and docs/app/icon-sizes-{light,dark}.png.
//
// Each size is drawn on its own pixel grid, not scaled down from the master:
// the flower is averaged into cells (4 px at 1024, 1 px at 256 and under),
// each cell stepped to a few watercolour tones with an 8×8 ordered dither
// (none at 32 and under, where dots would be noise), and ringed with a
// one-cell ink line. The tile follows Apple's grid: 824 of 1024 with a
// continuous corner, a soft shadow under it.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { resolve } from 'node:path'
import { readPng, writePng } from './lib/png.mjs'

const root = resolve(import.meta.dirname, '..')
const at = (p) => resolve(root, p)
const SOURCE = at('build/icon-source.png')

// ---- the source: the lotus bloom, alone, on transparent -----------------

if (process.argv.includes('--render')) {
  const dir = at('.claude/screens/icon')
  const env = { ...process.env, SIP_CAPTURE: dir, SIP_CAPTURE_GROWTH_STOPS: '1', SIP_CAPTURE_RAIN: '0', SIP_CAPTURE_SCALE: '3' }
  spawnSync('node', [at('scripts/run-mode.mjs'), 'capture', 'lotus'], { env, stdio: 'inherit' })
  const shot = readPng(fs.readFileSync(`${dir}/lotus-grow-100.png`))
  // The studio frames the whole pot: keep the main bloom, everything opaque
  // and not green that joins its heart (the stem and leaves are green). The
  // small bloom sits behind the main one's lower-left petal, so a fence runs
  // down that petal's left edge. Points are in the 1053 × 974 frame (scale 3).
  const { width: w, height: h, data } = shot
  const f = w / 1053
  const fenced = (x, y) => {
    const [u, v] = [x / f, y / f]
    // Under the petal's tip, the small bloom shows again.
    if (u < 480 && v > 440 + ((u - 437) * 28) / 38) return true
    if (v > 370) return u < 437
    return v > 322 && u < 437 + ((370 - v) / 48) * 63
  }
  const solid = (k) => data[k * 4 + 3] >= 128 && data[k * 4] >= data[k * 4 + 1] && !fenced(k % w, Math.floor(k / w))
  const keep = new Uint8Array(w * h)
  const todo = [Math.round(h * 0.26) * w + Math.round(w * 0.52)]
  while (todo.length) {
    const k = todo.pop()
    if (keep[k] || !solid(k)) continue
    keep[k] = 1
    const x = k % w
    if (x > 0) todo.push(k - 1)
    if (x < w - 1) todo.push(k + 1)
    if (k >= w) todo.push(k - w)
    if (k < w * (h - 1)) todo.push(k + w)
  }
  const out = { width: w, height: h, data: new Uint8Array(w * h * 4) }
  for (let k = 0; k < w * h; k++) if (keep[k]) out.data.set([data[k * 4], data[k * 4 + 1], data[k * 4 + 2], 255], k * 4)
  fs.mkdirSync(at('build'), { recursive: true })
  fs.writeFileSync(SOURCE, writePng(trim(out)))
  console.log('rendered build/icon-source.png')
}

/** The image cropped to its opaque pixels. */
function trim(im) {
  let [x0, y0, x1, y1] = [im.width, im.height, 0, 0]
  for (let y = 0; y < im.height; y++)
    for (let x = 0; x < im.width; x++)
      if (im.data[(y * im.width + x) * 4 + 3]) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) data.set(im.data.subarray(((y + y0) * im.width + x0) * 4, ((y + y0) * im.width + x1 + 1) * 4), y * w * 4)
  return { width: w, height: h, data }
}

const src = readPng(fs.readFileSync(SOURCE))

// ---- palette ---------------------------------------------------------------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
// Light to dark. The petals are the render's own pinks, stepped.
const PETAL = ['#fff6f4', '#fbd3d6', '#f29bab', '#d9607e'].map(hex)
const HEART = ['#fbe7a0', '#f2c14e', '#d99a2b'].map(hex)
const INK = hex('#4a2433')
// The tile: pale sage into mist, the lotus leaf's green washed out.
const TILE_TOP = hex('#e4ece1')
const TILE_BOTTOM = hex('#bccfb8')

const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
].map((row) => row.map((v) => (v + 0.5) / 64))

/** A tone along a ramp (0 = lightest): one of two neighbours, dithered or nearest. */
function step(ramp, t, cx, cy, dither) {
  const p = Math.min(Math.max(t, 0), 1) * (ramp.length - 1)
  const i = Math.floor(p)
  const f = p - i
  if (i >= ramp.length - 1) return ramp[ramp.length - 1]
  if (!dither) return ramp[f < 0.5 ? i : i + 1]
  return ramp[f > BAYER[cy & 7][cx & 7] ? i + 1 : i]
}

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/** The source averaged over a rect: [r, g, b, coverage]. */
function sample(x0, y0, x1, y1) {
  const n = 4
  let [r, g, b, a] = [0, 0, 0, 0]
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const sx = Math.floor(x0 + ((i + 0.5) / n) * (x1 - x0))
      const sy = Math.floor(y0 + ((j + 0.5) / n) * (y1 - y0))
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue
      const k = (sy * src.width + sx) * 4
      if (!src.data[k + 3]) continue
      r += src.data[k]
      g += src.data[k + 1]
      b += src.data[k + 2]
      a++
    }
  return a ? [r / a, g / a, b / a, a / (n * n)] : [0, 0, 0, 0]
}

/** The flower on a grid `cols` cells across, plus a spare cell all round for
 * the ink line: per cell null (empty), 'ink', or a colour. */
function flowerGrid(cols, dither) {
  const rows = Math.round((cols * src.height) / src.width)
  const cw = src.width / cols
  const ch = src.height / rows
  const W = cols + 2
  const H = rows + 2
  const col = new Array(W * H).fill(null)
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const [r, g, b, c] = sample(x * cw, y * ch, (x + 1) * cw, (y + 1) * ch)
      if (c < 0.5) continue
      const heart = r > 200 && g > 160 && b < 150
      // Petals by their lightness, stretched over the ramp (the render runs
      // from ~0.95 at the bases to ~0.6 at the tips).
      const L = lum(r, g, b)
      col[(y + 1) * W + x + 1] = heart ? step(HEART, (0.92 - L) / 0.3, x, y, dither) : step(PETAL, (0.97 - L) / 0.36, x, y, dither)
    }
  for (let k = 0; k < W * H; k++) {
    if (col[k]) continue
    const x = k % W
    const near = [x > 0 && k - 1, x < W - 1 && k + 1, k - W, k + W].some((n) => n !== false && n >= 0 && n < W * H && col[n] && col[n] !== 'ink')
    if (near) col[k] = 'ink'
  }
  return { W, H, col }
}

// ---- the icon at one size --------------------------------------------------

/** Apple's continuous corner, near enough: a superellipse (n = 5) 824 of 1024 across. */
function inTile(x, y, s) {
  const half = (824 / 1024) * s * 0.5
  const u = Math.abs(x - s / 2) / half
  const v = Math.abs(y - s / 2) / half
  return u ** 5 + v ** 5 <= 1
}

function icon(size) {
  const out = new Uint8Array(size * size * 4)
  const ss = size <= 64 ? 4 : 2
  const tile = new Float32Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let hit = 0
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) if (inTile(x + (i + 0.5) / ss, y + (j + 0.5) / ss, size)) hit++
      tile[y * size + x] = hit / (ss * ss)
    }
  // The shadow: the tile blurred and dropped, as in Apple's template.
  const shadow = blur(tile, size, Math.max(1, Math.round(size * 0.01)))
  const drop = Math.round(size * 0.018)
  const cell = Math.max(1, Math.round(size / 256))
  const dither = size >= 64
  // The flower: 70 % of the tile wide, more at the smallest sizes where it
  // has to read on its own, centred a touch high.
  const fill = size <= 16 ? 0.78 : size <= 32 ? 0.75 : 0.7
  const g = flowerGrid(Math.round(((824 / 1024) * size * fill) / cell), dither)
  const ox = Math.round((size - g.W * cell) / 2)
  const oy = Math.round((size - g.H * cell) / 2 - size * 0.015)
  const t0 = size * (100 / 1024)
  const t1 = size * (924 / 1024)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const k = y * size + x
      const a = tile[k]
      // The tile's wash: two tones dithered at large sizes, a plain blend at small.
      const t = Math.min(Math.max((y - t0) / (t1 - t0), 0), 1)
      const cx = Math.floor(x / cell)
      const cy = Math.floor(y / cell)
      let c = dither ? (t > BAYER[cy & 7][cx & 7] ? TILE_BOTTOM : TILE_TOP) : TILE_TOP.map((v, i) => v + (TILE_BOTTOM[i] - v) * t)
      const gx = Math.floor((x - ox) / cell)
      const gy = Math.floor((y - oy) / cell)
      const f = gx >= 0 && gy >= 0 && gx < g.W && gy < g.H ? g.col[gy * g.W + gx] : null
      if (f) c = f === 'ink' ? INK : f
      // The tile over its shadow (the shadow is black, so it only adds alpha).
      const sh = y - drop >= 0 ? shadow[(y - drop) * size + x] * 0.3 : 0
      const alpha = a + sh * (1 - a)
      for (let i = 0; i < 3; i++) out[k * 4 + i] = alpha > 0 ? Math.round((c[i] * a) / alpha) : 0
      out[k * 4 + 3] = Math.round(alpha * 255)
    }
  return { width: size, height: size, data: out }
}

/** Three box blurs, near enough a gaussian. */
function blur(a, size, r) {
  let cur = a
  for (let pass = 0; pass < 3; pass++)
    for (const horiz of [true, false]) {
      const next = new Float32Array(size * size)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          let s = 0
          for (let d = -r; d <= r; d++) {
            const xx = horiz ? x + d : x
            const yy = horiz ? y : y + d
            if (xx >= 0 && yy >= 0 && xx < size && yy < size) s += cur[yy * size + xx]
          }
          next[y * size + x] = s / (2 * r + 1)
        }
      cur = next
    }
  return cur
}

// ---- the menu-bar icon: the lotus face-on, black + alpha ------------------

// The 3/4 bloom is a blob at 18 px, so the menu bar gets the lotus as a
// glyph: five petals fanning up from one point, the outer pair behind. Each
// petal is outlined (1 pt) and, at 2x, filled with an ordered dither that
// is densest at the tip, the way the icon's petals darken outward. Units are
// an 18-pt grid, y down.
const PETALS = [
  // angle (deg from up), length, half-width
  [-72, 8.4, 2.3],
  [72, 8.4, 2.3],
  [-36, 10.6, 2.7],
  [36, 10.6, 2.7],
  [0, 12.6, 2.9]
]
const BASE = [9, 15.6]

/** Where (x, y) falls along a petal: its t from base to tip, or -1 outside. */
function petalAt([deg, len, hw], x, y) {
  const r = (deg * Math.PI) / 180
  const dx = x - BASE[0]
  const dy = y - BASE[1]
  const v = dx * Math.sin(r) - dy * Math.cos(r)
  const u = dx * Math.cos(r) + dy * Math.sin(r)
  const t = v / len
  if (t <= 0 || t >= 1) return -1
  // Round at the base, pointed at the tip.
  const w = hw * Math.sin(Math.PI * t ** 0.75) ** 0.8
  return Math.abs(u) <= w ? t : -1
}

function tray(size) {
  const k = size / 18
  const out = new Uint8Array(size * size * 4)
  // Paint back to front: each petal covers what's behind it.
  for (const p of PETALS) {
    const inside = (x, y) => x >= 0 && y >= 0 && x < size && y < size && petalAt(p, (x + 0.5) / k, (y + 0.5) / k) >= 0
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (!inside(x, y)) continue
        let edge = false
        for (let dy = -k; dy <= k && !edge; dy++) for (let dx = -k; dx <= k && !edge; dx++) if (Math.abs(dx) + Math.abs(dy) <= k && !inside(x + dx, y + dy)) edge = true
        const t = petalAt(p, (x + 0.5) / k, (y + 0.5) / k)
        const dot = k > 1 && t ** 1.6 * 0.6 > BAYER[y & 7][x & 7]
        out[(y * size + x) * 4 + 3] = edge || dot ? 255 : 0
      }
  }
  // The water line under it.
  for (let y = Math.round(16.6 * k); y < Math.round(16.6 * k) + k; y++) for (let x = Math.round(3.5 * k); x < Math.round(14.5 * k); x++) out[(y * size + x) * 4 + 3] = 255
  return { width: size, height: size, data: out }
}

// ---- write -----------------------------------------------------------------

const save = (p, im) => {
  fs.mkdirSync(resolve(at(p), '..'), { recursive: true })
  fs.writeFileSync(at(p), writePng(im))
}

const cache = new Map()
const iconAt = (s) => cache.get(s) ?? cache.set(s, icon(s)).get(s)

save('build/icon.png', iconAt(1024))
const set = at('build/icon.iconset')
fs.rmSync(set, { recursive: true, force: true })
fs.mkdirSync(set)
for (const s of [16, 32, 128, 256, 512]) {
  fs.writeFileSync(`${set}/icon_${s}x${s}.png`, writePng(iconAt(s)))
  fs.writeFileSync(`${set}/icon_${s}x${s}@2x.png`, writePng(iconAt(s * 2)))
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', at('build/icon.icns')])
fs.rmSync(set, { recursive: true })

save('resources/trayTemplate.png', tray(18))
save('resources/trayTemplate@2x.png', tray(36))

// Review sheets: 16, 32, 128 and 512 at 1:1 on a light and a dark ground,
// then the menu-bar icon at 2x as the menu bar tints it.
for (const [name, ground, mark] of [
  ['light', [236, 236, 238], [0, 0, 0]],
  ['dark', [30, 30, 32], [255, 255, 255]]
]) {
  const sizes = [16, 32, 128, 512]
  const gap = 48
  const W = sizes.reduce((a, s) => a + s + gap, gap) + 36 + gap
  const H = 512 + 2 * gap
  const sheet = { width: W, height: H, data: new Uint8Array(W * H * 4) }
  for (let i = 0; i < W * H; i++) sheet.data.set([...ground, 255], i * 4)
  const put = (im, x0, y0, tint) => {
    for (let y = 0; y < im.height; y++)
      for (let x = 0; x < im.width; x++) {
        const k = (y * im.width + x) * 4
        const a = im.data[k + 3] / 255
        const o = ((y + y0) * W + x + x0) * 4
        for (let c = 0; c < 3; c++) sheet.data[o + c] = Math.round((tint ? tint[c] : im.data[k + c]) * a + sheet.data[o + c] * (1 - a))
      }
  }
  let x = gap
  for (const s of sizes) {
    put(iconAt(s), x, Math.round(H / 2 - s / 2))
    x += s + gap
  }
  put(tray(36), x, Math.round(H / 2 - 18), mark)
  save(`docs/app/icon-sizes-${name}.png`, sheet)
}
console.log('wrote build/icon.png, build/icon.icns, resources/trayTemplate*.png, docs/app/icon-sizes-*.png')
