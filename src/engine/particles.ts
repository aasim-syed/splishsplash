import type { WaterSim } from './water'
import { heightAt } from './terrain'

const RHO_AIR = 1.225
const RHO_W = 1000
const CD_DROP = 0.47

/**
 * Ballistic spray. Every droplet carries a physical radius that sets its
 * quadratic air drag (terminal velocity), and a render size. Droplets that
 * fall back into the sea punch their own small craters into the height-field,
 * producing the secondary "rain" ripples of a real splash.
 */
export class Particles {
  readonly cap = 40000
  px = new Float32Array(this.cap); py = new Float32Array(this.cap); pz = new Float32Array(this.cap)
  vx = new Float32Array(this.cap); vy = new Float32Array(this.cap); vz = new Float32Array(this.cap)
  radius = new Float32Array(this.cap) // physical radius (m)
  size = new Float32Array(this.cap) // render size (m)
  life = new Float32Array(this.cap)
  maxLife = new Float32Array(this.cap)
  /** 0 water droplet, 1 mist, 2 solid debris, 3 snowflake (no ripple/sound) */
  mist = new Uint8Array(this.cap)
  cr = new Float32Array(this.cap).fill(1); cg = new Float32Array(this.cap).fill(1); cb = new Float32Array(this.cap).fill(1)
  owner = new Int32Array(this.cap)
  private head = 0
  count = 0
  /** peak height reached per splash id (for stats) */
  peaks = new Map<number, number>()
  /** droplets that re-entered the sea since last drain (for spray patter audio) */
  landed = 0
  landedR = 0

  // render buffers (compacted)
  rPos = new Float32Array(this.cap * 3)
  rVel = new Float32Array(this.cap * 3)
  rSize = new Float32Array(this.cap)
  rAlpha = new Float32Array(this.cap)
  rMist = new Float32Array(this.cap)
  rColor = new Float32Array(this.cap * 3)
  rCount = 0

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    radius: number, size: number, life: number, mist: boolean | number, owner: number,
    color?: [number, number, number],
  ) {
    const i = this.head
    this.head = (this.head + 1) % this.cap
    if (this.life[i] <= 0) this.count++
    this.px[i] = x; this.py[i] = y; this.pz[i] = z
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz
    this.radius[i] = radius; this.size[i] = size
    this.life[i] = life; this.maxLife[i] = life
    this.mist[i] = typeof mist === 'number' ? mist : mist ? 1 : 0
    this.cr[i] = color ? color[0] : 1; this.cg[i] = color ? color[1] : 1; this.cb[i] = color ? color[2] : 1
    this.owner[i] = owner
  }

  step(dt: number, water: WaterSim) {
    const g = 9.81
    let alive = 0
    for (let i = 0; i < this.cap; i++) {
      let l = this.life[i]
      if (l <= 0) continue
      l -= dt
      if (l <= 0) { this.life[i] = 0; continue }
      this.life[i] = l
      const r = this.radius[i]
      // quadratic drag: a = -(ρa Cd A / 2m)|v|v,  A/m = 3/(4 ρw r)
      const k = (0.5 * RHO_AIR * CD_DROP * 3) / (4 * RHO_W * r)
      let vx = this.vx[i], vy = this.vy[i], vz = this.vz[i]
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz)
      const damp = 1 / (1 + k * sp * dt) // implicit → stable for tiny mist
      vx *= damp; vz *= damp
      vy = (vy - g * dt) * damp
      const x = this.px[i] + vx * dt, y = this.py[i] + vy * dt, z = this.pz[i] + vz * dt
      this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz
      this.px[i] = x; this.py[i] = y; this.pz[i] = z
      const o = this.owner[i]
      if (o >= 0 && this.mist[i] === 0) {
        const pk = this.peaks.get(o)
        if (pk !== undefined && y > pk) this.peaks.set(o, y)
      }
      if (vy < 0) {
        if (water.inside(x, z)) {
          const ws = water.heightAt(x, z)
          if (y < ws) {
            if (y < water.floorAt(x, z)) { this.life[i] = 0; continue }
            if (this.mist[i] !== 1 && this.mist[i] !== 3) {
              this.landed++
              this.landedR += r
              // droplet impact crater: volume scales with drop volume × impact speed
              const vol = (4 / 3) * Math.PI * r * r * r
              water.addVolume(x, z, -Math.min(0.03, vol * (-vy) * 55))
              water.addFoam(x, z, 0.05, 0.35)
            }
            this.life[i] = 0
            continue
          }
        } else if (y < Math.max(water.heightAt(x, z), heightAt(x, z))) {
          this.life[i] = 0
          continue
        }
      }
      alive++
    }
    this.count = alive
  }

  /** Pack live particles into the render buffers. */
  pack() {
    let n = 0
    for (let i = 0; i < this.cap; i++) {
      const l = this.life[i]
      if (l <= 0) continue
      this.rPos[n * 3] = this.px[i]
      this.rPos[n * 3 + 1] = this.py[i]
      this.rPos[n * 3 + 2] = this.pz[i]
      this.rVel[n * 3] = this.vx[i]
      this.rVel[n * 3 + 1] = this.vy[i]
      this.rVel[n * 3 + 2] = this.vz[i]
      const t = l / this.maxLife[i]
      const kind = this.mist[i]
      this.rSize[n] = kind === 1 ? this.size[i] * (1.8 - 0.8 * t) : this.size[i]
      this.rAlpha[n] = kind === 1 ? 0.07 * t * Math.min(1, (1 - t) * 6) : Math.min(1, t * 6)
      this.rColor[n * 3] = this.cr[i]; this.rColor[n * 3 + 1] = this.cg[i]; this.rColor[n * 3 + 2] = this.cb[i]
      this.rMist[n] = this.mist[i]
      n++
    }
    this.rCount = n
  }

  clear() {
    this.life.fill(0)
    this.count = 0
    this.peaks.clear()
  }
}
