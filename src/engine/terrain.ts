// Procedural coastline: a high plateau that drops through a rocky cliff face
// into a sloping seabed with a couple of sea stacks. Everything (render mesh,
// physics trimesh, water depth / wave speed) is derived from heightAt().

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return s - Math.floor(s)
}

function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1
}

export function fbm(x: number, y: number, oct = 4) {
  let s = 0, a = 0.5, f = 1
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f)
    f *= 2.03
    a *= 0.5
  }
  return s
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** sRGB → linear (three.js vertex colours are linear) */
export const lin = (c: number) => Math.pow(Math.max(0, c), 2.2)

export const CLIFF_TOP = 22
export const SEABED = -10

/** x-coordinate of the cliff lip for a given z */
export function edgeX(z: number) {
  return 2.2 * Math.sin(z * 0.075) + 1.3 * Math.sin(z * 0.19 + 1.3) + 0.8 * fbm(z * 0.08, 3.1, 3)
}

export const STACKS = [
  { x: 34, z: -17, r: 3.2, top: 3.5 },
  { x: 46, z: 14, r: 2.4, top: 1.6 },
]

export function heightAt(x: number, z: number) {
  const d = x - edgeX(z)
  // plateau: gentle rise inland + soft rolling
  const plateau = CLIFF_TOP + Math.min(0, -d) * -0.04 + 0.6 * fbm(x * 0.05, z * 0.05)
  // face: steep drop over ~3.5 m with horizontal strata ledges
  const faceT = smooth(-0.3, 3.4, d)
  const strata = 0.35 * Math.sin((plateau * (1 - faceT)) * 1.4) * faceT * (1 - faceT) * 4
  const toe = -1.5 + 0.8 * fbm(x * 0.2, z * 0.2)
  let h = plateau + (toe - plateau) * faceT + strata + 0.9 * fbm(x * 0.35, z * 0.35, 3) * faceT * (1 - faceT) * 4
  // underwater slope to seabed
  const seaT = smooth(3, 22, d)
  h = h + (SEABED + 1.2 * fbm(x * 0.06, z * 0.06) - h) * seaT * (d > 3 ? 1 : 0)
  // sea stacks
  const stack = (cx: number, cz: number, r: number, top: number) => {
    const dd = Math.hypot(x - cx, z - cz) / r
    const t = Math.exp(-Math.pow(dd, 4))
    return t * (top - SEABED) + t * 0.8 * fbm(x * 0.5, z * 0.5)
  }
  if (d > 6) for (const st of STACKS) h = Math.max(h, SEABED + stack(st.x, st.z, st.r, st.top))
  return h
}

export interface TerrainData {
  positions: Float32Array
  indices: Uint32Array
  colors: Float32Array
}

export const TERRAIN = { x0: -50, x1: 90, z0: -70, z1: 70, seg: 340 }

