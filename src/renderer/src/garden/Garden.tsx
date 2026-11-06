import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Ink, supersample } from '../flowers/Ink'
import { Pacer } from '../flowers/pace'
import { bakeDapple, type Caster } from './dapple'
import { Label, type LabelHandle } from './Label'
import { bedSlot, character, heightAt, pondDist, settle, slots, SUN, type Slot } from './layout'
import { Backdrop } from './Backdrop'
import { Film } from './Film'
import { Grasses } from './Grasses'
import { Lawn } from './Lawn'
import { HOME, Look, type Looker, type ScreenBox } from './Look'
import { HAZE, shared, tune } from './paint'
import { Planted, type Mover } from './Planted'
import { Maple } from './Maple'
import { Pond } from './Pond'
import type { GardenFlower } from './types'

/** How each lawn kind shades the grass: its spread and height, in its own
 * units. The ground patches lie flat and cast nothing. */
const CASTS: Record<string, [number, number]> = {
  shrub: [0.75, 1.3],
  blossom: [0.3, 1.4],
  chrysanthemum: [0.45, 0.8],
  iris: [0.42, 0.9],
  lily: [0.35, 0.5],
  jasmine: [0.6, 0.7]
}
const casters = (spots: Slot[]): Caster[] =>
  spots.flatMap((s) => {
    const c = s.land && CASTS[s.kind ?? '']
    return c ? [{ x: s.x, y: s.y, z: s.z, r: c[0] * s.scale, h: c[1] * s.scale * (s.tall ?? 1) }] : []
  })

const calm = matchMedia('(prefers-reduced-motion: reduce)')

// Your arrangement, by flower id. Kept in this window's storage until the
// diary state has a place for it (piece C).
const LAYOUT = 'sip-garden-layout'

function readLayout(): Record<string, [number, number]> {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT) ?? '{}')
  } catch {
    return {}
  }
}

function writeLayout(layout: Record<string, [number, number]>) {
  try {
    localStorage.setItem(LAYOUT, JSON.stringify(layout))
  } catch {
    /* private mode: this session only */
  }
}

function Clock() {
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  useEffect(() => {
    gl.getDrawingBufferSize(shared.uScreen.value).multiplyScalar(supersample(dpr))
  }, [gl, size, dpr])
  useFrame((_, dt) => {
    if (!calm.matches) shared.uTime.value += Math.min(dt, 1 / 20)
  }, -2)
  return null
}

export type GardenProps = {
  flowers: GardenFlower[]
  /** Keep the canvas readable (capture mode). */
  capture?: boolean
  /** Show the callout on the focused flower (not in a snapshot). */
  callout?: boolean
  looker?: React.MutableRefObject<Looker | null>
  onReady?: () => void
  focus?: number | null
  onFocus?: (i: number | null) => void
  /** Keep the callout closed for now (a visit's bloom is playing). */
  held?: boolean
}

