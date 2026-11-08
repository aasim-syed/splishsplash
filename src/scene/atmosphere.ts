import * as THREE from 'three'

/**
 * Shared, mutable lighting state. Every shader that cares about the sun references these
 * exact objects as uniform values, so switching season is just .copy()/.set() — no rebuilds.
 */
export const SUN_DIR = new THREE.Vector3(0.6, 0.12, 0.78).normalize()
export const SUN_COLOR = new THREE.Color(1, 0.8, 0.6)
export const ATMOS_U = {
  uCover: { value: 0.45 }, // cloud coverage 0..1
  uCloudDark: { value: 0 }, // storm darkening
  uSnow: { value: 0 },
  uGrassTint: { value: new THREE.Color(1, 1, 1) },
  uWaterTint: { value: new THREE.Color(1, 1, 1) },
  uChop: { value: 1 },
  uSwellScale: { value: 1 },
  uSunVis: { value: 1 }, // direct-sun visibility (storm clouds hide glints)
}

export type SeasonId = 'golden' | 'midday' | 'spring' | 'autumn' | 'winter' | 'dusk'

export interface Atmos {
  label: string
  sub: string
  elevation: number // degrees
  azimuth: number // degrees, 0 = +x (out to sea), 90 = +z
  sunColor: [number, number, number]
  sunIntensity: number
  sky: { turbidity: number; rayleigh: number; mieCoefficient: number; mieDirectionalG: number }
  hemi: [string, string, number]
  fog: [string, number, number]
  exposure: number
  env: number
  cover: number
  cloudDark: number
  snow: number
  grass: [number, number, number]
  water: [number, number, number]
  chop: number
  swell: number
  swatch: [string, string]
  sunDisc: number
  rain: number
  snowfall: number
  sunVis: number
}

