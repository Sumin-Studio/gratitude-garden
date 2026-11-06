import { useEffect, useState } from 'react'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { FlowerId } from '../../../shared/diary'
import { bridge } from '../store'
import { buildDaisy } from './daisy'
import { buildNemophila } from './nemophila'
import { buildPlaceholder } from './placeholder'
import { makeWatercolour, markParts } from './watercolour'
import { bindRig, measureGrowth, setStemLength, type Rig } from './rig'
import { FLOWER_SPECS } from './specs'

// Resolves the model for a flower type: Simon's GLB if one exists
// (userData/flowers or resources/flowers), otherwise the grey-block
// placeholder. Each model is bound to a rig once, at rest, and cached.

export type LoadedFlower = { id: FlowerId; rig: Rig; source: 'glb' | 'placeholder' }

const cache = new Map<FlowerId, Promise<LoadedFlower>>()

// Compressed GLBs (Draco, meshopt) are common from web export tools.
let loader: GLTFLoader | null = null
function gltfLoader() {
  if (!loader) {
    const draco = new DRACOLoader().setDecoderPath('./draco/')
    loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)
  }
  return loader
}

/** Types built in code, not loaded from a GLB (a dropped-in file still wins). */
const BUILT: Partial<Record<FlowerId, () => THREE.Object3D>> = { daisy: buildDaisy, nemophila: buildNemophila }

async function load(id: FlowerId): Promise<LoadedFlower> {
  let bytes = await bridge.getModel(id).catch(() => null)
  // A type built in code takes a dropped-in file only if it's a real GLB (a
  // dev server answers a missing file with its index page).
  if (bytes && BUILT[id] && new TextDecoder().decode(new Uint8Array(bytes as ArrayBuffer, 0, 4)) !== 'glTF') bytes = null
  let problem: string | undefined
  if (bytes || BUILT[id]) {
    try {
      const scene = bytes ? (await gltfLoader().parseAsync(bytes, '')).scene : BUILT[id]!()
      fixMaterials(scene, id)
      const rig = bindRig(potted(scene, id))
      setStemLength(rig, FLOWER_SPECS[id].stemLength ?? 1, FLOWER_SPECS[id].budLength ?? 1)
      measureGrowth(rig)
      if (rig.stems.length || rig.morphs.length) {
        bridge.reportModel(id, 'glb')
        return { id, rig, source: 'glb' }
      }
      problem = 'no stem_N nodes or wilt morph target'
    } catch (e) {
      problem = `could not be read (${(e as Error).message})`
    }
    console.warn(`${id}.glb ${problem}; using the placeholder`)
  }
  bridge.reportModel(id, 'placeholder', problem)
  return { id, rig: bindRig(buildPlaceholder(FLOWER_SPECS[id])), source: 'placeholder' }
}

/**
 * Generated models (Meshy) often come out fully metallic. Lit without
 * reflections, metal renders dark and muddy, so a pink-white lotus turns
 * brown. Flowers aren't metal, and they're matte: keep the colour and
 * normal maps, drop the rest.
 */
function fixMaterials(scene: THREE.Object3D, id: FlowerId) {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) markParts(mesh as THREE.SkinnedMesh, { textureBranches: FLOWER_SPECS[id].textureBranches })
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial
      if (!std.isMeshStandardMaterial) continue
      std.metalness = 0
      std.metalnessMap = null
      // Petals and pads are matte; the generated roughness map leaves glossy
      // streaks that read as white veins under the soft environment light.
      std.roughnessMap = null
      std.roughness = 0.78
      // The plant hides where it passes out through the pot's wall.
      makeWatercolour(std, {
        potCut: Boolean(FLOWER_SPECS[id].pot),
        palette: FLOWER_SPECS[id].palette,
        // An untextured model's colours are baked into its vertices (autorig --paint).
        vertexPaint: !std.map && Boolean(mesh.geometry.getAttribute('color'))
      })
    }
  })
}

/** Height of the plant above the soil, matching the placeholders, so every
 * model fits the window and the bend numbers in specs.ts mean the same. */
