import * as THREE from 'three'
import type { Rig } from './rig'

// When a flower has been fully wilted for a moment, one petal lets go,
// tumbles down and lies next to the pot (or on the soil). After a drink it
// soaks away and the petal grows back on the head.

const HOLD = 1.4 // seconds fully wilted before it drops
const GRAVITY = 7
const _spin = new THREE.Quaternion()
const _euler = new THREE.Euler()

type Falling = {
  obj: THREE.Object3D
  vel: THREE.Vector3
  spin: THREE.Vector3
  landed: number // seconds since landing, -1 while in the air
  floor: number
  rest: THREE.Quaternion
  fade: number // -1 = staying, else seconds into soaking away
}

export class PetalDrop {
  private wilted = 0
  private falling: Falling | null = null
  private regrow = 1
  private regrowV = 0
  private readonly petal: Rig['petals'][number] | undefined

  constructor(
    rig: Rig,
    private readonly parent: THREE.Object3D,
    private readonly pot: { top: number; half: number }
  ) {
    // An outer petal: the last one the placeholder built, usually the widest ring.
    this.petal = rig.petals[rig.petals.length - 1]
  }

  /** Falling, settling, soaking away or growing back: motion that wants every frame. */
  get busy() {
    const f = this.falling
    return Boolean(f && (f.landed < 0.6 || f.fade >= 0)) || this.regrow !== 1 || this.regrowV !== 0
  }

  /** Call after poseRig each frame. `target` is the wilt the springs chase. */
  update(dt: number, target: number, petals: number, calm: boolean) {
    const p = this.petal
    if (!p) return

    // Drop once it has hung there fully wilted for a moment.
    if (!this.falling && target > 0.99 && petals > 0.97) {
      this.wilted += dt
      // It lets go now and starts falling next frame, which runs at full
      // rate (pace.ts): this one may be a long resting tick.
      if (this.wilted > HOLD && !calm) return this.drop()
    } else if (target < 0.99) this.wilted = 0

    const f = this.falling
    if (f) {
      if (f.landed < 0) {
        f.vel.y -= GRAVITY * dt
        f.obj.position.addScaledVector(f.vel, dt)
        f.obj.quaternion.multiply(_spin.setFromEuler(_euler.set(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt)))
        f.floor = this.floorAt(f.obj.position)
        if (f.obj.position.y <= f.floor) {
          f.obj.position.y = f.floor
          f.landed = 0
        }
      } else {
        // Settle flat on the ground.
        f.landed += dt
        f.obj.quaternion.slerp(f.rest, 1 - Math.exp(-dt * 14))
      }
      // A drink: the fallen petal soaks away, the head grows a new one.
      if (target < 0.5 && f.fade < 0) {
        f.fade = 0
        p.node.visible = true
        this.regrow = 0.35
        this.regrowV = 0
      }
      if (f.fade >= 0) {
        f.fade += dt
        const k = Math.min(1, f.fade / 0.35)
        f.obj.scale.copy(f.obj.userData.scale).multiplyScalar(1 - k * k)
        if (k >= 1) {
          this.parent.remove(f.obj)
          this.falling = null
        }
      }
    }

    // Regrow with a soft spring.
    if (this.regrow !== 1 || this.regrowV !== 0) {
      this.regrowV += (-90 * (this.regrow - 1) - 12 * this.regrowV) * dt
      this.regrow += this.regrowV * dt
      if (Math.abs(this.regrow - 1) < 0.002 && Math.abs(this.regrowV) < 0.01) {
        this.regrow = 1
        this.regrowV = 0
      }
      p.node.scale.multiplyScalar(Math.max(0.01, this.regrow))
    }
  }

  dispose() {
    if (this.falling) this.parent.remove(this.falling.obj)
    if (this.petal) this.petal.node.visible = true
    this.falling = null
  }

  private drop() {
    const p = this.petal!
    p.node.updateWorldMatrix(true, true)
    const obj = p.node.clone(true)
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    p.node.matrixWorld.decompose(pos, quat, scale)
    this.parent.updateWorldMatrix(true, false)
    this.parent.worldToLocal(pos)
    obj.position.copy(pos)
    obj.quaternion.copy(quat)
    obj.scale.copy(scale)
    obj.userData.scale = scale.clone()
    this.parent.add(obj)
    p.node.visible = false

    // Lie flat: the petal's face (local Z) up, random yaw.
    const rest = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2))
    const away = new THREE.Vector3(pos.x, 0, pos.z).normalize().multiplyScalar(0.25)
    this.falling = {
      obj,
      vel: new THREE.Vector3(away.x, 0.3, away.z + 0.15),
      spin: new THREE.Vector3(2.2, 1.4, 3.1).multiplyScalar(Math.random() < 0.5 ? -1 : 1),
      landed: -1,
      floor: 0,
      rest,
      fade: -1
    }
  }

  private floorAt(p: THREE.Vector3) {
    const onPot = Math.abs(p.x) < this.pot.half && Math.abs(p.z) < this.pot.half
    return (onPot ? this.pot.top : 0) + 0.028
  }
}