export function buildTerrain(): TerrainData {
  const { x0, x1, z0, z1, seg } = TERRAIN
  const n = seg + 1
  const positions = new Float32Array(n * n * 3)
  const colors = new Float32Array(n * n * 3)
  const hs = new Float32Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / seg
      const z = z0 + ((z1 - z0) * j) / seg
      hs[j * n + i] = heightAt(x, z)
    }
  }
  const dx = (x1 - x0) / seg
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      const x = x0 + ((x1 - x0) * i) / seg
      const z = z0 + ((z1 - z0) * j) / seg
      const h = hs[k]
      // craggy face: push vertices sideways where the cliff is steep (heightfields can't do this alone)
      positions.set([x, h, z], k * 3)
      const hl = hs[j * n + Math.max(0, i - 1)], hr = hs[j * n + Math.min(seg, i + 1)]
      const hd = hs[Math.max(0, j - 1) * n + i], hu = hs[Math.min(seg, j + 1) * n + i]
      const slope = Math.hypot(hr - hl, hu - hd) / (2 * dx)
      const nz = fbm(x * 0.4, z * 0.4 + h * 0.3, 2)
      let r: number, g: number, b: number
      if (h < -0.4) {
        const wet = smooth(-7, -0.4, h)
        r = 0.5 - 0.22 * wet; g = 0.46 - 0.2 * wet; b = 0.38 - 0.15 * wet // pale sand → dark wet rock
      } else if (slope > 0.9 || h < 12) {
        // layered limestone/sandstone: warm strata, darker seams, white lip, algae at the waterline
        const band = 0.5 + 0.5 * Math.sin(h * 1.7 + nz * 2.5)
        const seam = Math.pow(Math.abs(Math.sin(h * 0.9 + 0.6 * fbm(z * 0.1, h * 0.2))), 18)
        r = 0.56 + 0.1 * band; g = 0.5 + 0.09 * band; b = 0.42 + 0.07 * band
        r -= seam * 0.25; g -= seam * 0.23; b -= seam * 0.2
        const lip = smooth(CLIFF_TOP - 4, CLIFF_TOP - 0.5, h)
        r += lip * 0.08; g += lip * 0.08; b += lip * 0.08
        const tide = smooth(2.2, 0.2, h)
        r = r * (1 - tide) + 0.16 * tide; g = g * (1 - tide) + 0.2 * tide; b = b * (1 - tide) + 0.14 * tide
      } else {
        const dry = 0.5 + 0.5 * fbm(x * 0.05 + 11, z * 0.05, 3)
        r = 0.24 + 0.14 * dry + 0.03 * nz; g = 0.36 + 0.06 * dry + 0.04 * nz; b = 0.15 + 0.03 * dry // turf with sun-dried patches
      }
      const v = 0.92 + 0.16 * nz
      colors.set([lin(r * v), lin(g * v), lin(b * v)], k * 3)
    }
  }
  const indices = new Uint32Array(seg * seg * 6)
  let p = 0
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1
      indices[p++] = a; indices[p++] = c; indices[p++] = b
      indices[p++] = b; indices[p++] = c; indices[p++] = d
    }
  }
  return { positions, indices, colors }
}

export interface MeshData { positions: Float32Array; indices: Uint32Array; colors: Float32Array }

function grid(cols: number, rows: number, fn: (i: number, j: number) => { p: [number, number, number]; c: [number, number, number] }, flip = false): MeshData {
  const positions = new Float32Array(cols * rows * 3)
  const colors = new Float32Array(cols * rows * 3)
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const { p, c } = fn(i, j)
    const k = j * cols + i
    positions.set(p, k * 3)
    colors.set([lin(c[0]), lin(c[1]), lin(c[2])], k * 3)
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6)
  let q = 0
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1
    if (flip) { indices[q++] = a; indices[q++] = b; indices[q++] = c; indices[q++] = b; indices[q++] = d; indices[q++] = c }
    else { indices[q++] = a; indices[q++] = c; indices[q++] = b; indices[q++] = b; indices[q++] = c; indices[q++] = d }
  }
  return { positions, indices, colors }
}

function chalk(z: number, y: number, crag: number, top = 1e9): [number, number, number] {
  let r = 0.6, g = 0.58, b = 0.53
  // weathering streaks running down the face
  const streak = smooth(0.05, 0.45, fbm(z * 0.5, y * 0.04 + 5, 2))
  r -= 0.05 * streak; g -= 0.05 * streak; b -= 0.06 * streak
  // flint bands: thin dark dotted strata
  const band = Math.sin(y * 1.25 + 0.8 * fbm(z * 0.08, y * 0.1, 2))
  const flint = smooth(0.975, 0.998, band) * smooth(-0.1, 0.4, fbm(z * 0.9, y * 0.9, 1))
  r -= 0.22 * flint; g -= 0.22 * flint; b -= 0.2 * flint
  // recesses hold shadow-coloured grime
  const recess = smooth(0.6, 0.0, crag)
  r -= 0.06 * recess; g -= 0.07 * recess; b -= 0.05 * recess
  // wet tide band + algae
  const wet = smooth(3.2, 0.6, y)
  const algae = smooth(1.6, -0.2, y)
  r = r * (1 - wet * 0.45); g = g * (1 - wet * 0.4); b = b * (1 - wet * 0.42)
  r = r * (1 - algae) + 0.16 * algae; g = g * (1 - algae) + 0.21 * algae; b = b * (1 - algae) + 0.12 * algae
  const v = 0.97 + 0.06 * fbm(z * 0.9, y * 0.6, 2)
  // turf overhanging the lip
  const turf = smooth(top - 0.9 + 0.3 * fbm(z * 0.7, 3.3, 2), top - 0.15, y)
  r = r * (1 - turf) + 0.26 * turf; g = g * (1 - turf) + 0.38 * turf; b = b * (1 - turf) + 0.15 * turf
  return [r * v, g * v, b * v]
}

