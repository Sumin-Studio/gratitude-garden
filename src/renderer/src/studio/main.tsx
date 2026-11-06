import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { growth as growthOf, phaseAt } from '../../../shared/diary'
import { findSoil } from '../flowers/Droplets'
import { Flower } from '../flowers/Flower'
import { GroundShadow } from '../flowers/GroundShadow'
import { Ink } from '../flowers/Ink'
import { exportPlaceholder, useFlower } from '../flowers/models'
import { Pacer } from '../flowers/pace'
import { FLOWER_SPECS } from '../flowers/specs'
import { CAMERA, setupStudio, StudioLights, usePotGlaze } from '../flowers/studio'
import { RAIN_ML } from '../pad/PadFlower'
import { bridge, useCapturePose, useDiary } from '../store'

// The capture studio: the pad's flower alone in a window, for the review
// captures, the perf probe and the placeholder export (main/index.ts). Main
// poses it ('sip:capture-pose') and rains on it ('sip:watered'); unposed it
// shows the diary's own plant. Never part of the app you use.

function Studio() {
  const state = useDiary()
  const pose = useCapturePose()
  const [snapKey, setSnapKey] = useState(0)
  const [watered, setWatered] = useState(0)
  useEffect(() => bridge.onWatered(() => setWatered((k) => k + 1)), [])
  useEffect(() => bridge.onExportRequest(async (id) => bridge.exportDone(id, await exportPlaceholder(id))), [])

  const flowerId = pose?.flower ?? state?.plant.flower ?? 'lotus'
  const flower = useFlower(flowerId)
  const spec = FLOWER_SPECS[flower?.id ?? flowerId]
  usePotGlaze(flower, pose?.pot ?? state?.plant.pot ?? 'clay')
  const shadowWidth = useMemo(() => (flower ? findSoil(flower.rig.root).half * 2 : 0), [flower])

  // Once the posed flower is on screen (two frames on), tell main.
  useEffect(() => {
    if (!pose || !flower || flower.id !== (pose.flower ?? flower.id)) return
    if (pose.snap) setSnapKey((k) => k + 1)
    requestAnimationFrame(() => requestAnimationFrame(() => bridge.capturePosed()))
  }, [pose, flower])

  const poseRef = useRef(pose)
  poseRef.current = pose
  const stateRef = useRef(state)
  stateRef.current = state
  const level = useCallback(() => 1, [])
  const growth = useCallback(() => poseRef.current?.growth ?? (stateRef.current ? growthOf(stateRef.current) : 1), [])
  const phase = useCallback(() => poseRef.current?.phase ?? (stateRef.current ? phaseAt(stateRef.current) : 'growing'), [])

  // The cursor brushes it, as in the pad (the perf probe sweeps it).
  const brush = useRef(0)
  const over = useRef(false)
  const [hovered, setHovered] = useState(false)
  useEffect(() => {
    let last: { x: number; t: number } | null = null
    const move = (e: PointerEvent) => {
      const t = performance.now()
      if (last && over.current) brush.current += Math.max(-1, Math.min(1, (e.clientX - last.x) / (Math.max(8, t - last.t) / 1000) / 1000))
      last = { x: e.clientX, t }
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [])

  return (
    <Canvas
      className="studio"
      frameloop="never"
      dpr={Math.min(3, window.devicePixelRatio || 1)}
      gl={{ alpha: true, antialias: false, preserveDrawingBuffer: true }}
      camera={CAMERA}
      onCreated={setupStudio}
    >
      <StudioLights />
      <Ink />
      <Pacer full={hovered || Boolean(pose)} />
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
          still={pose?.still}
          brush={brush}
          onPointerOver={() => ((over.current = true), setHovered(true))}
          onPointerOut={() => ((over.current = false), setHovered(false))}
        />
      )}
      {flower && <GroundShadow width={shadowWidth} rig={flower.rig} />}
    </Canvas>
  )
}

Object.assign(document.documentElement.style, { background: 'transparent', height: '100%' })
Object.assign(document.body.style, { margin: '0', height: '100%', overflow: 'hidden' })
const root = document.getElementById('root')!
root.style.height = '100%'
createRoot(root).render(<Studio />)
