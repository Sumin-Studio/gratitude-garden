import type { RootState } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { PotId } from '../../../shared/diary'
import { POT_COLORS } from './pots'
import type { useFlower } from './models'

// The flower's photo studio, the same wherever it stands: camera, light and
// exposure (the pad and the capture studio).

// zoom: the flower 30% bigger in its square, the controls round it as
// they were (Simon). Framed on the same point, so it grows about the
// middle of the plant.
export const CAMERA = { position: [0, 2.2, 7.0], fov: 27, near: 0.1, far: 50, zoom: 1.3 } as const

export function setupStudio({ gl, camera, scene }: Pick<RootState, 'gl' | 'camera' | 'scene'>) {
  gl.setClearColor(0x000000, 0)
  gl.toneMapping = THREE.NeutralToneMapping
  gl.toneMappingExposure = 1.12
  // Soft studio light from every side, so petals read white and
  // greens read fresh instead of falling into shadow.
  const pmrem = new THREE.PMREMGenerator(gl)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.85
  pmrem.dispose()
  // Framed on the basin and the bloom above it.
  camera.lookAt(0, 0.92, 0)
}

export function StudioLights() {
  return (
    <>
      {/* Soft and low-contrast: lots of wrap-around fill, a gentle warm key,
          a pink-gold rim from behind for the dreamy edge light. */}
      <hemisphereLight args={['#fffaf4', '#e6dce0', 1.2]} />
      <directionalLight position={[-2.5, 4.5, 3.5]} intensity={1.05} color="#fff3e4" />
      {/* Rim from behind: keeps the silhouette readable over dark windows. */}
      <directionalLight position={[2.2, 3, -4]} intensity={1.2} color="#ffd9e8" />
    </>
  )
}

/** The pot's glaze. Only the placeholder pot is recoloured; a pot in Simon's
 * own model keeps its own look. */
export function usePotGlaze(flower: ReturnType<typeof useFlower>, pot: PotId) {
  useEffect(() => {
    if (flower?.source !== 'placeholder' && !flower?.rig.root.userData.appPot) return
    flower.rig.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (m?.name === 'pot') m.color.set(POT_COLORS[pot])
    })
  }, [flower, pot])
}