export function Garden({ flowers, capture, callout = true, looker, onReady, focus: shownFocus, onFocus, held = false }: GardenProps) {
  const [ownFocus, setOwnFocus] = useState<number | null>(null)
  const focus = shownFocus !== undefined ? shownFocus : ownFocus
  const pick = useCallback((i: number | null) => (onFocus ?? setOwnFocus)(i), [onFocus])
  const ids = flowers.map((f) => f.id).join()
  // Everyone's default place, then wherever they've been moved to.
  const spots = useMemo(() => {
    const saved = readLayout()
    // Lotuses in the pond, everything else on the lawn round it.
    const water = slots(flowers.filter((f) => f.flower === 'lotus').length)
    let w = 0
    const nth: Record<string, number> = {}
    return flowers.map((f) => {
      const s = f.flower === 'lotus' ? water[w++] : bedSlot(f.flower, (nth[f.flower] = (nth[f.flower] ?? -1) + 1))
      const { rise, size, turn, tall } = character(f.id)
      // f.size: how big the day grew it (0.7..1, diary daySize).
      const own = { ...s, rise: s.land ? 0 : rise, turn, scale: s.scale * size * (f.size ?? 1), tall: s.land ? tall : 1 }
      const at = saved[f.id]
      // A spot saved on the wrong ground (a lawn flower in the pond, say) is stale.
      if (!at || (own.land ? pondDist(at[0], at[1]) < 0.28 : pondDist(at[0], at[1]) > -0.05)) return own
      const [x, z] = settle(own, at[0], at[1])
      return { ...own, x, z, y: s.land ? heightAt(x, z) : s.y }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])
  const mover = useRef<Mover | null>(null)
  const onMove = useCallback((i: number) => mover.current?.(i), [])
  const onPlace = useCallback(
    (i: number) => {
      const saved = readLayout()
      saved[flowers[i].id] = [spots[i].x, spots[i].z]
      writeLayout(saved)
      bakeDapple(casters(spots))
    },
    [flowers, spots]
  )
  useMemo(() => bakeDapple(casters(spots)), [spots])
  // The timelapse repaints the plants' shade on the lawn with only those
  // grown so far (main.tsx sends their ids; null puts every plant back).
  useEffect(() => {
    const grown = (e: Event) => {
      const ids = (e as CustomEvent<Set<string> | null>).detail
      bakeDapple(casters(ids ? spots.filter((_, i) => ids.has(flowers[i]?.id)) : spots))
    }
    window.addEventListener('sip-lapse-shade', grown)
    return () => window.removeEventListener('sip-lapse-shade', grown)
  }, [spots, flowers])
  useEffect(() => {
    if (focus !== null && !flowers[focus]) pick(null)
  }, [focus, flowers, pick])
  // The callout: pointing at the focus, and while the camera steps back, still
  // at the flower just left until its line has drawn back.
  const [shown, setShown] = useState<number | null>(null)
  useEffect(() => {
    if (focus !== null && !held) setShown(focus)
  }, [focus, held])
  const gone = useCallback(() => setShown(null), [])
  const label = useRef<LabelHandle>(null)
  const anchor = useCallback(
    (x: number, y: number, box?: ScreenBox) => {
      // The harness and the page snapshot read where the flower is.
      if (capture) (window as unknown as { __gardenAnchor: unknown }).__gardenAnchor = { x, y, box }
      label.current?.point(x, y, box)
    },
    [capture]
  )

  return (
    <>
      <Canvas
        // Fish swim and leaves stir all the time: every display frame while
        // the window is on screen. Pacer stops when the page is hidden.
        frameloop="never"
        // Finer than the screen when the dither pixel is under a point (0.75:
        // the canvas at 4/3, so each dot is one of its pixels).
        dpr={Math.min(2, Math.max(window.devicePixelRatio || 1, 1 / Math.max(0.5, tune.pixel.value)))}
        gl={{ antialias: false, preserveDrawingBuffer: Boolean(capture) }}
        camera={{ fov: 44, near: 1, far: 400, position: [0, 6, 18] }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor(0x000000, 0)
          gl.toneMapping = THREE.NeutralToneMapping
          gl.toneMappingExposure = 1.12
          const pmrem = new THREE.PMREMGenerator(gl)
          scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
          scene.environmentIntensity = 0.5
          pmrem.dispose()
          scene.background = new THREE.Color(HAZE)
        }}
      >
        <Clock />
        {/* A warm key from the back-left over a soft, cooler sky fill, so
            nothing in shade goes muddy. */}
        <hemisphereLight args={['#f4f6ff', '#dfe6c8', 1.25]} />
        <directionalLight position={SUN} intensity={1.05} color="#ffe6c2" />
        <Backdrop />
        <Lawn />
        <Pond />
        <Maple />
        <Grasses />
        <Planted flowers={flowers} spots={spots} mover={mover} onReady={onReady} />
        <Look spots={spots} focus={focus} onFocus={pick} anchor={shown} onMove={onMove} onPlace={onPlace} onAnchor={anchor} looker={looker} close={held} />
        <Ink strength={0.4} />
        <Film />
        <Pacer full />
      </Canvas>
      {callout && shown !== null && flowers[shown] && (
        <Label key={flowers[shown].id} ref={label} flower={flowers[shown]} open={focus === shown} onGone={gone} onBack={() => pick(null)} />
      )}
    </>
  )
}

export { HOME }
