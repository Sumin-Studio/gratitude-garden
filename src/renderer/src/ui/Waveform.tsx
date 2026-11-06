import { useEffect, useRef, useState } from 'react'

// A voice note as a sound wave in the garden's dither language
// (garden/Dithered.tsx): columns of 1-bit white dots on the panel, as tall
// as the voice was loud, mirrored about the middle. A column's fractional tip
// is an ordered (Bayer) dither, so the edge breaks up like the skies' do.
//
// Three ways to feed it:
//   live   a function giving the recent levels (newest last), redrawn every
//          frame: the wave runs in from the right while recording.
//   peaks  the note's loudness across it, saved with the note.
//   src    no peaks (an older note): the file is decoded once and measured.
// With `progress` the played part is bright and a head sweeps across; with
// `onSeek` it is the scrubber too (pointer or arrow keys).

/** Dot pitch and size, in CSS px: fine, so the wave reads as a wave, not a
 * row of blocks. */
const PITCH = 2
const DOT = 1
/** Quiet sounds lifted so a voice moves the wave, loud ones still top out. */
const SHAPE = 0.6
/** Peaks a note keeps (shared/diary MAX_PEAKS caps what's stored). */
export const PEAKS = 96
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)

/** Loudest level per bucket: `n` peaks from any number of levels. */
export function toPeaks(levels: number[], n = PEAKS): number[] {
  if (levels.length === 0) return []
  return Array.from({ length: n }, (_, i) => {
    const a = Math.floor((i * levels.length) / n)
    const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / n))
    let m = 0
    for (let k = a; k < b && k < levels.length; k++) m = Math.max(m, levels[k])
    return Math.round(Math.min(1, m) * 1000) / 1000
  })
}

// ---- Older notes: measure the file once -------------------------------------

const measured = new Map<string, Promise<number[]>>()

/** RMS of each slice of the decoded file, lifted like the live meter. */
function measure(src: string): Promise<number[]> {
  let p = measured.get(src)
  if (!p) {
    p = fetch(src)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(async (bytes) => {
        const ctx = new OfflineAudioContext(1, 1, 48000)
        const buf = await ctx.decodeAudioData(bytes)
        const data = buf.getChannelData(0)
        const step = Math.max(1, Math.floor(data.length / PEAKS))
        const out: number[] = []
        for (let i = 0; i < PEAKS; i++) {
          let sum = 0
          let n = 0
          for (let k = i * step; k < (i + 1) * step && k < data.length; k++, n++) sum += data[k] * data[k]
          out.push(n ? Math.min(1, Math.sqrt(sum / n) * 4) : 0)
        }
        return toPeaks(out)
      })
      .catch(() => [])
    measured.set(src, p)
  }
  return p
}

function useMeasured(src: string | null | undefined, peaks: number[] | undefined) {
  const [got, setGot] = useState<number[] | null>(null)
  useEffect(() => {
    if (peaks?.length || !src) return
    let alive = true
    measure(src).then((p) => alive && setGot(p))
    return () => {
      alive = false
    }
  }, [src, peaks])
  return peaks?.length ? peaks : got
}

// ---- Drawing -----------------------------------------------------------------

type Props = {
  peaks?: number[]
  src?: string | null
  live?: () => number[]
  /** 0..1 played, or undefined when it isn't playing or paused part-way. */
  progress?: number
  onSeek?: (at: number) => void
  height?: number
  label?: string
  className?: string
}

