import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { growth as growthOf, phaseAt, type DiaryState } from '../../../shared/diary'
import { Flower } from '../flowers/Flower'
import { GroundShadow } from '../flowers/GroundShadow'
import { findSoil } from '../flowers/Droplets'
import { Ink } from '../flowers/Ink'
import { useFlower } from '../flowers/models'
import { Pacer } from '../flowers/pace'
import { FLOWER_SPECS } from '../flowers/specs'
import { CAMERA, setupStudio, StudioLights, usePotGlaze } from '../flowers/studio'
import { bridge } from '../store'

/** Capture and test modes read the canvas back. */
const HEADLESS = new URLSearchParams(location.search).has('headless')
const FADE_MS = 280
/** How hard it rains on a watering (the droplets scale with it). */
export const RAIN_ML = 250

/** The live flower. It never wilts here, so its water level stays at 1. */
export function PadFlower({ state, width, height }: { state: DiaryState; width: number; height: number }) {
  // What's drawn lags the state across a planting: the old flower fades out,
  // the new seed comes in at the bottom of the fade, not as a shrinking plant.
  const [shown, setShown] = useState(state)
  const [fading, setFading] = useState(false)
  const [snapKey, setSnapKey] = useState(0)
  const planted = useRef(state.garden.length)
  useEffect(() => {
    if (state.garden.length === planted.current) {
      if (!fading) setShown(state)
      return
    }
    planted.current = state.garden.length
    setFading(true)
    const id = window.setTimeout(() => {
      setShown(state)
      setSnapKey((k) => k + 1)
      setFading(false)
    }, FADE_MS)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const shownRef = useRef(shown)
  shownRef.current = shown
  const level = useCallback(() => 1, [])
  const growth = useCallback(() => growthOf(shownRef.current), [])
  const phase = useCallback(() => phaseAt(shownRef.current), [])

  const flower = useFlower(shown.plant.flower)
  const spec = FLOWER_SPECS[flower?.id ?? shown.plant.flower]
  usePotGlaze(flower, shown.plant.pot)
  const shadowWidth = flower ? findSoil(flower.rig.root).half * 2 : 0

  // Each line written or said rains on it once.
  const [watered, setWatered] = useState(0)
  useEffect(() => bridge.onWatered(() => setWatered((k) => k + 1)), [])

  // Brushing the cursor across the plant, as on the desktop.
  const over = useRef(false)
  const [hovered, setHovered] = useState(false)
  const brush = useRef(0)
  useEffect(() => {
    let last: { x: number; t: number } | null = null
    const move = (e: PointerEvent) => {
      const t = performance.now()
      if (last && over.current) {
        const vx = (e.clientX - last.x) / (Math.max(8, t - last.t) / 1000)
        brush.current += Math.max(-1, Math.min(1, vx / 1000))
      }
      last = { x: e.clientX, t }
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [])

  return (
    <Canvas
      className={`pad-canvas ${fading ? 'is-fading' : ''}`}
      style={{ width, height, transition: `opacity ${FADE_MS}ms linear` }}
      frameloop="never"
      dpr={Math.min(3, window.devicePixelRatio || 1)}
      gl={{ alpha: true, antialias: false, preserveDrawingBuffer: HEADLESS }}
      camera={CAMERA}
      onCreated={setupStudio}
    >
      <StudioLights />
      <Ink />
      <Pacer full={hovered} />
      {flower && (
        <Flower
          spec={spec}
          rig={flower.rig}
          level={level}
          growth={growth}
          phase={phase}
          snapKey={snapKey}
          drinkKey={watered}
          drinkMl={RAIN_ML}
          brush={brush}
          onPointerOver={() => {
            over.current = true
            setHovered(true)
          }}
          onPointerOut={() => {
            over.current = false
            setHovered(false)
          }}
        />
      )}
      {flower && <GroundShadow width={shadowWidth} rig={flower.rig} />}
    </Canvas>
  )
}
