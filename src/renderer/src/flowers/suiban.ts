import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// The pot: a Japanese suiban, the shallow oval basin bonsai and water plants
// sit in. Turned on a lathe and squashed to an oval, with a rolled rim, a
// painted sage band of dashes under it, four small feet, dark mud on the floor
// and clear water filling it just below the lip, so a little lotus grows out
// of the water. The glaze (Garden swatches) tints the white body; the painting
// is vertex colour.
//
// Origin at the bottom centre (the contact shadow sits at y = 0). `floor` is
// where the plant stands, under the water.

export const SUIBAN = {
  /** Outer radius across (x). */
  radius: 0.78,
  /** Front-to-back squash: an oval, as these basins are. */
  oval: 0.62,
  feet: 0.05,
  height: 0.36,
  /** Plant base: the mud on the floor of the basin. */
  floor: 0.11,
  water: 0.29
}

// Outer profile from the foot up to the rolled rim, then the inner wall down
// to the floor: (radius, height). Lathe-turned, it gives both skins.
const PROFILE: [number, number][] = [
  [0.0, 0.05],
  [0.5, 0.05],
  [0.58, 0.06],
  [0.64, 0.1],
  [0.69, 0.17],
  [0.725, 0.24],
  [0.75, 0.3],
  [0.77, 0.33],
  [0.78, 0.35],
  [0.765, 0.362],
  [0.745, 0.355],
  [0.73, 0.33],
  [0.7, 0.25],
  [0.65, 0.16],
  [0.58, 0.11],
  [0.0, 0.1]
]
const RIM_INDEX = 9 // first point of the inner skin

/** The outside of the wall, foot to lip, as (radius across, height); the
 * depth radius is `oval` times it. For hiding plant parts that pass out
 * through the wall (watercolour.ts potCut). */
export const OUTER_WALL: [number, number][] = PROFILE.slice(1, RIM_INDEX).map(([r, y]) => [r * (SUIBAN.radius / 0.78), y])
export const LIP = Math.max(...PROFILE.map(([, y]) => y))

const SRGB = (hex: string) => new THREE.Color(hex)
const GLAZE = SRGB('#f6f6f0')
const INNER = SRGB('#eef1e9')
const BAND = SRGB('#c3cfbf')
const DASH = SRGB('#93a99a')
const LINE = SRGB('#9fb0a2')
const FOOT = SRGB('#e3e6dc')

function body(material: THREE.Material) {
  const segments = 192
  const geo = new THREE.LatheGeometry(
    PROFILE.map(([r, y]) => new THREE.Vector2(r * (SUIBAN.radius / 0.78), y)),
    segments
  )
  geo.scale(1, 1, SUIBAN.oval)
  // Paint: a wash of glaze, a sage band with dashes on the outside below the
  // rim, a fine line under the rim, a softer tone inside.
  const pos = geo.getAttribute('position')
  const colour = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  const rows = PROFILE.length
  for (let i = 0; i < pos.count; i++) {
    const row = i % rows
    const y = pos.getY(i)
    const angle = Math.atan2(pos.getZ(i) / SUIBAN.oval, pos.getX(i))
    if (row >= RIM_INDEX) c.copy(INNER)
    else if (y > 0.155 && y < 0.255) {
      const dash = Math.sin(angle * 26) > 0.35 && y > 0.18 && y < 0.23
      c.copy(dash ? DASH : BAND)
    } else if (y > 0.29 && y < 0.31) c.copy(LINE)
    else c.copy(GLAZE)
    colour.set([c.r, c.g, c.b], i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colour, 3))
  const mesh = new THREE.Mesh(geo, material)
  mesh.name = 'pot-body'
  return mesh
}

function feet(material: THREE.Material) {
  const group = new THREE.Group()
  const geo = new RoundedBoxGeometry(0.2, SUIBAN.feet + 0.02, 0.12, 2, 0.025)
  // Same glaze, a touch darker, via vertex colour.
  const n = geo.getAttribute('position').count
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => FOOT.toArray()[i % 3]), 3))
  for (const [x, z] of [
    [-0.42, -0.25],
    [0.42, -0.25],
    [-0.42, 0.25],
    [0.42, 0.25]
  ]) {
    const foot = new THREE.Mesh(geo, material)
    foot.position.set(x * (SUIBAN.radius / 0.78), (SUIBAN.feet + 0.02) / 2, z)
    foot.rotation.y = Math.atan2(z, x) + Math.PI / 2
    group.add(foot)
  }
  return group
}

export function buildSuiban(potMaterial: THREE.MeshStandardMaterial, soilMaterial: THREE.Material) {
  potMaterial.vertexColors = true
  const pot = new THREE.Group()
  pot.name = 'pot'
  pot.add(body(potMaterial), feet(potMaterial))

  // Mud on the floor, seen through the water.
  const r = SUIBAN.radius / 0.78
  const mud = new THREE.Mesh(new THREE.CircleGeometry(0.6 * r, 64), soilMaterial)
  mud.rotation.x = -Math.PI / 2
  mud.scale.set(1, SUIBAN.oval, 1)
  mud.position.y = SUIBAN.floor + 0.002
  mud.name = 'soil'

  // Clear water just below the lip. It doesn't write depth, so the stems
  // below show through it, tinted, and the ink pass ignores its surface.
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.712 * r, 96),
    new THREE.MeshStandardMaterial({
      name: 'water',
      // Blue enough to read as water at the window's size (Simon).
      color: '#7fbbe6',
      roughness: 0.12,
      metalness: 0,
      transparent: true,
      opacity: 0.46,
      depthWrite: false
    })
  )
  water.rotation.x = -Math.PI / 2
  water.scale.set(1, SUIBAN.oval, 1)
  water.position.y = SUIBAN.water
  water.name = 'water'
  water.renderOrder = 2
  pot.add(mud, water)
  return pot
}
