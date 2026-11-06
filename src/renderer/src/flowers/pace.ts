import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'

// The flower's frame pacing. At rest the only motion is the idle sway, a
// fraction of a pixel per frame, so it isn't drawn at the display's 144 Hz: a
// transparent window that redraws every frame makes the WindowServer
// recomposite the desktop under it every frame. At rest a frame is drawn only
// once the bloom has moved STEP_PX on screen (finer than the ~0.16 px a 30 fps
// sway steps at its fastest) or MAX_GAP_MS has passed, and the pose is
// worked out about that often too (from the bloom's speed, at most IDLE_FPS):
// a full bloom at rest draws ~10 fps, a seedling or empty pot ~4.
// Anything quicker (hover, a brush, a drink, the recovery, growing, the ring)
// poses and draws every display frame exactly as before: `full` from the app,
// or `wake()` from whatever is moving, called each frame while it moves.
// Nothing runs while the page is hidden.

const IDLE_FPS = 30
const IDLE_MS = 1000 / IDLE_FPS
const STEP_PX = 0.1
const MAX_GAP_MS = 250

let busyUntil = 0
let kick: (() => void) | null = null
/** Pose ticks (pick.ts caches posed vertices per tick). */
let ticks = 0
/** This tick runs at full rate. */
let fastTick = true
/** Where the bloom is this tick, where it was last tick and when last drawn (device px). */
let at: { x: number; y: number } | null = null
let prev: { x: number; y: number; t: number } | null = null
let drawn: { x: number; y: number; t: number } | null = null
/** Until the next resting tick: about when the bloom will have moved STEP_PX. */
let gap = IDLE_MS
/** Frames drawn, for the SIP_PERF probe. */
let draws = 0

export const frameStamp = () => ticks

/** The longest frame step to trust: 1/20 s as ever, but a resting tick may
 * be a quarter second after the last and must count all of it, or the sway
 * would slow down. */
export const maxDt = () => (fastTick ? 1 / 20 : (MAX_GAP_MS + 50) / 1000)

/** The bloom's position on screen this tick, in device px. */
export function track(x: number, y: number) {
  at = { x, y }
}

/** Whether this tick is worth drawing (Ink asks, after the pose is set). */
export function shouldDraw() {
  const now = performance.now()
  // Its speed on screen sets when to look again.
  const speed = at && prev && now > prev.t ? Math.hypot(at.x - prev.x, at.y - prev.y) / (now - prev.t) : 0
  gap = speed > 0 ? Math.min(MAX_GAP_MS, Math.max(IDLE_MS, STEP_PX / speed)) : MAX_GAP_MS
  prev = at ? { ...at, t: now } : null
  const moved = at && drawn ? Math.hypot(at.x - drawn.x, at.y - drawn.y) : Infinity
  if (!fastTick && now >= busyUntil && drawn && now - drawn.t < MAX_GAP_MS && moved < STEP_PX) return false
  drawn = { x: at?.x ?? 0, y: at?.y ?? 0, t: now }
  ;(window as unknown as { __sipRendered: number }).__sipRendered = ++draws
  return true
}

/** Full-rate frames for at least the next `ms`. */
export function wake(ms = 250) {
  const until = performance.now() + ms
  if (until > busyUntil) busyUntil = until
  kick?.()
}

/** Drives the Canvas (frameloop="never"): every display frame while busy, IDLE_FPS ticks otherwise. */
export function Pacer({ full }: { full: boolean }) {
  const advance = useThree((s) => s.advance)
  const fullRef = useRef(full)
  fullRef.current = full
  useEffect(() => {
    if (full) kick?.()
  }, [full])

  useEffect(() => {
    let raf = 0
    let timer: number | undefined
    let last = -Infinity
    const fast = () => fullRef.current || performance.now() < busyUntil
    const frame = (t: number) => {
      raf = 0
      if (document.hidden) return
      fastTick = fast()
      if (fastTick || t - last >= gap - 1) {
        last = t
        ticks++
        at = null
        // Seconds: r3f's frame delta in "never" mode is this minus the last one.
        advance(t / 1000)
      }
      schedule()
    }
    const schedule = () => {
      if (raf || timer !== undefined || document.hidden) return
      if (fast()) raf = requestAnimationFrame(frame)
      // Idle ticks on a timer, not rAF: asking for animation frames keeps
      // Chromium's vsync running at 144 Hz even when nothing is drawn. A
      // drawn tick still reaches the screen on the next vsync.
      else
        timer = window.setTimeout(() => {
          timer = undefined
          frame(performance.now())
        }, Math.max(0, last + gap - performance.now()))
    }
    // Something started moving: don't wait out the idle gap.
    kick = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timer = undefined
      }
      schedule()
    }
    const onVisible = () => kick?.()
    document.addEventListener('visibilitychange', onVisible)
    schedule()
    return () => {
      kick = null
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [advance])

  return null
}
