import RAPIER from '@dimforge/rapier3d-compat'
import { WaterSim } from './water'
import { Particles } from './particles'
import { buildCliffFace, buildStacks, buildTerrain, edgeX, heightAt, type MeshData, type TerrainData } from './terrain'
import {
  OBJECT_MAP, boundingRadius, frontalArea, volumeOf, volumeSamples,
  type ObjectDef, type VolumeSample,
} from './objects'

export const DT = 1 / 120
const G = 9.81
const RHO_W = 1000
const RHO_AIR = 1.225
const MAX_BODIES = 70

export interface Body {
  id: number
  def: ObjectDef
  scale: number
  rb: RAPIER.RigidBody
  samples: VolumeSample[]
  prevSub: Float32Array
  volume: number
  mass: number
  reqRadius: number // radius of the equal-volume sphere
  airK: number // ρa·Cd·A / 2m
  wet: boolean
  submerged: number // 0..1
  bornAt: number
}

export interface ImpactInfo {
  splashId: number
  label: string
  emoji: string
  speed: number
  energy: number
  mass: number
  peak: number
  at: number
}

export interface LaunchSolution {
  origin: [number, number, number]
  velocity: [number, number, number]
  points: number[]
  reachable: boolean
}

interface Scheduled { t: number; fn: () => void }

export class Engine {
  world: RAPIER.World
  water = new WaterSim()
  particles = new Particles()
  terrain: TerrainData
  rockMeshes: MeshData[]
  bodies: Body[] = []
  timeScale = 1
  /** camera shake budget, decays in the renderer */
  shake = 0
  lastThrown: Body | null = null
  paused = false
  simTime = 0
  private acc = 0
  private nextId = 1
  private nextSplash = 1
  private queue: Scheduled[] = []
  private tmpQ = { x: 0, y: 0, z: 0, w: 1 }

  onAdd?: (b: Body) => void
  onRemove?: (b: Body) => void
  onImpact?: (i: ImpactInfo) => void
  onSplashSound?: (energy: number, radius: number, speed: number) => void

