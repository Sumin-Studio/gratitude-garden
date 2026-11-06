import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Rig } from './rig'

// Baked radial shadows. drei's ContactShadows renders nothing on a
// transparent canvas here, and blobs read better anyway: they ground the pot
// on whatever window happens to be behind it.
//
// Three layers: a wide soft pool under the pot, a tight dark contact core
// right at its base (the part that still reads over dark wallpaper), and a
// shadow under the head that strengthens as the head droops towards the
// ground.

function radialTexture(stops: [number, number][]) {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [at, alpha] of stops) grad.addColorStop(at, `rgba(30, 26, 22, ${alpha})`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const noRaycast = () => null
const _head = new THREE.Vector3()
const _local = new THREE.Vector3()

export function GroundShadow({ width, rig }: { width: number; rig: Rig | null }) {
  const pool = useMemo(
    () =>
      radialTexture([
        [0, 0.22],
        [0.45, 0.12],
        [1, 0]
      ]),
    []
  )
  const core = useMemo(
    () =>
      radialTexture([
        [0, 0.4],
        [0.55, 0.28],
        [0.8, 0.09],
        [1, 0]
      ]),
    []
  )
  const headMesh = useRef<THREE.Mesh>(null)
  const headMat = useRef<THREE.MeshBasicMaterial>(null)

  useFrame(() => {
    const m = headMesh.current
    const mat = headMat.current
    const head = rig?.head?.node
    if (!m || !mat) return
    // No head shadow for an empty pot.
    if (!head || rig?.plantMeshes[0]?.visible === false) {
      m.visible = false
      return
    }
    head.getWorldPosition(_head)
    // Our parent may be offset; place the blob under the head in its frame.
    _local.copy(_head)
    m.parent?.worldToLocal(_local)
    m.position.set(_local.x, 0.003, _local.z)
    // Closer to the ground: darker and tighter. Upright (~2.4) barely shows.
    const near = THREE.MathUtils.clamp(1 - (_head.y - 0.6) / 1.9, 0, 1)
    mat.opacity = 0.05 + 0.32 * near * near
    const s = THREE.MathUtils.lerp(1.1, 0.7, near)
    m.scale.set(s, s * 0.7, 1)
    m.visible = true
  })

  return (
    <group>
      {/* The pool fades out inside the window (about 2.5 units across at the
          pot): any wider and the transparent window cuts its edge off flat. */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.001} scale={[width * 1.45, width * 1.05, 1]} raycast={noRaycast}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={pool} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.002} scale={[width * 1.18, width * 0.78, 1]} raycast={noRaycast}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={core} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={headMesh} rotation-x={-Math.PI / 2} raycast={noRaycast}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={headMat} map={pool} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