export const SEASONS: Record<SeasonId, Atmos> = {
  golden: {
    label: 'Summer', sub: 'golden hour', elevation: 5.5, azimuth: -91,
    sunColor: [1, 0.7, 0.42], sunIntensity: 3.2,
    sky: { turbidity: 3.2, rayleigh: 2.4, mieCoefficient: 0.0022, mieDirectionalG: 0.78 },
    hemi: ['#b9cbe6', '#5a4630', 0.45], fog: ['#d9bf9f', 200, 1500], exposure: 0.62, env: 0.7,
    cover: 0.42, cloudDark: 0, snow: 0, grass: [1.05, 1, 0.8], water: [1, 1, 1], chop: 1, swell: 1,
    swatch: ['#f6b26b', '#5b7fa6'], sunDisc: 1, rain: 0, snowfall: 0, sunVis: 1,
  },
  midday: {
    label: 'Summer', sub: 'midday', elevation: 58, azimuth: -40,
    sunColor: [1, 0.97, 0.93], sunIntensity: 3.4,
    sky: { turbidity: 2, rayleigh: 1.4, mieCoefficient: 0.003, mieDirectionalG: 0.82 },
    hemi: ['#c7dcf5', '#5f5a48', 0.6], fog: ['#c3d5e7', 220, 1800], exposure: 0.5, env: 0.8,
    cover: 0.3, cloudDark: 0, snow: 0, grass: [1, 1.05, 0.9], water: [0.9, 1.05, 1.1], chop: 0.9, swell: 0.8,
    swatch: ['#8ec5ff', '#e8f3ff'], sunDisc: 0.5, rain: 0, snowfall: 0, sunVis: 1,
  },
  spring: {
    label: 'Spring', sub: 'clear morning', elevation: 12, azimuth: -82,
    sunColor: [1, 0.9, 0.78], sunIntensity: 2.8,
    sky: { turbidity: 2.4, rayleigh: 2.4, mieCoefficient: 0.0025, mieDirectionalG: 0.8 },
    hemi: ['#c9ddf3', '#55613e', 0.55], fog: ['#cfdbe4', 160, 1300], exposure: 0.58, env: 0.75,
    cover: 0.5, cloudDark: 0, snow: 0, grass: [0.85, 1.15, 0.75], water: [0.95, 1.05, 1.0], chop: 0.8, swell: 0.7,
    swatch: ['#bfe3a8', '#9cc6ea'], sunDisc: 0.8, rain: 0, snowfall: 0, sunVis: 1,
  },
  autumn: {
    label: 'Autumn', sub: 'storm', elevation: 16, azimuth: -95,
    sunColor: [0.8, 0.82, 0.85], sunIntensity: 0.45,
    sky: { turbidity: 6, rayleigh: 0.35, mieCoefficient: 0.004, mieDirectionalG: 0.6 },
    hemi: ['#8d98a3', '#2f2d2a', 1.15], fog: ['#6f777d', 30, 380], exposure: 0.62, env: 0.6,
    cover: 1.0, cloudDark: 0.8, snow: 0, grass: [1.15, 0.92, 0.6], water: [0.75, 0.85, 0.85], chop: 1.9, swell: 2.4,
    swatch: ['#6c7680', '#b0703c'], sunDisc: 0.08, rain: 1, snowfall: 0, sunVis: 0.08,
  },
  winter: {
    label: 'Winter', sub: 'low sun, snow', elevation: 8, azimuth: -86,
    sunColor: [1, 0.86, 0.72], sunIntensity: 2.4,
    sky: { turbidity: 2.0, rayleigh: 3, mieCoefficient: 0.0025, mieDirectionalG: 0.8 },
    hemi: ['#cbd9ea', '#6d6a66', 0.6], fog: ['#d3dbe3', 120, 1100], exposure: 0.55, env: 0.8,
    cover: 0.35, cloudDark: 0.1, snow: 1, grass: [0.8, 0.85, 0.8], water: [0.8, 0.95, 1.05], chop: 1.2, swell: 1.3,
    swatch: ['#ffffff', '#9fb4cc'], sunDisc: 0.85, rain: 0, snowfall: 1, sunVis: 0.9,
  },
  dusk: {
    label: 'Sunset', sub: 'dusk', elevation: 1.8, azimuth: -88,
    sunColor: [1, 0.46, 0.2], sunIntensity: 2.0,
    sky: { turbidity: 4.5, rayleigh: 2.8, mieCoefficient: 0.003, mieDirectionalG: 0.8 },
    hemi: ['#8f86a8', '#3a2a22', 0.5], fog: ['#b88a72', 150, 1300], exposure: 0.95, env: 0.55,
    cover: 0.5, cloudDark: 0.1, snow: 0, grass: [1.1, 0.9, 0.75], water: [1, 0.9, 0.95], chop: 0.9, swell: 0.9,
    swatch: ['#ff7a3d', '#4a3d6b'], sunDisc: 0.75, rain: 0, snowfall: 0, sunVis: 1,
  },
}

export function sunFrom(a: Atmos, out = new THREE.Vector3()) {
  const el = (a.elevation * Math.PI) / 180, az = (a.azimuth * Math.PI) / 180
  return out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize()
}

/** Apply a season to the shared uniform state (sun, tints, sea state). */
export function applyShared(a: Atmos) {
  sunFrom(a, SUN_DIR)
  SUN_COLOR.setRGB(...a.sunColor)
  ATMOS_U.uCover.value = a.cover
  ATMOS_U.uCloudDark.value = a.cloudDark
  ATMOS_U.uSnow.value = a.snow
  ATMOS_U.uGrassTint.value.setRGB(...a.grass)
  ATMOS_U.uWaterTint.value.setRGB(...a.water)
  ATMOS_U.uChop.value = a.chop
  ATMOS_U.uSwellScale.value = a.swell
  ATMOS_U.uSunVis.value = a.sunVis
}

applyShared(SEASONS.golden)
