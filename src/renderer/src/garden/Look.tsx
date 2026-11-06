import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { groundOf, settle, WATER_Y, type Slot } from './layout'
import { shared, tune } from './paint'
import { plantBox } from './Planted'

// The camera holds one angle, the very one the flower is seen from in the pad
// and in the pad (flowers/studio.tsx: straight on, from [0, 2.2, 7] at [0, 0.92, 0]),
// so a planted lotus looks just as it did growing. The lens is wider and the
// camera closer than the flower's, so depth reads: far flowers look smaller. Drag a flower to
// carry it anywhere on the water. Scroll to zoom, click (or double-click) a flower to walk up to it, click the
// ground or press Esc to step back. Both ease towards a goal and neither changes the angle.

const rad = THREE.MathUtils.degToRad
export const HOME = {
  yaw: 0,
  pitch: Math.atan2(2.2 - 0.92, 7),
  dist: 16.5,
  at: new THREE.Vector3(0, 2.1, 1.5)
}
const ZOOM: [number, number] = [7, 20]
const LENS = 44

/** Walks the view back to where it started (the controls' Reset). */
export const view = { home: () => {} }

/** How far you can walk the view round the garden, from where it starts. */
const ROAM = { x: [-12, 12], z: [-8, 9] } as const
const FOCUS_DIST = 8
/** Visit the garden's close-up on the bloom: how near, per unit of the
 * plant's scale, and how high up it the camera aims (the bloom opens there). */
const CLOSE_DIST = 3.4
/** How long a visit's way back out to the whole garden takes. */
const ZOOM_OUT_MS = 3600
const CLOSE_AIM = 0.8
/** The ground patches open near the ground: aim low on them. */
const LOW: Record<string, number> = { daisy: 0.2, nemophila: 0.2 }
/** A press that moves less than this before release is a click, not a drag. */
const CLICK = 6
/** Height of a pick point and of the framing target above the pot, per unit of scale. */
const BLOOM = 1.2
/** How far the framed flower sits left of centre, as a share of the width. No label is shown now, so it stays centred. */
const LABEL_SHIFT = 0

export type View = { yaw: number; pitch: number; dist: number; at: THREE.Vector3 }

export type Looker = {
  goal: View
  /** Jump to the goal, no easing. */
  snap(): void
}

type Props = {
  spots: Slot[]
  focus: number | null
  onFocus(i: number | null): void
  /** The flower the callout points at: the focus, or while stepping back, the one just left. */
  anchor?: number | null
  /** A carried flower moved. */
  onMove?(i: number): void
  /** A carried flower was put down. */
  onPlace?(i: number): void
  /** Each frame: the focused bloom on screen, in CSS px. */
  /** The bloom on screen each frame, and the flower's outline there (CSS px). */
  onAnchor?(x: number, y: number, box?: ScreenBox): void
  looker?: React.MutableRefObject<Looker | null>
  /** Visit the garden: come in close on the focused flower while it blooms. */
  close?: boolean
}

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt))
const clamp = THREE.MathUtils.clamp

export type ScreenBox = { l: number; t: number; r: number; b: number }

