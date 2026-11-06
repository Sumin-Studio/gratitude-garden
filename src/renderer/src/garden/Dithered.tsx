import { useEffect, useRef } from 'react'

// The little skies on the controls, after the pixel-art farm's panel: glows and
// horizons drawn in halftone (a grid of white dots, each as big as the light is
// bright), bodies (sun, moon, cloud) solid white with a fine dither and soft
// shade. They move: the sun and moon travel their arc when the hour changes,
// clouds drift in, rain keeps falling.

const W = 150
const H = 96
/** The halftone grid, in CSS px. */
const GRID = 3.4
/** Where the land meets the sky, as a share of the height. */
const HORIZON = 0.74
const EASE = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Brightness 0..1 at (x, y) in CSS px, at time t seconds. */
export type Field = (x: number, y: number, t: number) => number

function halftone(g: CanvasRenderingContext2D, f: Field, t: number, grid = GRID, square = false) {
  g.beginPath()
  for (let y = grid / 2; y < H; y += grid) {
    for (let x = grid / 2; x < W; x += grid) {
      const v = f(x, y, t)
      if (v < 0.04) continue
      const r = Math.sqrt(Math.min(1, v)) * grid * 0.5
      if (square) {
        // Pixel art: whole cells, on or off, rounded by brightness.
        if (v > 0.35) g.rect(x - grid / 2, y - grid / 2, grid - 0.6, grid - 0.6)
        continue
      }
      g.moveTo(x + r, y)
      g.arc(x, y, r, 0, Math.PI * 2)
    }
  }
  g.fill()
}

/** A dotted horizon: one row of dots fading out to the sides, a sparser row under it. */
const horizon: Field = (x, y) => {
  const row = Math.round((y - GRID / 2) / GRID)
  const at = Math.round((H * HORIZON - GRID / 2) / GRID)
  const fade = 1 - smooth(0.18, 0.47, Math.abs(x / W - 0.5))
  if (row === at) return 0.42 * fade
  if (row === at + 1) return (Math.round(x / GRID) % 2 === 0 ? 0.22 : 0) * fade
  return 0
}

let texture: CanvasPattern | null = null
/** White with a fine dither: one grey pixel in four. */
function grain(g: CanvasRenderingContext2D) {
  if (texture) return texture
  const c = document.createElement('canvas')
  c.width = c.height = 2
  const p = c.getContext('2d')!
  p.fillStyle = '#ffffff'
  p.fillRect(0, 0, 2, 2)
  p.fillStyle = '#d4d8d4'
  p.fillRect(1, 1, 1, 1)
  texture = g.createPattern(c, 'repeat')
  return texture
}

/** Solid body: textured white, shaded away from the top left. */
function body(g: CanvasRenderingContext2D, shape: (g: CanvasRenderingContext2D) => void, cx: number, cy: number, r: number, alpha = 1) {
  g.save()
  g.globalAlpha = alpha
  g.beginPath()
  shape(g)
  g.fillStyle = grain(g)!
  g.fill()
  const shade = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  shade.addColorStop(0.45, 'rgba(30, 50, 40, 0)')
  shade.addColorStop(1, 'rgba(30, 50, 40, 0.22)')
  g.fillStyle = shade
  g.fill()
  g.restore()
}

