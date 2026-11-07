import { heightAt } from './terrain'

/**
 * Ambient ocean swell: a few long deep-water waves (ω² = g·k) rolling in toward the cliff.
 * Shared verbatim with the water vertex shader so render and physics agree exactly.
 * [dirX, dirZ, wavelength, amplitude, phase]
 */
export const SWELL: [number, number, number, number, number][] = [
  [-0.96, 0.28, 46, 0.24, 0.0],
  [-0.78, -0.62, 27, 0.12, 1.7],
  [-0.55, 0.83, 16, 0.065, 4.1],
  [-0.99, -0.12, 9.5, 0.03, 2.3],
]
const SW = SWELL.map(([dx, dz, l, a, p]) => {
  const k = (2 * Math.PI) / l
  const n = Math.hypot(dx, dz)
  return { dx: dx / n, dz: dz / n, k, w: Math.sqrt(9.81 * k), a, p }
})
export function swellHeight(x: number, z: number, t: number) {
  let h = 0
  for (const s of SW) h += s.a * Math.sin(s.k * (s.dx * x + s.dz * z) - s.w * t + s.p)
  return h
}
export function swellVel(x: number, z: number, t: number) {
  let v = 0
  for (const s of SW) v -= s.a * s.w * Math.cos(s.k * (s.dx * x + s.dz * z) - s.w * t + s.p)
  return v
}

/**
 * Height-field water: linear wave equation integrated with symplectic Euler.
 *   dv/dt = c^2 ∇²h - γ v        dh/dt = v
 * - Wave speed follows shallow-water theory c = √(g·depth), capped at the
 *   deep-water phase speed of the ~6 m wavelengths the grid resolves, so rings
 *   shoal and slow near the cliff exactly like the real thing.
 * - Land cells are reflective (no-flux) walls.
 * - A sponge layer absorbs outgoing waves at the open-sea edges.
 * - Bodies couple to it by displacing volume (see engine.ts), so impact
 *   craters, bobbing ripples and wakes all come out of the same physics.
 */
export class WaterSim {
  readonly N = 256
  readonly x0 = -4
  readonly z0 = -40
  readonly size = 80
  readonly dx: number
  readonly cellArea: number
  h: Float32Array
  v: Float32Array
  foam: Float32Array
  floor: Float32Array
  c2: Float32Array
  damp: Float32Array
  solid: Uint8Array
  /** simulation clock, drives the swell */
  time = 0

