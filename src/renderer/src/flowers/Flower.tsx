import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Aura } from './Aura'
import { DROP_LAND, Droplets, findSoil } from './Droplets'
import { PetalDrop } from './fallenPetal'
import { maxDt, track, wake } from './pace'
import { fastPick } from './pick'
import { potCut } from './watercolour'
import { poseRig, type Rig } from './rig'
import type { FlowerSpec } from './specs'

// Drives a rigged flower model. The pad holds its water level at 1, so it
// never wilts; the wilt springs are still what make a watering bounce: each
// line kicks them past fresh and they spring back with overshoot, stem
// first, then head, then petals.

class Spring {
  x: number
  v = 0
  constructor(x: number) {
    this.x = x
  }
  step(target: number, dt: number, k: number, c: number) {
    // Semi-implicit Euler in small substeps: stable at any frame rate.
    const n = Math.max(1, Math.ceil(dt / (1 / 240)))
    const h = dt / n
    for (let i = 0; i < n; i++) {
      this.v += (-k * (this.x - target) - c * this.v) * h
      this.x += this.v * h
    }
  }
  snap(x: number) {
    this.x = x
    this.v = 0
  }
  settled(target: number) {
    return Math.abs(this.x - target) < 0.002 && Math.abs(this.v) < 0.01
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
// Brush: degrees per second of swing per unit of cursor impulse, and a cap.
const BRUSH_KICK = 8
const BRUSH_MAX = 20
const DRIFT_K = 5
const DRIFT_C = 2 * Math.sqrt(DRIFT_K)
const rad = THREE.MathUtils.degToRad
const _onScreen = new THREE.Vector3()

// One live query, read every frame (a new matchMedia per call adds up).
const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
const reducedMotion = () => Boolean(motionQuery?.matches)

export type FlowerProps = {
  spec: FlowerSpec
  /** A model bound to the rig contract (placeholder or GLB). */
  rig: Rig
  /** Water 0..1, read every frame (the pad and the studio hold it at 1). */
  level: () => number
  /** Growth 0 (seedling) … 1 (full bloom), read every frame. */
  growth?: () => number
  /** Nothing planted (only the pot shows) or dead, read every frame. */
  phase?: () => 'empty' | 'growing' | 'bloomed' | 'dead'
  /** Change to jump straight to the current pose. */
  snapKey?: number
  /** Changes on every drink: kicks the recovery spring even when already full. */
  drinkKey?: number
  /** How hard that watering rains, in the droplets' ml. */
  drinkMl?: number
  still?: boolean
  /** Pointer x in -1..1 while hovered, null otherwise. Drives the lean. */
  lean?: React.MutableRefObject<number | null>
  /** Cursor brush impulses since the last frame (signed, + = moving right). */
  brush?: React.MutableRefObject<number>
  onPointerOver?: () => void
  onPointerOut?: () => void
  onPointerDown?: (e: PointerEvent) => void
}

export function Flower({ spec, rig, level, growth, phase, snapKey, drinkKey, drinkMl, still, lean, brush, ...events }: FlowerProps) {
  const springs = useRef<{ stem: Spring; head: Spring; petals: Spring } | null>(null)
  const recovering = useRef(false)
  const lastTarget = useRef<number | null>(null)
  const leanSpring = useRef(new Spring(0))
  // A brush of the cursor: a soft, underdamped bend (a few slow swings), a
  // lagging copy for the side stalks and the bloom, and a flutter that dies away.
  const brushSpring = useRef(new Spring(0))
  const brushLag = useRef(new Spring(0))
  const flutter = useRef(0)
  // Growth plays out over a few seconds per watering, like a time-lapse,
  // easing in and settling; never instant, except when snapped for captures.
  const growSpring = useRef(new Spring(growth?.() ?? 1))
  const vitality = useRef(1)
  // Dying is slow and final-looking; coming back from it (a new plant) snaps.
  const deadSpring = useRef(new Spring(phase?.() === 'dead' ? 1 : 0))
  const base = useMemo(() => new THREE.Quaternion(), [])
  const tmp = useMemo(() => new THREE.Quaternion(), [])
  const time = useRef(0)
  const group = useRef<THREE.Group>(null)
  const soil = useMemo(() => findSoil(rig.root), [rig])
  const petalDrop = useRef<PetalDrop | null>(null)
  useEffect(() => {
    const g = group.current
    if (!g) return
    const drop = new PetalDrop(rig, g, { top: soil.y, half: soil.half })
    petalDrop.current = drop
    return () => {
      drop.dispose()
      petalDrop.current = null
    }
  }, [rig, soil])

  // The plant's skinned meshes keep the bounding sphere they first had for
  // picking (three computes it once, from the bones as they were): a plant
  // planted as a seed kept a seed-sized one, so only the pot caught the
  // cursor (no brush, no click on the plant). Re-measured whenever the pose
  // has moved on: growth, wilt or death.
  const skinned = useMemo(() => {
    const out: THREE.SkinnedMesh[] = []
    rig.root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && out.push(o as THREE.SkinnedMesh))
    // Hover and clicks test the posed plant once per frame, not per move (pick.ts).
    for (const mesh of out) fastPick(mesh)
    return out
  }, [rig])
  const measured = useRef({ g: -1, w: -1, d: -1 })

  const target = () => 1 - level()

  // The plant grows up out of the mud, which clips what is still below it
  // (rig.ts measureGrowth). Set here, not at canvas creation, so it holds
  // whenever a flower is on screen.
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  useEffect(() => {
    gl.localClippingEnabled = true
  }, [gl])

  useEffect(() => {
    const w = target()
    springs.current = { stem: new Spring(w), head: new Spring(w), petals: new Spring(w) }
    growSpring.current.snap(growth?.() ?? 1)
    deadSpring.current.snap(phase?.() === 'dead' ? 1 : 0)
    lastTarget.current = w
    recovering.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rig, snapKey])

  // On a drink, hold the pose until the first droplets reach the soil, then
  // release into the recovery with a happy hop (so it still reacts when full).
  const hold = useRef<{ until: number; w: number } | null>(null)
  // Only drinks that happen while this flower is mounted count; switching
  // flower types must not replay the last one.
  const seenDrink = useRef(drinkKey)
  useEffect(() => {
    const s = springs.current
    if (drinkKey === seenDrink.current || !s) return
    seenDrink.current = drinkKey
    hold.current = { until: time.current + (reducedMotion() ? 0 : DROP_LAND), w: s.stem.x }
    wake()
  }, [drinkKey])
  const kick = (s: NonNullable<typeof springs.current>) => {
    recovering.current = true
    if (reducedMotion()) return
    s.stem.v -= 1.6
    s.head.v -= 2.0
    s.petals.v -= 2.4
  }

  useFrame((_, rawDt) => {
    const s = springs.current
    if (!s) return
    const dt = Math.min(rawDt, maxDt())
    time.current += dt
    let w = target()
    if (hold.current) {
      if (time.current < hold.current.until) w = Math.max(w, hold.current.w)
      else {
        hold.current = null
        kick(s)
      }
    }

    // A sudden drop in wilt is a drink: switch to the bouncy recovery spring.
    if (lastTarget.current !== null && lastTarget.current - w > 0.05) recovering.current = true
    lastTarget.current = w

    if (recovering.current) {
      const { stiffness: k, damping: c } = spec.wilt.spring
      if (reducedMotion()) {
        const kk = 90
        s.stem.step(w, dt, kk, 2 * Math.sqrt(kk))
        s.head.step(w, dt, kk, 2 * Math.sqrt(kk))
        s.petals.step(w, dt, kk, 2 * Math.sqrt(kk))
      } else {
        s.stem.step(w, dt, k, c)
        s.head.step(w, dt, k * 0.7, c * 0.8)
        s.petals.step(w, dt, k * 0.5, c * 0.65)
      }
      if (s.stem.settled(w) && s.head.settled(w) && s.petals.settled(w)) recovering.current = false
    } else {
      s.stem.step(w, dt, DRIFT_K, DRIFT_C)
      s.head.step(w, dt, DRIFT_K * 0.8, 2 * Math.sqrt(DRIFT_K * 0.8))
      s.petals.step(w, dt, DRIFT_K * 0.6, 2 * Math.sqrt(DRIFT_K * 0.6))
    }

    // Idle sway shrinks as it wilts: tired plants don't dance.
    const calm = still || reducedMotion()
    const energy = 1 - 0.75 * Math.min(1, Math.max(0, s.stem.x))
    const t = time.current
    const swayZ = calm ? 0 : rad(1.2) * Math.sin((t * Math.PI * 2) / 5.5) * energy
    const swayX = calm ? 0 : rad(0.6) * Math.sin((t * Math.PI * 2) / 7.3 + 1.3) * energy
    leanSpring.current.step(lean?.current ?? 0, dt, 60, 14)
    const leanZ = -rad(3) * leanSpring.current.x
    base.setFromAxisAngle(Z_AXIS, swayZ + leanZ)
    const push = calm ? 0 : (brush?.current ?? 0) * energy
    if (brush) brush.current = 0
    brushSpring.current.v += push * BRUSH_KICK
    brushSpring.current.step(0, dt, 14, 1.7)
    brushSpring.current.x = Math.max(-BRUSH_MAX, Math.min(BRUSH_MAX, brushSpring.current.x))
    brushLag.current.step(brushSpring.current.x, dt, 22, 4)
    flutter.current = Math.min(1, flutter.current * Math.exp(-dt * 1.4) + Math.abs(push) * 0.55)
    tmp.setFromAxisAngle(X_AXIS, swayX)
    base.multiply(tmp)

    // Growth waits for the rain too, then takes its time (Simon: 50% slower
    // than k 2.6, c 3.1; same damping, 1.5× the time).
    if (!hold.current) growSpring.current.step(growth?.() ?? 1, dt, reducedMotion() ? 60 : 1.16, reducedMotion() ? 15.5 : 2.07)
    const g = Math.max(0, Math.min(1.04, growSpring.current.x))
    const ph = phase?.() ?? 'growing'
    if (ph === 'dead') deadSpring.current.step(1, dt, 3, 3.5)
    else deadSpring.current.snap(0)
    // Vitality: how alive it looks. Fresh and grown glows; thirsty dims; dead is dark.
    vitality.current =
      ph === 'dead' || ph === 'empty'
        ? 0
        : (1 - Math.min(1, Math.max(0, s.stem.x))) * THREE.MathUtils.smoothstep(g, 0.3, 0.62)
    poseRig(
      rig,
      spec.wilt,
      {
        stem: s.stem.x,
        head: s.head.x,
        petals: s.petals.x,
        growth: g,
        dead: deadSpring.current.x,
        empty: ph === 'empty',
        sway: brushSpring.current.x,
        swayLag: brushLag.current.x,
        flutter: flutter.current,
        time: t
      },
      base
    )
    const m = measured.current
    if (Math.abs(g - m.g) > 0.02 || Math.abs(s.stem.x - m.w) > 0.05 || Math.abs(deadSpring.current.x - m.d) > 0.05) {
      measured.current = { g, w: s.stem.x, d: deadSpring.current.x }
      for (const mesh of skinned) mesh.computeBoundingSphere()
    }
    // Where the bloom is on screen, so a resting frame is drawn only once it
    // has visibly moved (pace.ts).
    const head = rig.head?.node
    if (head && rig.plantMeshes[0]?.visible !== false) {
      head.updateWorldMatrix(true, false)
      _onScreen.setFromMatrixPosition(head.matrixWorld).project(camera)
      track((_onScreen.x * size.width * dpr) / 2, (_onScreen.y * size.height * dpr) / 2)
    }
    // The pot's frame, for the plant's shader to hide what passes out
    // through the wall (watercolour.ts potCut).
    potCut.fromWorld.value.copy(rig.root.matrixWorld).invert()
    // The real target, not the held one: no petal drops during the drink itself.
    petalDrop.current?.update(dt, target(), s.petals.x, Boolean(still))

    // Anything quicker than the idle sway gets every display frame (pace.ts).
    const bs = brushSpring.current
    const bl = brushLag.current
    if (
      hold.current ||
      recovering.current ||
      !s.stem.settled(w) ||
      !s.head.settled(w) ||
      !s.petals.settled(w) ||
      !growSpring.current.settled(growth?.() ?? 1) ||
      (ph === 'dead' && !deadSpring.current.settled(1)) ||
      !leanSpring.current.settled(lean?.current ?? 0) ||
      Math.abs(bs.x) > 0.02 ||
      Math.abs(bs.v) > 0.05 ||
      Math.abs(bl.x) > 0.02 ||
      Math.abs(bl.v) > 0.05 ||
      flutter.current > 0.003 ||
      petalDrop.current?.busy
    )
      wake()
  })

  return (
    <group
      ref={group}
      onPointerOver={(e) => {
        e.stopPropagation()
        events.onPointerOver?.()
      }}
      onPointerOut={() => events.onPointerOut?.()}
      onPointerDown={(e) => {
        e.stopPropagation()
        events.onPointerDown?.(e.nativeEvent)
      }}
    >
      <primitive object={rig.root} />
      <Droplets drinkKey={drinkKey ?? 0} ml={drinkMl ?? 250} soil={soil} />
      <Aura rig={rig} vitality={() => vitality.current} />
    </group>
  )
}