  static async create() {
    await RAPIER.init()
    return new Engine()
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -G, z: 0 })
    this.world.timestep = DT
    this.terrain = buildTerrain()
    this.rockMeshes = [buildCliffFace(), ...buildStacks()]
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    for (const m of [this.terrain, ...this.rockMeshes]) {
      this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(m.positions, m.indices).setFriction(0.9).setRestitution(0.1),
        ground,
      )
    }
  }

  // ───────────────────────────── launching ─────────────────────────────

  launchOrigin(tz: number, def: ObjectDef, scale: number): [number, number, number] {
    const z = Math.max(-34, Math.min(34, tz * 0.55))
    const x = edgeX(z) - 0.9
    const y = heightAt(x, z) + 1.4 + boundingRadius(def, scale)
    return [x, y, z]
  }

  /**
   * Solve the launch speed (fixed elevation angle) that lands the body at the
   * target *including quadratic air drag*, by shooting + bisection on the
   * exact same integrator Rapier uses (symplectic Euler at DT).
   */
  solveLaunch(defId: string, tx: number, tz: number, angleDeg: number, scale: number): LaunchSolution | null {
    const def = OBJECT_MAP[defId]
    const origin = this.launchOrigin(tz, def, scale)
    const dx = tx - origin[0], dz = tz - origin[2]
    const d = Math.hypot(dx, dz)
    if (d < 2 || tx < edgeX(tz) + 1) return null
    const ux = dx / d, uz = dz / d
    const th = (angleDeg * Math.PI) / 180
    const k = this.airK(def, scale)
    const targetY = 0
    const range = (speed: number, record?: number[]) => {
      let h = 0, y = origin[1]
      let vh = speed * Math.cos(th), vy = speed * Math.sin(th)
      for (let i = 0; i < 4000; i++) {
        const sp = Math.hypot(vh, vy)
        vh -= k * sp * vh * DT
        vy -= k * sp * vy * DT
        vy -= G * DT
        h += vh * DT
        y += vy * DT
        if (record && i % 3 === 0) record.push(origin[0] + ux * h, y, origin[2] + uz * h)
        if (y <= targetY && vy < 0) {
          if (record) record.push(origin[0] + ux * h, y, origin[2] + uz * h)
          return h
        }
      }
      return h
    }
    let lo = 0.5, hi = 140
    const reachable = range(hi) >= d
    if (reachable) {
      for (let it = 0; it < 40; it++) {
        const mid = 0.5 * (lo + hi)
        if (range(mid) < d) lo = mid
        else hi = mid
      }
    }
    const speed = reachable ? 0.5 * (lo + hi) : hi
    const points: number[] = [...origin]
    range(speed, points)
    return {
      origin,
      velocity: [ux * speed * Math.cos(th), speed * Math.sin(th), uz * speed * Math.cos(th)],
      points,
      reachable,
    }
  }

  private airK(def: ObjectDef, scale: number) {
    const m = def.density * volumeOf(def, scale)
    return (0.5 * RHO_AIR * def.dragCd * frontalArea(def, scale)) / m
  }

  throwAt(defId: string, tx: number, tz: number, angleDeg: number, scale: number, spin: number) {
    const sol = this.solveLaunch(defId, tx, tz, angleDeg, scale)
    if (!sol) return null
    this.lastThrown = this.spawn(defId, sol.origin, sol.velocity, scale, spin)
    return sol
  }

  spawn(defId: string, pos: number[], vel: number[], scale: number, spin: number) {
    const def = OBJECT_MAP[defId]
    const s = scale
    const d = def.dims.map((x) => x * s)
    // random initial orientation
    const u1 = Math.random(), u2 = Math.random(), u3 = Math.random()
    const q = {
      x: Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
      y: Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
      z: Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
      w: Math.sqrt(u1) * Math.cos(2 * Math.PI * u3),
    }
    const rand = () => (Math.random() * 2 - 1) * spin
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos[0], pos[1], pos[2])
      .setRotation(q)
      .setLinvel(vel[0], vel[1], vel[2])
      .setAngvel({ x: rand(), y: rand(), z: rand() })
      .setCcdEnabled(true)
      .setCanSleep(false)
    const rb = this.world.createRigidBody(rbDesc)
    let cd: RAPIER.ColliderDesc
    if (def.shape === 'ball') cd = RAPIER.ColliderDesc.ball(d[0])
    else if (def.shape === 'box') cd = RAPIER.ColliderDesc.cuboid(d[0], d[1], d[2])
    else cd = RAPIER.ColliderDesc.cylinder(d[0], d[1])
    cd.setDensity(def.density).setRestitution(def.restitution).setFriction(def.friction)
    this.world.createCollider(cd, rb)
    const samples = volumeSamples(def, s)
    const volume = volumeOf(def, s)
    const body: Body = {
      id: this.nextId++, def, scale: s, rb, samples,
      prevSub: new Float32Array(samples.length),
      volume, mass: rb.mass(),
      reqRadius: Math.cbrt((3 * volume) / (4 * Math.PI)),
      airK: this.airK(def, s),
      wet: false, submerged: 0, bornAt: this.simTime,
    }
    this.bodies.push(body)
    this.onAdd?.(body)
    while (this.bodies.length > MAX_BODIES) this.removeBody(this.bodies[0])
    return body
  }

  removeBody(b: Body) {
    const i = this.bodies.indexOf(b)
    if (i >= 0) this.bodies.splice(i, 1)
    this.world.removeRigidBody(b.rb)
    this.onRemove?.(b)
  }

  clear() {
    for (const b of [...this.bodies]) this.removeBody(b)
    this.particles.clear()
    this.water.reset()
    this.shake = 0
    this.queue = []
  }

  schedule(delay: number, fn: () => void) {
    this.queue.push({ t: this.simTime + delay, fn })
  }

  // ───────────────────────────── simulation ─────────────────────────────

  update(frameDt: number) {
    if (this.paused) return 0
    this.acc += Math.min(frameDt, 0.1) * this.timeScale
    let n = 0
    while (this.acc >= DT && n < 12) {
      this.substep()
      this.acc -= DT
      n++
    }
    if (n === 12) this.acc = 0
    return n
  }

  private substep() {
    const water = this.water
    for (const b of this.bodies) this.applyFluidForces(b)
    this.world.step()
    water.step(DT)
    this.particles.step(DT, water)
    this.simTime += DT
    if (this.queue.length) {
      const due = this.queue.filter((q) => q.t <= this.simTime)
      if (due.length) {
        this.queue = this.queue.filter((q) => q.t > this.simTime)
        for (const q of due) q.fn()
      }
    }
    for (const b of [...this.bodies]) {
      const p = b.rb.translation()
      if (p.y < -40 || Math.abs(p.x) > 300 || Math.abs(p.z) > 300) this.removeBody(b)
    }
  }

  private applyFluidForces(b: Body) {
    const rb = b.rb
    const t = rb.translation()
    const r = rb.rotation()
    const lv = rb.linvel()
    const av = rb.angvel()
    const water = this.water
    const qx = r.x, qy = r.y, qz = r.z, qw = r.w
    let sub = 0
    let jx = 0, jy = 0, jz = 0 // accumulated for center-applied pieces
    let lowest = Infinity, lowX = t.x, lowZ = t.z, lowWs = 0
    for (let i = 0; i < b.samples.length; i++) {
      const s = b.samples[i]
      // rotate local → world: v' = v + w·t + q×t,  t = 2(q×v)
      const tx = 2 * (qy * s.z - qz * s.y)
      const ty = 2 * (qz * s.x - qx * s.z)
      const tz = 2 * (qx * s.y - qy * s.x)
      const rx = s.x + qw * tx + (qy * tz - qz * ty)
      const ry = s.y + qw * ty + (qz * tx - qx * tz)
      const rz = s.z + qw * tz + (qx * ty - qy * tx)
      const px = t.x + rx, py = t.y + ry, pz = t.z + rz
      const inside = water.inside(px, pz)
      const ws = water.heightAt(px, pz)
      if (py < lowest) { lowest = py; lowX = px; lowZ = pz; lowWs = ws }
      let f = (ws - (py - s.half)) / (2 * s.half)
      f = f < 0 ? 0 : f > 1 ? 1 : f
      const vsub = s.vol * f
      // volume displacement → water surface (this is what makes the crater & rings)
      const dV = vsub - b.prevSub[i]
      b.prevSub[i] = vsub
      if (inside && Math.abs(dV) > 1e-7) water.addVolume(px, pz, -dV, s.half * 2)
      if (f <= 0) continue
      sub += vsub
      // point velocity v + ω × r, relative to the water column
      const wv = water.velAt(px, pz)
      const ux = lv.x + (av.y * rz - av.z * ry)
      const uy = lv.y + (av.z * rx - av.x * rz) - wv
      const uz = lv.z + (av.x * ry - av.y * rx)
      const us = Math.sqrt(ux * ux + uy * uy + uz * uz)
      // Archimedes
      let Jx = 0, Jy = RHO_W * G * vsub * DT, Jz = 0
      // quadratic pressure drag + linear (wave-radiation / viscous) damping
      if (us > 1e-5) {
        const fd = (0.5 * RHO_W * b.def.dragCd * s.area * us + 380 * s.area) * f * DT
        // never let drag reverse the local relative motion in one step (implicit limit)
        const mShare = b.mass * (s.vol / b.volume) + RHO_W * vsub * 0.5 // + added mass
        const lim = Math.min(fd, mShare * 0.95)
        Jx -= ux * lim; Jy -= uy * lim; Jz -= uz * lim
      }
      rb.applyImpulseAtPoint({ x: Jx, y: Jy, z: Jz }, { x: px, y: py, z: pz }, true)
    }
    b.submerged = sub / b.volume
    // air drag on the dry fraction
    const sp = Math.hypot(lv.x, lv.y, lv.z)
    const dry = 1 - b.submerged
    if (dry > 0 && sp > 0.01) {
      const k = b.airK * b.mass * sp * dry * DT
      jx -= k * lv.x; jy -= k * lv.y; jz -= k * lv.z
      rb.applyImpulse({ x: jx, y: jy, z: jz }, true)
    }
    // rotational viscous damping in water
    if (b.submerged > 0) {
      const dmp = 1 / (1 + 2.2 * b.submerged * DT)
      rb.setAngvel({ x: av.x * dmp, y: av.y * dmp, z: av.z * dmp }, true)
    }
    // splash detection: first contact while moving down
    if (!b.wet && b.submerged > 0.004 && lv.y < -2.2) {
      this.emitSplash(b, lowX, lowZ, lowWs, lv)
      b.wet = true
    } else if (b.submerged > 0.004) {
      b.wet = true
    } else if (b.submerged === 0 && lowest > lowWs + 0.15) {
      // fully airborne again (bounced) → can splash again
      if (b.wet && lv.y > 2.5) this.emitExitSpray(b, t.x, t.z, lowWs, lv)
      b.wet = false
    }
  }

  // ───────────────────────────── splashes ─────────────────────────────

  private emitSplash(b: Body, x: number, z: number, ws: number, v: RAPIER.Vector) {
    const speed = Math.hypot(v.x, v.y, v.z)
    const vy = -v.y
    const R = b.reqRadius
    const energy = 0.5 * b.mass * speed * speed
    const id = this.nextSplash++
    const P = this.particles
    P.peaks.set(id, ws)
    // heavier-than-water bodies punch deep cavities; light ones mostly skim
    const dens = Math.min(1.25, Math.max(0.22, Math.sqrt(b.def.density / 1000)))
    const steep = Math.min(1, vy / Math.max(speed, 1e-3) + 0.15)
    const crownN = Math.floor(Math.min(2600, 30 + 300 * R * Math.sqrt(vy) * dens * (0.6 + R)))
    const hx = v.x * 0.35, hz = v.z * 0.35
    const dropSize = 0.028 + 0.04 * Math.min(1.6, R + 0.3)
    // crown: emitted as a short curtain (≈0.1 s) — early fluid is fastest and thrown widest,
    // later fluid rises slower from a wider rim → reads as a sheet, not a burst
    const batches = 6
    for (let bi = 0; bi < batches; bi++) {
      const f = bi / (batches - 1)
      const n = Math.floor((crownN * 1.4) / batches)
      const emit = () => {
        const wsn = this.water.heightAt(x, z)
        for (let i = 0; i < n; i++) {
          const phi = Math.random() * Math.PI * 2
          const rr = R * (0.9 + 0.45 * f + 0.15 * Math.random())
          const sp = 1 - 0.45 * f
          const out = vy * (0.12 + 0.22 * Math.random() ** 1.5) * (0.6 + 0.4 * dens) * sp
          const up = vy * (0.16 + 0.34 * Math.random()) * dens * steep * sp
          const rad = 0.002 + 0.008 * Math.random() * Math.min(1.5, R + 0.3)
          P.spawn(
            x + Math.cos(phi) * rr, wsn + 0.04, z + Math.sin(phi) * rr,
            Math.cos(phi) * out + hx * Math.random(), up, Math.sin(phi) * out + hz * Math.random(),
            rad, dropSize * (0.5 + Math.random() * 0.8), 6, false, id,
          )
        }
      }
      if (bi === 0) emit()
      else this.schedule(f * 0.1, emit)
    }
    // mist
    const mistN = Math.floor(crownN * 0.12)
    for (let i = 0; i < mistN; i++) {
      const phi = Math.random() * Math.PI * 2
      const out = vy * 0.25 * Math.random()
      P.spawn(
        x + Math.cos(phi) * R, ws + 0.1, z + Math.sin(phi) * R,
        Math.cos(phi) * out, vy * 0.35 * Math.random() * dens, Math.sin(phi) * out,
        0.0005, 0.35 + R * 0.8 * Math.random(), 1.0 + Math.random() * 1.5, true, -1,
      )
    }
    this.water.addFoam(x, z, 1.1, R * 2.6 + 0.4)
    // Worthington jet when the air cavity collapses (deep-penetrating bodies)
    if (dens > 0.6 && vy > 3) {
      const delay = 0.12 + 0.22 * Math.sqrt(R) + 0.004 * vy
      const jetN = Math.floor(crownN * 0.5)
      const jetV = Math.sqrt(vy) * Math.sqrt(R + 0.15) * 2.5 * Math.min(1.2, dens)
      this.schedule(delay, () => {
        const wsn = this.water.heightAt(x, z)
        for (let i = 0; i < jetN; i++) {
          const a = Math.random() * Math.PI * 2
          const rr = R * 0.35 * Math.random()
          const spread = 0.6 + 0.6 * R
          const k = Math.random()
          P.spawn(
            x + Math.cos(a) * rr, wsn, z + Math.sin(a) * rr,
            Math.cos(a) * spread * Math.random(), jetV * (0.45 + 0.6 * k), Math.sin(a) * spread * Math.random(),
            0.004 + 0.014 * Math.random(), dropSize * (0.7 + Math.random()), 6, false, id,
          )
        }
        // collapse pushes water up at the center
        this.water.addVolume(x, z, 0.25 * b.volume, R)
        this.water.addFoam(x, z, 0.6, R * 1.5 + 0.3)
      })
    }
    this.shake = Math.min(1.2, this.shake + Math.log10(1 + energy) / 7)
    this.onSplashSound?.(energy, R, vy)
    const info: ImpactInfo = {
      splashId: id, label: b.def.label, emoji: b.def.emoji, speed, energy, mass: b.mass, peak: 0, at: this.simTime,
    }
    this.onImpact?.(info)
  }

  private emitExitSpray(b: Body, x: number, z: number, ws: number, v: RAPIER.Vector) {
    const n = Math.floor(Math.min(400, 40 * b.reqRadius * v.y))
    for (let i = 0; i < n; i++) {
      const phi = Math.random() * Math.PI * 2
      const rr = b.reqRadius * Math.random()
      this.particles.spawn(
        x + Math.cos(phi) * rr, ws + 0.05, z + Math.sin(phi) * rr,
        v.x * 0.5 + Math.cos(phi) * 1.2 * Math.random(), v.y * (0.4 + 0.5 * Math.random()), v.z * 0.5 + Math.sin(phi) * 1.2 * Math.random(),
        0.003 + 0.006 * Math.random(), 0.06, 4, false, -1,
      )
    }
  }

  splashPeak(id: number) {
    return this.particles.peaks.get(id) ?? 0
  }

  /** world-space pose helper for renderers */
  pose(b: Body) {
    const t = b.rb.translation()
    const r = b.rb.rotation()
    this.tmpQ.x = r.x; this.tmpQ.y = r.y; this.tmpQ.z = r.z; this.tmpQ.w = r.w
    return { t, r: this.tmpQ }
  }
}