export function Look({ spots, focus, onFocus, anchor, onMove, onPlace, onAnchor, looker, close = false }: Props) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const dom = useThree((s) => s.gl.domElement)
  const size = useThree((s) => s.size)
  const goal = useRef<View>({ ...HOME, at: HOME.at.clone() })
  const now = useRef<View>({ ...HOME, at: HOME.at.clone() })
  const shift = useRef(0)
  const roam = useRef({ dist: HOME.dist, at: HOME.at.clone() })
  const spotsRef = useRef(spots)
  spotsRef.current = spots
  const focusRef = useRef(focus)
  focusRef.current = focus
  const anchorRef = useRef<number | null>(anchor === undefined ? focus : anchor)
  anchorRef.current = anchor === undefined ? focus : anchor

  const point = useMemo(() => new THREE.Vector3(), [])
  const pin = useMemo(() => new THREE.Vector3(), [])
  /** The flower in hand: where it's headed, how high it's lifted. */
  const carry = useRef<{ i: number; x: number; z: number; lift: number; down: boolean } | null>(null)
  const bloomOf = (s: Slot, v: THREE.Vector3) => v.set(s.x, s.y + BLOOM * s.scale, s.z)

  // Letting go of a visit's close-up: the way back out is one slow, even
  // ease in and out (Simon: it was too fast; the usual easing leaps off at
  // the start). A wheel or a drag takes over from it.
  const out = useRef<{ t0: number; dist: number; at: THREE.Vector3 } | null>(null)
  const wasClose = useRef(close)
  useEffect(() => {
    const letGo = wasClose.current && !close
    wasClose.current = close
    if (letGo) out.current = { t0: performance.now(), dist: now.current.dist, at: now.current.at.clone() }
  }, [close])

  // Follow the focus: walk up to the flower, and walk back to where you were.
  useEffect(() => {
    if (focus !== null && spots[focus]) {
      if (goal.current.dist > FOCUS_DIST + 1) roam.current.dist = goal.current.dist
      const s = spots[focus]
      if (close) {
        // Right up to it, aimed where the bloom will open; when the bloom has
        // played the visit lets go and the view eases back out.
        goal.current.at.set(s.x, s.y + BLOOM * (LOW[s.kind ?? ''] ?? CLOSE_AIM) * s.scale, s.z)
        goal.current.dist = CLOSE_DIST * s.scale
      } else {
        bloomOf(s, goal.current.at)
        goal.current.dist = FOCUS_DIST
      }
    } else {
      goal.current.at.copy(roam.current.at)
      goal.current.dist = roam.current.dist
    }
  }, [focus, spots, close])

  useEffect(() => {
    if (looker)
      looker.current = {
        goal: goal.current,
        snap() {
          now.current.yaw = rad(tune.turn.value)
          now.current.pitch = rad(tune.tilt.value)
          camera.fov = tune.lens.value
          camera.updateProjectionMatrix()
          now.current.dist = goal.current.dist
          now.current.at.copy(goal.current.at)
          shift.current = focusRef.current === null ? 0 : LABEL_SHIFT
        }
      }
  }, [looker, camera])

  useEffect(() => {
    const pick = (cx: number, cy: number) => {
      const r = dom.getBoundingClientRect()
      const scale = r.height / (2 * Math.tan(rad(camera.fov) / 2))
      let best: number | null = null
      let bestD = Infinity
      spotsRef.current.forEach((s, i) => {
        // Bloom and pot both count: a flower is about a stem tall on screen.
        for (const y of [0.1, BLOOM]) {
          point.set(s.x, s.y + y * s.scale, s.z)
          // Near flowers are bigger on screen, so their target is too.
          const unit = scale / Math.max(1, camera.position.distanceTo(point))
          point.project(camera)
          const d = Math.hypot(((point.x + 1) / 2) * r.width + r.left - cx, ((1 - point.y) / 2) * r.height + r.top - cy)
          if (d < 0.75 * unit * Math.max(0.5, s.scale * 1.6) && d < bestD) {
            bestD = d
            best = i
          }
        }
      })
      return best
    }

    const ray = new THREE.Raycaster()
    const water = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y)
    const hit = new THREE.Vector3()
    const ndc = new THREE.Vector2()
    /** Where the pointer meets the water's plane. */
    const onWater = (cx: number, cy: number) => {
      const r = dom.getBoundingClientRect()
      ndc.set(((cx - r.left) / r.width) * 2 - 1, 1 - ((cy - r.top) / r.height) * 2)
      ray.setFromCamera(ndc, camera)
      return ray.ray.intersectPlane(water, hit) ? ([hit.x, hit.z] as const) : null
    }
    let press: { i: number; x: number; y: number; dx: number; dz: number } | null = null
    /** Dragging empty ground: the spot grabbed stays under the pointer, so the
     * garden slides under you like a map. */
    let pan: { cx: number; cy: number; x0: number; y0: number } | null = null
    const down = (e: PointerEvent) => {
      out.current = null
      if (e.button !== 0) return
      const i = pick(e.clientX, e.clientY)
      if (i === null) {
        if (!onWater(e.clientX, e.clientY)) return
        pan = { cx: e.clientX, cy: e.clientY, x0: e.clientX, y0: e.clientY }
        dom.setPointerCapture(e.pointerId)
        dom.classList.add('is-panning')
        return
      }
      // Where you grabbed it stays under the pointer, so it doesn't jump.
      const s = spotsRef.current[i]
      const at = onWater(e.clientX, e.clientY)
      press = { i, x: e.clientX, y: e.clientY, dx: at ? s.x - at[0] : 0, dz: at ? s.z - at[1] : 0 }
      dom.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (pan) {
        // Where the last and this pointer meet the ground, seen by the same
        // camera, so many moves within one frame still add up right.
        const was = onWater(pan.cx, pan.cy)
        const at = onWater(e.clientX, e.clientY)
        pan = { cx: e.clientX, cy: e.clientY, x0: pan.x0, y0: pan.y0 }
        // Near the horizon the ground runs off to infinity: ignore those.
        const far = (p: readonly [number, number]) => Math.hypot(p[0] - camera.position.x, p[1] - camera.position.z) > 60
        if (!was || !at || far(was) || far(at)) return
        const step = (v: number) => clamp(v, -1.5, 1.5)
        const dx = step(was[0] - at[0])
        const dz = step(was[1] - at[1])
        for (const v of [goal.current.at, now.current.at]) {
          v.x = clamp(v.x + dx, HOME.at.x + ROAM.x[0], HOME.at.x + ROAM.x[1])
          v.z = clamp(v.z + dz, HOME.at.z + ROAM.z[0], HOME.at.z + ROAM.z[1])
        }
        return
      }
      if (!press) {
        dom.classList.toggle('is-over', pick(e.clientX, e.clientY) !== null)
        return
      }
      if (!carry.current?.down && Math.hypot(e.clientX - press.x, e.clientY - press.y) < CLICK) return
      const onSurface = onWater(e.clientX, e.clientY)
      if (!onSurface) return
      const at = settle(spotsRef.current[press.i], onSurface[0] + press.dx, onSurface[1] + press.dz)
      if (!carry.current?.down) {
        const s = spotsRef.current[press.i]
        carry.current = { i: press.i, x: s.x, z: s.z, lift: carry.current?.lift ?? 0, down: true }
        dom.classList.add('is-dragging')
      }
      carry.current!.x = at[0]
      carry.current!.z = at[1]
    }
    const up = (e: PointerEvent) => {
      const still = (x: number, y: number) => e.type === 'pointerup' && Math.hypot(e.clientX - x, e.clientY - y) < CLICK
      if (pan) {
        // A click on the ground (no pan to speak of) steps back from a flower.
        if (still(pan.x0, pan.y0) && focusRef.current !== null) onFocus(null)
        pan = null
        dom.classList.remove('is-panning')
        if (focusRef.current === null) roam.current.at.copy(goal.current.at)
      }
      if (carry.current?.down) {
        carry.current.down = false
        dom.classList.remove('is-dragging')
        onPlace?.(carry.current.i)
      } else if (press && still(press.x, press.y)) onFocus(press.i)
      press = null
    }
    /** Slide the garden as if the pointer had moved by (mx, my) while
     * holding the ground: the same as dragging it. */
    const slide = (cx: number, cy: number, mx: number, my: number) => {
      const was = onWater(cx, cy)
      const at = onWater(cx + mx, cy + my)
      const far = (p: readonly [number, number]) => Math.hypot(p[0] - camera.position.x, p[1] - camera.position.z) > 60
      if (!was || !at || far(was) || far(at)) return
      const step = (v: number) => clamp(v, -1.5, 1.5)
      const dx = step(was[0] - at[0])
      const dz = step(was[1] - at[1])
      for (const v of [goal.current.at, now.current.at]) {
        v.x = clamp(v.x + dx, HOME.at.x + ROAM.x[0], HOME.at.x + ROAM.x[1])
        v.z = clamp(v.z + dz, HOME.at.z + ROAM.z[0], HOME.at.z + ROAM.z[1])
      }
      roam.current.at.copy(goal.current.at)
    }
    // A trackpad (Mac): two fingers move round the garden like a map, a pinch
    // (or ⌘/ctrl with a wheel) zooms.
    const wheel = (e: WheelEvent) => {
      out.current = null
      e.preventDefault()
      const g = goal.current
      if (e.ctrlKey || e.metaKey) {
        g.dist = clamp(g.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)), ZOOM[0], ZOOM[1])
        if (focusRef.current === null) roam.current.dist = g.dist
        return
      }
      // Moving off a flower lets go of it.
      if (focusRef.current !== null) onFocus(null)
      const line = e.deltaMode === 1 ? 16 : 1
      slide(e.clientX, e.clientY, -e.deltaX * line, -e.deltaY * line)
    }
    const dbl = (e: MouseEvent) => {
      const i = pick(e.clientX, e.clientY)
      if (i !== null) onFocus(i)
    }
    view.home = () => {
      roam.current.at.copy(HOME.at)
      roam.current.dist = HOME.dist
      goal.current.at.copy(HOME.at)
      goal.current.dist = HOME.dist
      onFocus(null)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Esc steps back from a flower; with none in view, it walks home.
      if (focusRef.current === null) {
        roam.current.at.copy(HOME.at)
        goal.current.at.copy(HOME.at)
      } else onFocus(null)
    }
    dom.addEventListener('pointerdown', down)
    dom.addEventListener('pointermove', move)
    dom.addEventListener('pointerup', up)
    dom.addEventListener('pointercancel', up)
    dom.addEventListener('wheel', wheel, { passive: false })
    dom.addEventListener('dblclick', dbl)
    addEventListener('keydown', key)
    return () => {
      dom.removeEventListener('pointerdown', down)
      dom.removeEventListener('pointermove', move)
      dom.removeEventListener('pointerup', up)
      dom.removeEventListener('pointercancel', up)
      dom.removeEventListener('wheel', wheel)
      dom.removeEventListener('dblclick', dbl)
      removeEventListener('keydown', key)
    }
  }, [dom, camera, onFocus, onPlace, point])

  // First in the frame, before the pond and the ink draw with this camera.
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const n = now.current
    const g = goal.current
    const to = g.at
    const o = out.current
    if (o) {
      const k = Math.min(1, (performance.now() - o.t0) / ZOOM_OUT_MS)
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      n.dist = o.dist + (g.dist - o.dist) * e
      n.at.lerpVectors(o.at, to, e)
      if (k >= 1) out.current = null
    } else {
      n.dist = damp(n.dist, g.dist, 6, dt)
      n.at.x = damp(n.at.x, to.x, 5, dt)
      n.at.y = damp(n.at.y, to.y, 5, dt)
      n.at.z = damp(n.at.z, to.z, 5, dt)
    }
    n.yaw = damp(n.yaw, rad(tune.turn.value), 3.5, dt)
    n.pitch = damp(n.pitch, rad(tune.tilt.value), 3.5, dt)
    const fov = damp(camera.fov, tune.lens.value, 3.5, dt)
    if (Math.abs(fov - camera.fov) > 1e-3) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    // The carried flower follows the pointer with a little weight, lifted off
    // the water, and settles back when it's put down.
    const c = carry.current
    if (c && spotsRef.current[c.i]) {
      const s = spotsRef.current[c.i]
      s.x = damp(s.x, c.x, 16, dt)
      s.z = damp(s.z, c.z, 16, dt)
      c.lift = damp(c.lift, c.down ? 0.4 : 0, 12, dt)
      s.y = groundOf(s) + c.lift
      onMove?.(c.i)
      if (!c.down && c.lift < 0.004) {
        s.y = groundOf(s)
        onMove?.(c.i)
        carry.current = null
      }
    }
    // A narrower lens backs off to frame the same.
    const dist = (n.dist * Math.tan(rad(LENS) / 2)) / Math.tan(rad(camera.fov) / 2)
    const flat = Math.cos(n.pitch) * dist
    camera.position.set(n.at.x + Math.sin(n.yaw) * flat, n.at.y + Math.sin(n.pitch) * dist, n.at.z + Math.cos(n.yaw) * flat)
    camera.lookAt(n.at)
    shift.current = damp(shift.current, focusRef.current === null ? 0 : LABEL_SHIFT, 5, dt)
    if (Math.abs(shift.current) > 1e-4) camera.setViewOffset(size.width, size.height, shift.current * size.width, 0, size.width, size.height)
    else camera.clearViewOffset()
    camera.updateMatrixWorld()
    // The paper grain's pin (Film): a fixed point of the garden on screen, and
    // the zoom against home.
    pin.copy(HOME.at).project(camera)
    shared.uPaperAt.value.set(((pin.x + 1) / 2) * size.width, ((pin.y + 1) / 2) * size.height, HOME.dist / Math.max(0.5, n.dist))
    const f = anchorRef.current
    if (f !== null && spotsRef.current[f] && onAnchor) {
      bloomOf(spotsRef.current[f], point).project(camera)
      const ax = ((point.x + 1) / 2) * size.width
      const ay = ((1 - point.y) / 2) * size.height
      let box: ScreenBox | undefined
      const outline = plantBox.of?.(f)
      if (outline?.length) {
        box = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity }
        for (const c of outline) {
          c.project(camera)
          const x = ((c.x + 1) / 2) * size.width
          const y = ((1 - c.y) / 2) * size.height
          box = { l: Math.min(box.l, x), t: Math.min(box.t, y), r: Math.max(box.r, x), b: Math.max(box.b, y) }
        }
      }
      // The dot on the plant as drawn: near its top, in the middle. The fixed
      // bloom height floats above a seedling.
      if (box) onAnchor((box.l + box.r) / 2, box.t + (box.b - box.t) * 0.18, box)
      else onAnchor(ax, ay)
    }
  }, -1)

  return null
}
