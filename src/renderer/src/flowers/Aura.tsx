import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { maxDt } from './pace'
import type { Rig } from './rig'

// A soft halo of light behind a thriving bloom, breathing slowly. It scales
// with `vitality` (thirst × growth): a fresh bloom glows, a thirsty one dims,
// a dead one has none. Normal blending with soft alpha, so it reads as light
// on any desktop behind the transparent window.

function radialTexture(stops: [number, string][]) {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [at, colour] of stops) grad.addColorStop(at, colour)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// One live query, read every frame (a new matchMedia per call adds up).
const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
const reducedMotion = () => Boolean(motionQuery?.matches)

const _head = new THREE.Vector3()

export function Aura({ rig, vitality }: { rig: Rig; vitality: () => number }) {
  const halo = useRef<THREE.Sprite>(null)
  const haloMat = useRef<THREE.SpriteMaterial>(null)

  // Warm cream core fading through blush: on a dark desktop a single pale
  // tone reads as a grey disc, two warm tones read as light. Long, gentle falloff.
  const haloTex = useMemo(
    () =>
      radialTexture([
        [0, 'rgba(255, 240, 222, 0.7)'],
        [0.3, 'rgba(255, 222, 230, 0.36)'],
        [0.65, 'rgba(255, 210, 225, 0.1)'],
        [1, 'rgba(255, 210, 225, 0)']
      ]),
    []
  )

  const t = useRef(0)
  useFrame((_, dt) => {
    const v = THREE.MathUtils.clamp(vitality(), 0, 1)
    t.current += Math.min(dt, maxDt())
    const head = rig.head?.node
    if (!halo.current || !haloMat.current || !head) return
    head.getWorldPosition(_head)
    halo.current.parent?.worldToLocal(_head)
    halo.current.position.set(_head.x, _head.y + 0.08, _head.z - 0.25)
    const breathe = reducedMotion() ? 1 : 1 + 0.05 * Math.sin(t.current * 1.1)
    const s = 1.55 * breathe * (0.6 + 0.4 * v)
    halo.current.scale.set(s, s, 1)
    haloMat.current.opacity = 0.22 * v * v
    halo.current.visible = v > 0.02 && rig.plantMeshes[0]?.visible !== false
  })

  return (
    <sprite ref={halo} renderOrder={-1} raycast={() => null}>
      <spriteMaterial ref={haloMat} map={haloTex} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  )
}
