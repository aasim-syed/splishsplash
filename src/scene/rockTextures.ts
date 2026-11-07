import * as THREE from 'three'

/**
 * Tileable procedural rock detail (albedo modulation + normal map), generated once.
 * Sampled triplanar & mipmapped on the GPU → crisp up close, no shimmer at distance.
 */
function tileNoise(size: number, period: number, seed: number) {
  const g = new Float32Array(period * period)
  let s = seed * 9301 + 49297
  for (let i = 0; i < g.length; i++) { s = (s * 9301 + 49297) % 233280; g[i] = s / 233280 }
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * period, fy = (y / size) * period
    const ix = Math.floor(fx), iy = Math.floor(fy)
    const tx = fx - ix, ty = fy - iy
    const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty)
    const a = g[(iy % period) * period + (ix % period)], b = g[(iy % period) * period + ((ix + 1) % period)]
    const c = g[((iy + 1) % period) * period + (ix % period)], d = g[((iy + 1) % period) * period + ((ix + 1) % period)]
    out[y * size + x] = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  return out
}

export function makeRockTextures(size = 512) {
  const H = new Float32Array(size * size)
  const oct: [number, number][] = [[4, 0.42], [8, 0.24], [16, 0.14], [32, 0.09], [64, 0.06], [128, 0.04], [256, 0.025]]
  oct.forEach(([p, a], i) => {
    const n = tileNoise(size, p, i + 1)
    for (let k = 0; k < H.length; k++) H[k] += n[k] * a
  })
  // ridged fractures (horizontal-ish bedding cracks + vertical joints)
  const r1 = tileNoise(size, 6, 21), r2 = tileNoise(size, 12, 22)
  for (let k = 0; k < H.length; k++) {
    const crack = 1 - Math.abs(r1[k] * 0.7 + r2[k] * 0.3 - 0.5) * 2
    H[k] -= Math.pow(Math.max(0, crack), 26) * 0.12
  }
  // pits & flint nodules
  const albedoMod = new Float32Array(size * size).fill(1)
  let s = 7
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  for (let i = 0; i < 260; i++) {
    const cx = rnd() * size, cy = rnd() * size, r = 2 + rnd() * 7, flint = rnd() < 0.18
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy) / r
      if (d > 1) continue
      const x = ((Math.round(cx + dx) % size) + size) % size, y = ((Math.round(cy + dy) % size) + size) % size
      const k = y * size + x
      const f = 1 - d * d
      if (flint) { albedoMod[k] = Math.min(albedoMod[k], 0.35 + 0.4 * d); H[k] += f * 0.08 }
      else H[k] -= f * 0.06
    }
  }
  let mn = Infinity, mx = -Infinity
  for (const v of H) { if (v < mn) mn = v; if (v > mx) mx = v }
  const alb = new Uint8Array(size * size * 4)
  const nrm = new Uint8Array(size * size * 4)
  const strength = 5.5
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = y * size + x
    const h = (H[k] - mn) / (mx - mn)
    const hl = H[y * size + ((x - 1 + size) % size)], hr = H[y * size + ((x + 1) % size)]
    const hd = H[((y - 1 + size) % size) * size + x], hu = H[((y + 1) % size) * size + x]
    const nx = -(hr - hl) * strength, ny = -(hu - hd) * strength
    const l = Math.hypot(nx, ny, 1)
    nrm.set([((nx / l) * 0.5 + 0.5) * 255, ((ny / l) * 0.5 + 0.5) * 255, ((1 / l) * 0.5 + 0.5) * 255, 255], k * 4)
    // albedo modulation stored around 0.5 (shader multiplies by 2×)
    const a = (0.78 + 0.34 * h) * albedoMod[k] * 0.5
    const v = Math.max(0, Math.min(255, a * 255))
    // cavity AO baked into alpha
    const cav = Math.max(0, Math.min(1, 0.55 + h * 0.9))
    alb.set([v, v, v, cav * 255], k * 4)
  }
  const mk = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.anisotropy = 8
    t.colorSpace = THREE.NoColorSpace
    t.needsUpdate = true
    return t
  }
  return { albedo: mk(alb), normal: mk(nrm) }
}