/** High-resolution chalk cliff face draped along the coastline (heightfields can't hold a 24 m wall). */
export function buildCliffFace(): MeshData {
  const z0 = -70, z1 = 70, dz = 0.18
  const yBot = -4, dy = 0.15
  const cols = Math.round((z1 - z0) / dz) + 1
  const rows = Math.round((CLIFF_TOP + 1 - yBot) / dy) + 1
  const toe = -1.5
  return grid(cols, rows, (i, j) => {
    const z = z0 + i * dz
    const ex = edgeX(z)
    const top = heightAt(ex - 0.6, z) + 0.02
    let y = yBot + j * dy
    const last = j === rows - 1
    if (y > top || last) y = top
    // invert the heightfield's smoothstep face profile so the mesh sits just proud of it
    const t = Math.min(1, Math.max(0, (CLIFF_TOP - y) / (CLIFF_TOP - toe)))
    const sInv = 0.5 - Math.sin(Math.asin(1 - 2 * t) / 3)
    const d = -0.3 + 3.7 * sInv
    const ledge = 0.22 * Math.pow(0.5 + 0.5 * Math.sin(y * 1.9 + fbm(z * 0.1, y * 0.2) * 2), 3)
    // buttresses & gullies: tall vertical structure (stretched in y), plus finer fracturing
    const crag01 = 0.5 + 0.5 * fbm(z * 0.3 + 3, y * 0.045, 3)
    const gully = Math.pow(0.5 + 0.5 * fbm(z * 0.7 + 11, y * 0.08, 2), 2)
    const crag = 2.2 * crag01 + 0.4 * gully + 0.25 * (0.5 + 0.5 * fbm(z * 0.9, y * 0.7, 2)) + ledge
    // roll the top of the face back into the plateau so there's no shelf at the lip
    const roll = smooth(top - 1.4, top, y)
    const xFace = ex + d + 1.0 + crag
    const x = xFace + (ex - 0.25 - xFace) * roll
    return { p: [x, y, z + 0.25 * fbm(y * 0.3, z * 0.3, 1)], c: chalk(z, y, crag01, top) }
  })
}

/** Sea stacks as proper rock columns (high-res lathe with noise). */
export function buildStacks(): MeshData[] {
  return STACKS.map((st, si) => {
    const cols = 120, rows = 80
    const yb = SEABED + 1, yt = st.top + 0.4
    return grid(cols, rows, (i, j) => {
      const th = (i / (cols - 1)) * Math.PI * 2
      const v = j / (rows - 1)
      const y = yb + (yt - yb) * v
      const frac = Math.min(0.999, Math.max(0.001, (y - SEABED) / (st.top - SEABED)))
      let rad = st.r * Math.pow(-Math.log(frac), 0.25) * 1.08
      if (v > 0.97) rad *= (1 - v) / 0.03
      const cx = Math.cos(th), sz = Math.sin(th)
      const n = fbm(cx * 1.6 + si * 7, y * 0.5 + sz * 1.6, 4)
      rad = Math.max(0, rad * (1 + 0.22 * n) + 0.25 * Math.sin(y * 2.2 + n * 3))
      return { p: [st.x + cx * rad, y, st.z + sz * rad], c: chalk(th * 6 + si * 30, y, 0.5 + 0.5 * n) }
    }, true)
  })
}

export type ViewId = 'edge' | 'sea' | 'aerial'
/** Camera presets derived from the generated coastline. */
export function viewPresets(): Record<ViewId, { pos: [number, number, number]; target: [number, number, number] }> {
  // stand on the most seaward promontory near the middle so the receding face is in frame
  let z0 = 0, best = -Infinity
  for (let z = -12; z <= 12; z += 0.5) { const e = edgeX(z); if (e > best) { best = e; z0 = z } }
  const ex = edgeX(z0)
  return {
    // just past the lip, as if leaning out: the drop and the receding face are in frame, throws fly out from behind you
    edge: { pos: [ex - 3, heightAt(ex - 3, z0) + 4.5, z0 - 7], target: [ex + 30, 0, z0 + 16] },
    sea: { pos: [48, 15, 46], target: [12, 6, -4] },
    aerial: { pos: [-22, 58, 46], target: [24, 0, -4] },
  }
}