export function Waveform({ peaks, src, live, progress, onSeek, height = 24, label = 'Voice note', className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const levels = useMeasured(live ? null : src, peaks)

  // As wide as its box.
  useEffect(() => {
    const c = canvas.current!
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  const liveRef = useRef(live)
  liveRef.current = live
  useEffect(() => {
    const c = canvas.current
    if (!c || width === 0) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = width * dpr
    c.height = height * dpr
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    // The dots are the ink around them (white on the panel).
    const ink = (getComputedStyle(c).color.match(/[\d.]+/g) ?? ['255', '255', '255']).slice(0, 3).join(', ')
    const cols = Math.max(1, Math.floor((width + PITCH - DOT) / PITCH))
    // An odd number of rows, so there's one middle row (with an even number,
    // silence was two rows: a thick line).
    const fit = Math.max(1, Math.floor((height + PITCH - DOT) / PITCH))
    const rows = fit % 2 ? fit : fit - 1
    const half = (rows - 1) / 2
    const x0 = (width - (cols * PITCH - (PITCH - DOT))) / 2
    const y0 = (height - (rows * PITCH - (PITCH - DOT))) / 2

    const draw = (values: number[], played: number | undefined, scroll: boolean) => {
      g.clearRect(0, 0, width, height)
      const head = played === undefined ? -1 : Math.min(cols - 1, Math.floor(played * cols))
      for (let i = 0; i < cols; i++) {
        // Live: newest at the right edge. Saved: the whole note across.
        const v = scroll
          ? values[values.length - cols + i] ?? 0
          : values.length
            ? values[Math.min(values.length - 1, Math.floor((i * values.length) / cols))]
            : 0
        const reach = Math.pow(Math.max(0, v), SHAPE) * half
        const alpha = head < 0 ? 0.85 : i < head ? 0.95 : i === head ? 1 : 0.38
        const full = Math.floor(reach)
        const frac = reach - full
        for (let r = 0; r < rows; r++) {
          const d = Math.abs(r - half)
          // Whole dots up to the level, the next one out by the dither.
          const on = (d > 0 || reach >= 0.5) && (d <= full || (d <= full + 1 && frac > BAYER[(r % 4) * 4 + (i % 4)]))
          if (on) {
            g.fillStyle = `rgba(${ink}, ${alpha})`
            g.fillRect(x0 + i * PITCH, y0 + r * PITCH, DOT, DOT)
          } else if (d === 0) {
            // Silence: one faint hairline of dots through the middle.
            g.fillStyle = `rgba(${ink}, ${alpha * 0.35})`
            g.fillRect(x0 + i * PITCH, y0 + r * PITCH, DOT, DOT)
          }
        }
        // The playhead: a full-height column of fainter dots behind the wave.
        if (i === head) {
          g.fillStyle = `rgba(${ink}, 0.5)`
          for (let r = 0; r < rows; r++) g.fillRect(x0 + i * PITCH, y0 + r * PITCH, DOT, DOT)
        }
      }
    }

    if (live) {
      let raf = 0
      const frame = () => {
        draw(liveRef.current?.() ?? [], undefined, true)
        raf = requestAnimationFrame(frame)
      }
      frame()
      return () => cancelAnimationFrame(raf)
    }
    draw(levels ?? [], progress, false)
  }, [width, height, live !== undefined, levels, progress])

  // Scrubbing: press and drag along it, or the arrow keys.
  const seekAt = (clientX: number) => {
    const c = canvas.current
    if (!c || !onSeek) return
    const r = c.getBoundingClientRect()
    onSeek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)))
  }
  const scrub = onSeek && !live
  return (
    <canvas
      ref={canvas}
      className={`waveform${className ? ` ${className}` : ''}`}
      style={{ display: 'block', width: '100%', height, touchAction: 'none', cursor: scrub ? 'pointer' : undefined }}
      role={scrub ? 'slider' : 'img'}
      aria-label={scrub ? `Seek ${label}` : label}
      aria-valuemin={scrub ? 0 : undefined}
      aria-valuemax={scrub ? 100 : undefined}
      aria-valuenow={scrub ? Math.round((progress ?? 0) * 100) : undefined}
      tabIndex={scrub ? 0 : undefined}
      onPointerDown={
        scrub
          ? (e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              seekAt(e.clientX)
            }
          : undefined
      }
      onPointerMove={scrub ? (e) => e.buttons && seekAt(e.clientX) : undefined}
      onKeyDown={
        scrub
          ? (e) => {
              const step = e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowLeft' ? -0.05 : 0
              if (!step) return
              e.preventDefault()
              onSeek(Math.min(1, Math.max(0, (progress ?? 0) + step)))
            }
          : undefined
      }
    />
  )
}
