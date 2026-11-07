export type ShapeKind = 'ball' | 'box' | 'cylinder'
export type SplashSound = 'plunk' | 'boom' | 'slap' | 'thunk' | 'pat' | 'bonk' | 'splat' | 'clink'

/** How this object meets the water: shape the crown, jet, mist, debris and sound. */
export interface SplashProfile {
  crown: number // droplet count multiplier
  spread: number // horizontal throw (flat faces → wide sheet)
  rise: number // vertical throw of the crown
  jet: number // Worthington jet strength (clean cavity seal = tall jet)
  jetWidth: number
  mist: number
  sound: SplashSound
  debris?: { n: number; colors: [number, number, number][] }
  burst?: boolean // breaks apart on hard impact
}

export interface ObjectDef {
  id: string
  label: string
  emoji: string
  shape: ShapeKind
  /** ball: [r]; box: [hx, hy, hz]; cylinder: [halfHeight, r] */
  dims: number[]
  density: number // kg/m³ (water = 1000)
  restitution: number
  friction: number
  dragCd: number
  color: string
  look: 'rock' | 'wood' | 'barrel' | 'beachball' | 'metal' | 'log' | 'melon' | 'ice' | 'plain'
  splash: SplashProfile
}

export const OBJECTS: ObjectDef[] = [
  { id: 'rock', label: 'Rock', emoji: '🪨', shape: 'ball', dims: [0.55], density: 2650, restitution: 0.15, friction: 0.8, dragCd: 0.6, color: '#7b756d', look: 'rock', splash: { crown: 1, spread: 1, rise: 1, jet: 1, jetWidth: 1, mist: 1, sound: 'plunk' } },
  { id: 'boulder', label: 'Boulder', emoji: '⛰️', shape: 'ball', dims: [1.4], density: 2650, restitution: 0.1, friction: 0.9, dragCd: 0.6, color: '#6d665e', look: 'rock', splash: { crown: 1.35, spread: 1.25, rise: 1.15, jet: 1.15, jetWidth: 1.6, mist: 2.6, sound: 'boom' } },
  { id: 'cannonball', label: 'Cannonball', emoji: '💣', shape: 'ball', dims: [0.22], density: 7850, restitution: 0.1, friction: 0.4, dragCd: 0.47, color: '#24262a', look: 'metal', splash: { crown: 0.55, spread: 0.55, rise: 0.8, jet: 1.75, jetWidth: 0.35, mist: 0.35, sound: 'plunk' } },
  { id: 'crate', label: 'Crate', emoji: '📦', shape: 'box', dims: [0.55, 0.55, 0.55], density: 480, restitution: 0.25, friction: 0.7, dragCd: 1.05, color: '#b0844c', look: 'wood', splash: { crown: 1.3, spread: 1.9, rise: 0.7, jet: 0.15, jetWidth: 1, mist: 1.6, sound: 'slap' } },
  { id: 'barrel', label: 'Barrel', emoji: '🛢️', shape: 'cylinder', dims: [0.6, 0.38], density: 320, restitution: 0.3, friction: 0.6, dragCd: 0.85, color: '#8a4b2a', look: 'barrel', splash: { crown: 0.9, spread: 1.4, rise: 0.8, jet: 0.25, jetWidth: 1, mist: 0.9, sound: 'bonk' } },
  { id: 'log', label: 'Log', emoji: '🪵', shape: 'cylinder', dims: [1.8, 0.3], density: 640, restitution: 0.2, friction: 0.8, dragCd: 0.9, color: '#6b4a2e', look: 'log', splash: { crown: 1.2, spread: 1.5, rise: 0.75, jet: 0.2, jetWidth: 1, mist: 1.1, sound: 'slap' } },
  { id: 'beachball', label: 'Beach ball', emoji: '🏐', shape: 'ball', dims: [0.5], density: 25, restitution: 0.82, friction: 0.5, dragCd: 0.47, color: '#ffffff', look: 'beachball', splash: { crown: 0.45, spread: 1.1, rise: 0.6, jet: 0, jetWidth: 1, mist: 0.25, sound: 'pat' } },
  { id: 'melon', label: 'Watermelon', emoji: '🍉', shape: 'ball', dims: [0.26], density: 960, restitution: 0.2, friction: 0.6, dragCd: 0.47, color: '#2f7d32', look: 'melon', splash: { crown: 0.9, spread: 1.2, rise: 0.9, jet: 0.5, jetWidth: 0.8, mist: 0.7, sound: 'splat', burst: true, debris: { n: 140, colors: [[0.85, 0.12, 0.16], [0.95, 0.25, 0.3], [0.2, 0.5, 0.18], [0.06, 0.05, 0.04]] } } },
  { id: 'anvil', label: 'Anvil', emoji: '⚒️', shape: 'box', dims: [0.45, 0.28, 0.2], density: 7200, restitution: 0.05, friction: 0.6, dragCd: 1.05, color: '#3a3d42', look: 'metal', splash: { crown: 1.15, spread: 1.6, rise: 0.85, jet: 0.9, jetWidth: 0.9, mist: 1.3, sound: 'thunk' } },
  { id: 'ice', label: 'Ice block', emoji: '🧊', shape: 'box', dims: [0.7, 0.45, 0.6], density: 917, restitution: 0.1, friction: 0.05, dragCd: 1.05, color: '#bfe6f5', look: 'ice', splash: { crown: 1, spread: 1.7, rise: 0.75, jet: 0.35, jetWidth: 1, mist: 1.1, sound: 'clink', debris: { n: 40, colors: [[0.85, 0.95, 1], [0.75, 0.9, 1]] } } },
]