const PLANT_HEIGHT = 2.0

/**
 * A model without a `pot` node is a flower on its own (the usual Meshy →
 * Blender export): plant it in the app's pot, at a normalised size, base on
 * the soil. A model with its own pot is used exactly as exported.
 */
function potted(scene: THREE.Object3D, id: FlowerId): THREE.Object3D {
  if (scene.getObjectByName('pot') || scene.getObjectByProperty('name', 'Pot')) return scene
  const spec = FLOWER_SPECS[id]
  const pot = spec.pot ? buildPlaceholder(spec).getObjectByName('pot')! : new THREE.Group()
  // The basin takes the same watercolour wash as the plant (not the water).
  const washed = new Set<THREE.Material>()
  pot.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (m?.isMeshStandardMaterial && !m.transparent && !washed.has(m)) {
      washed.add(m)
      makeWatercolour(m)
    }
  })
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const s = (spec.height ?? PLANT_HEIGHT) / Math.max(size.y, 1e-6)
  // `plant` is a pivot at the soil, so growth scales the flower up out of
  // the soil rather than toward the world origin. `inner` sizes and centres
  // the model on that pivot.
  const inner = new THREE.Group()
  inner.add(scene)
  inner.scale.setScalar(s)
  // Centred on the box, or (a plant that leans) on where it leaves the soil.
  const base = spec.rootAtBase ? baseOf(scene, box) : new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2)
  inner.position.set(-base.x * s, -base.y * s, -base.z * s)
  const plant = new THREE.Group()
  plant.name = 'plant'
  plant.position.set(0, spec.pot ? spec.pot.height - 0.02 : 0, 0)
  plant.add(inner)
  const root = new THREE.Group()
  root.name = 'flower'
  root.add(pot, plant)
  root.scale.setScalar(spec.scale)
  // A skinned mesh remembers where it was bound. Moving it into the pot
  // without re-binding would apply the pot offset and scale twice.
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (m.isSkinnedMesh) {
      m.skeleton.calculateInverses()
      m.bind(m.skeleton, m.matrixWorld)
      // Its culling sphere is computed once, from whatever pose it had then;
      // growth and wilting move it far outside that. It's one small model.
      m.frustumCulled = false
    }
  })
  // The app's pot takes the Garden glazes, like the placeholder's. A potless
  // plant stands on the ground (findSoil).
  root.userData.appPot = Boolean(spec.pot)
  root.userData.ground = !spec.pot
  return root
}

/** The middle of the model's lowest slice: where a leaning plant's stems
 * leave the soil. */
function baseOf(scene: THREE.Object3D, box: THREE.Box3) {
  const cut = box.min.y + 0.03 * (box.max.y - box.min.y)
  const sum = new THREE.Vector3()
  let n = 0
  const v = new THREE.Vector3()
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    const pos = mesh.isMesh ? mesh.geometry.getAttribute('position') : null
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      if (v.y < cut) {
        sum.add(v)
        n++
      }
    }
  })
  return n ? new THREE.Vector3(sum.x / n, box.min.y, sum.z / n) : new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2)
}

export function loadFlower(id: FlowerId) {
  let p = cache.get(id)
  if (!p) {
    p = load(id).then((f) => {
      console.info(`flower ${id}: ${f.source}`)
      return f
    })
    cache.set(id, p)
  }
  return p
}

/** The flower for `id`. While a new type loads, the previous one stays on
 * screen; null only before the very first load. */
export function useFlower(id: FlowerId) {
  const [flower, setFlower] = useState<LoadedFlower | null>(null)
  useEffect(() => {
    let alive = true
    loadFlower(id).then((f) => alive && setFlower(f))
    return () => {
      alive = false
    }
  }, [id])
  return flower
}

/** Placeholder → binary GLB, as a worked example of the rig contract. */
export async function exportPlaceholder(id: FlowerId): Promise<ArrayBuffer> {
  const root = buildPlaceholder(FLOWER_SPECS[id])
  const out = await new GLTFExporter().parseAsync(root, { binary: true })
  return out as ArrayBuffer
}
