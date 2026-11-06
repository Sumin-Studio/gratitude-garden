import { useEffect, useRef } from 'react'
import type { Item } from '../../../shared/diary'
import { fileSrc } from '../store'
import { boxOf, fit, strokePath, strokes, TEXT_FONT, TEXT_LINE, TEXT_W } from './geometry'

// A board drawn once onto a canvas: the pad's day thumbnails and the
// garden's scrapbook pages. Cheap to keep many of: no DOM per item, no
// players (a voice note is its dithered wave, still). Pictures draw in as
// they load.

const images = new Map<string, Promise<HTMLImageElement | null>>()
function image(src: string) {
  let p = images.get(src)
  if (!p) {
    p = new Promise((done) => {
      const img = new Image()
      img.onload = () => done(img)
      img.onerror = () => done(null)
      img.src = src
    })
    images.set(src, p)
  }
  return p
}

function wrap(g: CanvasRenderingContext2D, text: string, width: number) {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (g.measureText(next).width > width && line) {
        out.push(line)
        line = word
      } else line = next
    }
    out.push(line)
  }
  return out
}

/** A rounded rectangle path. */
function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

/** The voice note's dots, as the live wave draws them (ui/Waveform.tsx):
 * fine dots, quiet sounds lifted, one faint row through the middle for silence. */
function wave(g: CanvasRenderingContext2D, colour: (a: number) => string, peaks: number[] | undefined, x: number, y: number, w: number, h: number) {
  const pitch = 2
  const cols = Math.floor(w / pitch)
  const fit = Math.floor(h / pitch)
  const rows = fit % 2 ? fit : fit - 1
  const half = (rows - 1) / 2
  for (let i = 0; i < cols; i++) {
    const v = peaks?.length ? peaks[Math.min(peaks.length - 1, Math.floor((i * peaks.length) / cols))] : 0
    const reach = Math.round(Math.pow(Math.max(0, v), 0.6) * half)
    for (let r = 0; r < rows; r++) {
      const d = Math.abs(r - half)
      if (d <= reach && (d > 0 || reach > 0)) g.fillStyle = colour(0.85)
      else if (d === 0) g.fillStyle = colour(0.3)
      else continue
      g.fillRect(x + i * pitch, y + r * pitch, 1, 1)
    }
  }
}

export async function drawStill(c: HTMLCanvasElement, items: Item[], width: number, height: number, pad = 10) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  c.width = Math.round(width * dpr)
  c.height = Math.round(height * dpr)
  const g = c.getContext('2d')!
  const v = fit(items, width, height, pad)
  // White ink, as on the panel.
  const ink = '255 255 255'
  const inkA = (a: number) => `rgb(${ink} / ${a})`
  const paint = (loaded: Map<string, HTMLImageElement | null>) => {
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, c.width, c.height)
    g.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y)
    for (const it of items) {
      const b = boxOf(it)
      if (it.kind === 'text') {
        g.font = `400 ${TEXT_FONT}px -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`
        g.fillStyle = inkA(0.95)
        g.textBaseline = 'top'
        wrap(g, it.text ?? '', TEXT_W).forEach((line, i) => g.fillText(line, it.x + 4, it.y + 4 + i * TEXT_LINE + 2))
      } else if (it.kind === 'ink') {
        g.save()
        g.translate(it.x, it.y)
        g.strokeStyle = inkA(1)
        // 2 px on screen at full size, never thinner than a hairline small.
        g.lineWidth = Math.max(2, 1 / v.k)
        g.lineCap = 'round'
        g.lineJoin = 'round'
        for (const s of strokes(it.points ?? [])) g.stroke(new Path2D(strokePath(s)))
        g.restore()
      } else if (it.kind === 'voice') {
        rounded(g, b.x, b.y, b.w, b.h, b.h / 2)
        g.fillStyle = inkA(0.12)
        g.fill()
        g.fillStyle = inkA(0.9)
        g.beginPath()
        g.arc(b.x + 22, b.y + b.h / 2, 11, 0, Math.PI * 2)
        g.fill()
        wave(g, inkA, it.peaks, b.x + 42, b.y + 10, b.w - 60, b.h - 20)
      } else {
        const img = loaded.get(it.id)
        // A picture turned on the board is turned here too, about its middle.
        g.save()
        if (it.rot) {
          g.translate(b.x + b.w / 2, b.y + b.h / 2)
          g.rotate((it.rot * Math.PI) / 180)
          g.translate(-(b.x + b.w / 2), -(b.y + b.h / 2))
        }
        g.save()
        rounded(g, b.x, b.y, b.w, b.h, 10)
        g.clip()
        if (img) g.drawImage(img, b.x, b.y, b.w, b.h)
        else {
          g.fillStyle = inkA(0.14)
          g.fillRect(b.x, b.y, b.w, b.h)
        }
        g.restore()
        rounded(g, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 10)
        g.strokeStyle = 'rgba(255,255,255,0.4)'
        g.lineWidth = 1 / v.k
        g.stroke()
        g.restore()
      }
    }
  }
  const loaded = new Map<string, HTMLImageElement | null>()
  paint(loaded)
  const pics = items.filter((it) => it.kind === 'image')
  if (!pics.length) return
  await Promise.all(pics.map(async (it) => loaded.set(it.id, await image(fileSrc(it) ?? ''))))
  paint(loaded)
}

/** A board, still, at a given size. */
export function Still({ items, width, height, pad, className }: { items: Item[]; width: number; height: number; pad?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvas.current) void drawStill(canvas.current, items, width, height, pad)
  }, [items, width, height, pad])
  return <canvas ref={canvas} className={className} style={{ width, height }} aria-hidden="true" />
}
