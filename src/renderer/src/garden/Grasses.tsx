import { useMemo } from 'react'
import * as THREE from 'three'
import { GRASSES, heightAt, mulberry } from './layout'
import { bladeMaterial, bladeStroke, normalAt } from './Lawn'

// Ornamental grass, like the two clumps by the inspo's pond: fountains of
// blades arching out from a tight crown, the lawn's own blades and wind at
// about one and a half times the height. They soften the bed edges and the pond's bank.

const BLADES = 150

export function Grasses() {
  const mesh = useMemo(() => {
    const geometry = bladeStroke()
    const hills = new Float32Array(GRASSES.length * BLADES * 3)
    geometry.setAttribute('aHill', new THREE.InstancedBufferAttribute(hills, 3))
    const mesh = new THREE.InstancedMesh(geometry, bladeMaterial(), GRASSES.length * BLADES)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const tilt = new THREE.Quaternion()
    const axis = new THREE.Vector3()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    GRASSES.forEach(([cx, cz, size], c) => {
      const rnd = mulberry(c * 59 + 3)
      for (let k = 0; k < BLADES; k++) {
        const n = c * BLADES + k
        const a = rnd() * Math.PI * 2
        const out = Math.sqrt(rnd())
        const x = cx + Math.cos(a) * out * 0.22 * size
        const z = cz + Math.sin(a) * out * 0.2 * size
        // Inner blades stand up, outer ones arch out and are shorter.
        // About half a flower's height (Simon: they were "hyper long"), not
        // towering over the beds.
        const h = (0.38 + rnd() * 0.24) * (1 - 0.35 * out) * size
        q.setFromAxisAngle(axis.set(0, 1, 0), rnd() * Math.PI * 2)
        tilt.setFromAxisAngle(axis.set(Math.sin(a), 0, -Math.cos(a)), (0.15 + out * 0.75) * (0.8 + rnd() * 0.4))
        m.compose(p.set(x, heightAt(x, z) - 0.02, z), tilt.multiply(q), s.set(0.03 + rnd() * 0.02, h, h))
        mesh.setMatrixAt(n, m)
        normalAt(x, z).toArray(hills, n * 3)
      }
    })
    mesh.frustumCulled = false
    // With the planted tufts: after the meadow, testing against the plants' depth.
    mesh.renderOrder = -7.9
    mesh.raycast = () => {}
    return mesh
  }, [])
  return <primitive object={mesh} />
}