export const OBJECT_MAP = Object.fromEntries(OBJECTS.map((o) => [o.id, o])) as Record<string, ObjectDef>

export function volumeOf(def: ObjectDef, s = 1) {
  const d = def.dims.map((x) => x * s)
  if (def.shape === 'ball') return (4 / 3) * Math.PI * d[0] ** 3
  if (def.shape === 'box') return 8 * d[0] * d[1] * d[2]
  return Math.PI * d[1] ** 2 * 2 * d[0]
}

/** frontal area for air drag (orientation-averaged approximation) */
export function frontalArea(def: ObjectDef, s = 1) {
  const d = def.dims.map((x) => x * s)
  if (def.shape === 'ball') return Math.PI * d[0] ** 2
  if (def.shape === 'box') return (4 * (d[0] * d[1] + d[1] * d[2] + d[0] * d[2])) / 3
  return (2 * d[1] * 2 * d[0] + Math.PI * d[1] ** 2) / 2
}

export function boundingRadius(def: ObjectDef, s = 1) {
  const d = def.dims.map((x) => x * s)
  if (def.shape === 'ball') return d[0]
  if (def.shape === 'box') return Math.hypot(d[0], d[1], d[2])
  return Math.hypot(d[0], d[1])
}

export interface VolumeSample {
  x: number; y: number; z: number
  vol: number // m³ this sample represents
  half: number // half-extent used for partial submersion
  area: number // cross-section for hydrodynamic drag
}

/** Discretize the body into small volume cells for buoyancy & drag. */
export function volumeSamples(def: ObjectDef, s = 1): VolumeSample[] {
  const d = def.dims.map((x) => x * s)
  const pts: VolumeSample[] = []
  const V = volumeOf(def, s)
  if (def.shape === 'box') {
    const n = 4
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) {
      pts.push({
        x: -d[0] + (2 * d[0] * (a + 0.5)) / n,
        y: -d[1] + (2 * d[1] * (b + 0.5)) / n,
        z: -d[2] + (2 * d[2] * (c + 0.5)) / n,
        vol: 0, half: d[1] / n, area: 0,
      })
    }
  } else if (def.shape === 'ball') {
    const r = d[0]
    const g = [-0.75, -0.25, 0.25, 0.75]
    for (const a of g) for (const b of g) for (const c of g) {
      if (a * a + b * b + c * c < 1) pts.push({ x: a * r, y: b * r, z: c * r, vol: 0, half: r / 4, area: 0 })
    }
  } else {
    const [hh, r] = d
    const g = [-0.75, -0.25, 0.25, 0.75]
    const ny = Math.max(3, Math.round((hh / r) * 2) + 2)
    for (const a of g) for (const c of g) {
      if (a * a + c * c >= 1) continue
      for (let b = 0; b < ny; b++) {
        pts.push({ x: a * r, y: -hh + (2 * hh * (b + 0.5)) / ny, z: c * r, vol: 0, half: hh / ny, area: 0 })
      }
    }
  }
  const vi = V / pts.length
  const ai = Math.pow(vi, 2 / 3)
  // cubic cell of equal volume → orientation-independent partial submersion
  const half = 0.5 * Math.cbrt(vi)
  for (const p of pts) { p.vol = vi; p.area = ai; p.half = half }
  return pts
}
