import type { Item } from '../../../shared/diary'

// Board maths shared by the live board (Board.tsx) and the still ones
// (still.ts): ink as smooth paths, each item's box, and fitting a board to
// its frame.

/** Between two strokes in one ink item's `points`: a pen-up pair. */
export const PEN_UP = -99999

/** An ink item's strokes, as lists of [x, y]. */
export function strokes(points: number[]): [number, number][][] {
  const out: [number, number][][] = []
  let cur: [number, number][] = []
  for (let i = 0; i + 1 < points.length; i += 2) {
    if (points[i] === PEN_UP) {
      if (cur.length) out.push(cur)
      cur = []
    } else cur.push([points[i], points[i + 1]])
  }
  if (cur.length) out.push(cur)
  return out
}

/** A stroke as a smooth SVG path: quadratic curves through the midpoints. */
export function strokePath(s: [number, number][]): string {
  if (s.length === 1) return `M${s[0][0]} ${s[0][1]}l0.01 0`
  let d = `M${s[0][0]} ${s[0][1]}`
  for (let i = 1; i < s.length - 1; i++) {
    const [x, y] = s[i]
    const [nx, ny] = s[i + 1]
    d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`
  }
  const [lx, ly] = s[s.length - 1]
  return d + `L${lx} ${ly}`
}

/** Drop points closer than `min` px to the last kept one, so a slow hand
 * doesn't leave a jagged trail (and a stroke stays small on disk). */
export function thin(s: [number, number][], min = 1.5): [number, number][] {
  const out: [number, number][] = []
  for (const p of s) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= min) out.push(p)
  }
  const end = s[s.length - 1]
  if (end && out[out.length - 1] !== end && out.length > 1) out[out.length - 1] = end
  return out
}

/** How wide a text block wraps, and its type. */
export const TEXT_W = 300
export const TEXT_FONT = 15
export const TEXT_LINE = 21
export const VOICE_W = 232
export const VOICE_H = 44

type Box = { x: number; y: number; w: number; h: number }

/** An item's box on the board. Text is estimated (≈7.4 px a character). */
export function boxOf(it: Item): Box {
  if (it.kind === 'ink' && it.points) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    for (const s of strokes(it.points))
      for (const [x, y] of s) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    if (!Number.isFinite(x0)) return { x: it.x, y: it.y, w: 1, h: 1 }
    return { x: it.x + x0 - 2, y: it.y + y0 - 2, w: x1 - x0 + 4, h: y1 - y0 + 4 }
  }
  if (it.kind === 'voice') return { x: it.x, y: it.y, w: it.w ?? VOICE_W, h: VOICE_H }
  if (it.kind === 'text') {
    const lines = (it.text ?? '').split('\n')
    const per = Math.floor(TEXT_W / 7.4)
    const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / per)), 0)
    const longest = Math.max(...lines.map((l) => l.length))
    return { x: it.x, y: it.y, w: it.w ?? Math.min(TEXT_W, Math.max(40, longest * 7.4 + 8)), h: rows * TEXT_LINE + 8 }
  }
  return { x: it.x, y: it.y, w: it.w ?? 200, h: it.h ?? 150 }
}

export function boundsOf(items: Item[]): Box | null {
  if (!items.length) return null
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const it of items) {
    const b = boxOf(it)
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Where the board's origin sits in its frame, and its zoom. */
export type View = { x: number; y: number; k: number }

/** The view that shows every item in a `w` × `h` frame with `pad` round it:
 * never zoomed in past 1, centred. An empty board starts at the top left. */
export function fit(items: Item[], w: number, h: number, pad = 28, maxK = 1): View {
  const b = boundsOf(items)
  if (!b) return { x: pad, y: pad, k: 1 }
  const k = Math.max(0.2, Math.min(maxK, (w - pad * 2) / b.w, (h - pad * 2) / b.h))
  return { x: (w - b.w * k) / 2 - b.x * k, y: (h - b.h * k) / 2 - b.y * k, k }
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