  constructor() {
    const N = this.N
    this.dx = this.size / (N - 1)
    this.cellArea = this.dx * this.dx
    this.h = new Float32Array(N * N)
    this.v = new Float32Array(N * N)
    this.foam = new Float32Array(N * N)
    this.floor = new Float32Array(N * N)
    this.c2 = new Float32Array(N * N)
    this.damp = new Float32Array(N * N)
    this.solid = new Uint8Array(N * N)
    const g = 9.81
    const cMax = 3.4
    const sponge = 18
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i
        const x = this.x0 + i * this.dx
        const z = this.z0 + j * this.dx
        const fl = heightAt(x, z)
        this.floor[k] = fl
        const depth = -fl
        this.solid[k] = depth < 0.15 ? 1 : 0
        const c = Math.min(Math.sqrt(g * Math.max(depth, 0.15)), cMax)
        this.c2[k] = c * c
        // sponge on the three open-sea sides (cliff side is closed by land anyway)
        const e = Math.min(N - 1 - i, j, N - 1 - j)
        const s = e < sponge ? Math.pow(1 - e / sponge, 2) : 0
        this.damp[k] = 0.06 + 7 * s
      }
    }
  }

  step(dt: number) {
    this.time += dt
    const { N, h, v, c2, damp, solid, foam } = this
    const inv = 1 / (this.dx * this.dx)
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const k = j * N + i
        if (solid[k]) continue
        const hc = h[k]
        const hl = solid[k - 1] ? hc : h[k - 1]
        const hr = solid[k + 1] ? hc : h[k + 1]
        const hd = solid[k - N] ? hc : h[k - N]
        const hu = solid[k + N] ? hc : h[k + N]
        const lap = hl + hr + hd + hu - 4 * hc
        // tiny velocity viscosity kills grid-scale checkerboarding
        const vc = v[k]
        const lapV = (solid[k - 1] ? vc : v[k - 1]) + (solid[k + 1] ? vc : v[k + 1]) +
          (solid[k - N] ? vc : v[k - N]) + (solid[k + N] ? vc : v[k + N]) - 4 * vc
        let nv = vc + (c2[k] * lap * inv) * dt + 0.035 * lapV
        nv *= 1 - damp[k] * dt
        v[k] = nv
      }
    }
    const fDecay = Math.exp(-0.32 * dt)
    for (let k = 0; k < N * N; k++) {
      if (solid[k]) { h[k] = 0; v[k] = 0; foam[k] = 0; continue }
      let nh = h[k] + v[k] * dt
      if (nh > 6) nh = 6
      else if (nh < -6) nh = -6
      h[k] = nh
      // whitecaps where the surface moves violently
      const av = Math.abs(v[k])
      let f = foam[k] * fDecay
      if (av > 1.6) f += (av - 1.6) * dt * 0.6
      foam[k] = f > 1.5 ? 1.5 : f
    }
  }

  private gridCoord(x: number, z: number) {
    return [(x - this.x0) / this.dx, (z - this.z0) / this.dx] as const
  }

  inside(x: number, z: number) {
    const [gx, gz] = this.gridCoord(x, z)
    return gx >= 0 && gz >= 0 && gx < this.N - 1 && gz < this.N - 1
  }

  private bilinear(arr: Float32Array, x: number, z: number) {
    const [gx, gz] = this.gridCoord(x, z)
    if (gx < 0 || gz < 0 || gx >= this.N - 1 || gz >= this.N - 1) return 0
    const i = Math.floor(gx), j = Math.floor(gz)
    const fx = gx - i, fz = gz - j
    const k = j * this.N + i
    const a = arr[k], b = arr[k + 1], c = arr[k + this.N], d = arr[k + this.N + 1]
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz
  }

  /** total surface height = swell + simulated disturbance */
  heightAt(x: number, z: number) { return this.bilinear(this.h, x, z) + swellHeight(x, z, this.time) }
  velAt(x: number, z: number) { return this.bilinear(this.v, x, z) + swellVel(x, z, this.time) }
  floorAt(x: number, z: number) { return this.inside(x, z) ? this.bilinear(this.floor, x, z) : heightAt(x, z) }

  /** Add (or remove, if negative) a volume of water in m³ around (x,z), Gaussian-splatted. */
  addVolume(x: number, z: number, vol: number, radius = 0) {
    const [gx, gz] = this.gridCoord(x, z)
    const ci = Math.round(gx), cj = Math.round(gz)
    const rc = Math.max(1, Math.ceil(radius / this.dx))
    const sigma2 = Math.max(0.6, (radius / this.dx) * 0.6) ** 2
    let wsum = 0
    const N = this.N
    for (let pass = 0; pass < 2; pass++) {
      for (let j = cj - rc; j <= cj + rc; j++) {
        if (j < 1 || j >= N - 1) continue
        for (let i = ci - rc; i <= ci + rc; i++) {
          if (i < 1 || i >= N - 1) continue
          const k = j * N + i
          if (this.solid[k]) continue
          const w = Math.exp(-((i - gx) ** 2 + (j - gz) ** 2) / (2 * sigma2))
          if (pass === 0) wsum += w
          else this.h[k] += (vol * w) / (wsum * this.cellArea)
        }
      }
      if (wsum === 0) return
    }
  }

  addFoam(x: number, z: number, amount: number, radius: number) {
    const [gx, gz] = this.gridCoord(x, z)
    const rc = Math.ceil(radius / this.dx)
    const N = this.N
    for (let j = Math.round(gz) - rc; j <= Math.round(gz) + rc; j++) {
      if (j < 0 || j >= N) continue
      for (let i = Math.round(gx) - rc; i <= Math.round(gx) + rc; i++) {
        if (i < 0 || i >= N) continue
        const d = Math.hypot(i - gx, j - gz) * this.dx / radius
        if (d > 1) continue
        const k = j * N + i
        this.foam[k] = Math.min(1.5, this.foam[k] + amount * (1 - d * d))
      }
    }
  }

  reset() {
    this.h.fill(0); this.v.fill(0); this.foam.fill(0)
  }
}