/** A canvas that redraws `draw` every frame while it's on screen. */
function useCanvas(draw: (g: CanvasRenderingContext2D, t: number, dt: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(() => {
    const canvas = ref.current!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = W * dpr
    canvas.height = H * dpr
    const g = canvas.getContext('2d')!
    g.scale(dpr, dpr)
    let raf = 0
    let last = -Infinity
    const t0 = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      // 60 fps is plenty for these, and leaves the frame to the garden on
      // faster screens.
      if (now - last < 1000 / 60 - 2) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      g.clearRect(0, 0, W, H)
      g.fillStyle = '#fff'
      drawRef.current(g, still() ? 0 : (now - t0) / 1000, dt)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="dithered" style={{ width: W, height: H }} aria-hidden />
}

/** Eases a value towards its target over `ms`, on a strong ease-in-out: the
 * thing is moving across the picture, so it speeds up and settles. */
function useTween(target: number, ms: number, wrap?: number) {
  const s = useRef({ from: target, to: target, start: 0, now: target })
  if (s.current.to !== target) {
    let from = s.current.now
    // On a clock, go the short way round.
    if (wrap) {
      const d = ((((target - from) % wrap) + wrap * 1.5) % wrap) - wrap / 2
      from = target - d
    }
    s.current = { from, to: target, start: performance.now(), now: from }
  }
  return () => {
    const k = still() ? 1 : Math.min(1, (performance.now() - s.current.start) / ms)
    s.current.now = s.current.from + (s.current.to - s.current.from) * EASE(k)
    return wrap ? ((s.current.now % wrap) + wrap) % wrap : s.current.now
  }
}

export function WindArt({ wind }: { wind: number }) {
  const now = useTween(wind, 600)
  return useCanvas((g, t) => {
    const w = now()
    halftone(
      g,
      (x, y) => {
        const u = x / W
        let v = 0
        for (let k = 0; k < 3; k++) {
          const y0 = H * (0.3 + k * 0.17)
          const wave = Math.sin(u * 8 - t * (0.6 + w * 2) + k * 1.9) * (3 + w * 4)
          const d = Math.abs(y - y0 - wave)
          // Each line is a dash drifting along, so the air reads as moving.
          const dash = smooth(0.2, 0.6, Math.sin(u * 5.5 - t * (0.8 + w * 2.4) + k * 2.3) * 0.5 + 0.5)
          v = Math.max(v, (1 - smooth(0.2, 1.5, d)) * dash * Math.min(0.75, 0.25 + w * 0.35))
        }
        return v
      },
      t
    )
    halftone(g, horizon, t)
  })
}

export function TimeArt({ hour }: { hour: number }) {
  const now = useTween(hour, 900, 24)
  return useCanvas((g, t) => {
    const h = now()
    // The sun is up 5:30 to 19:30 (so evening is a low sun, not a moon); the
    // moon has the rest of the night.
    const night = h < 5.5 || h >= 19.5
    // Along its arc: 0 rising at the horizon, 1 setting.
    const along = night ? ((h - 19.5 + 24) % 24) / 10 : (h - 5.5) / 14
    const a = Math.PI * along
    const cx = W * (0.5 - 0.36 * Math.cos(a))
    const cy = H * HORIZON - H * 0.5 * Math.sin(a)
    const r = night ? 10.5 : 11.5
    // Brighter the higher it climbs.
    const up = smooth(0, 0.35, Math.sin(a))
    // The glow, in halftone, gently breathing.
    const glow = (night ? 0.42 : 0.55) * (0.94 + 0.06 * Math.sin(t * 1.4)) * up
    halftone(
      g,
      (x, y) => {
        if (y > H * HORIZON - GRID) return 0
        const d = Math.hypot(x - cx, y - cy)
        return d < r + 1 ? 0 : glow * Math.exp(-(d - r) / (night ? 9 : 12)) * (1 - smooth(r * 2.1, r * 3, d))
      },
      t
    )
    halftone(g, horizon, t)
    // The body, cut off at the horizon as it rises and sets.
    g.save()
    g.beginPath()
    g.rect(0, 0, W, H * HORIZON - 1.5)
    g.clip()
    if (night) {
      // A crescent: the moon with a bite taken out, drawn on its own layer.
      g.save()
      g.globalCompositeOperation = 'source-over'
      body(g, (p) => p.arc(cx, cy, r, 0, Math.PI * 2), cx, cy, r, 0.35 + 0.65 * up)
      g.globalCompositeOperation = 'destination-out'
      g.beginPath()
      g.arc(cx + r * 0.55, cy - r * 0.3, r * 0.9, 0, Math.PI * 2)
      g.fill()
      g.restore()
    } else body(g, (p) => p.arc(cx, cy, r, 0, Math.PI * 2), cx, cy, r, 0.35 + 0.65 * up)
    g.restore()
  })
}

const puffs = (p: CanvasRenderingContext2D, cx: number, cy: number, s: number) => {
  for (const [dx, dy, r] of [
    [-12, 2, 9],
    [-2, -5, 12],
    [11, 0, 9.5]
  ])
    p.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2)
  p.roundRect(cx - 21 * s, cy + 1 * s, 42 * s, 10 * s, 5 * s)
}

export function WeatherArt({ cloud, rain }: { cloud: number; rain: number }) {
  const c = useTween(cloud, 650)
  const rn = useTween(rain, 650)
  return useCanvas((g, t) => {
    const cl = c()
    const rr = rn()
    const cx = W * 0.5
    const cy = H * 0.4
    // The sun sits up and to the left, and clouds over.
    const sx = cx - 12
    const sy = cy - 6
    const sun = 1 - smooth(0.1, 0.7, cl)
    halftone(
      g,
      (x, y) => {
        if (y > H * HORIZON - GRID) return 0
        const ds = Math.hypot(x - sx, y - sy)
        const dc = Math.hypot((x - cx) * 0.7, y - cy - 2)
        const sunGlow = ds < 12 && sun > 0.5 ? 0 : sun * 0.55 * Math.exp(-(ds - 11) / 12) * (1 - smooth(24, 34, ds))
        const cloudGlow = cl * 0.32 * Math.exp(-(dc - 14) / 8) * (1 - smooth(22, 30, dc))
        return Math.max(sunGlow, dc < 15 && cl > 0.3 ? 0 : cloudGlow) * (0.94 + 0.06 * Math.sin(t * 1.2))
      },
      t
    )
    halftone(g, horizon, t)
    if (sun > 0.01) body(g, (p) => p.arc(sx, sy, 11.5, 0, Math.PI * 2), sx, sy, 11.5, sun)
    if (cl > 0.01) {
      // Clouds drift in from the right as it clouds over, and bob a little.
      const drift = (1 - cl) * 18 + Math.sin(t * 0.5) * 1.5
      // A grey one behind, for depth.
      g.save()
      g.globalAlpha = Math.min(1, cl * 1.4) * 0.55
      g.fillStyle = '#c9d0cb'
      g.beginPath()
      puffs(g, cx + 14 + drift * 1.3, cy - 7, 0.62)
      g.fill()
      g.restore()
      body(g, (p) => puffs(p, cx + drift, cy, 1), cx, cy, 22, Math.min(1, cl * 1.4))
    }
    if (rr > 0.01) {
      // Rain: short slanted runs of dots falling from the cloud's underside.
      g.save()
      g.globalAlpha = Math.min(1, rr * 1.6) * 0.9
      const lanes = Math.round(4 + rr * 6)
      for (let i = 0; i < lanes; i++) {
        const x0 = cx - 18 + (i * 37) / lanes + ((i * 7) % 3)
        const speed = 22 + ((i * 13) % 7) * 3
        const fall = (t * speed + i * 17) % 30
        for (let k = 0; k < 3; k++) {
          const y = cy + 14 + fall + k * 2.6
          if (y > H * HORIZON - 2) continue
          g.fillRect(x0 - (fall + k * 2.6) * 0.18, y, 1.3, 1.3)
        }
      }
      g.restore()
    }
  })
}
