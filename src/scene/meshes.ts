import * as THREE from 'three'
import { fbm, lin } from '@/engine/terrain'
import type { ObjectDef } from '@/engine/objects'

const geoCache = new Map<string, THREE.BufferGeometry>()
const matCache = new Map<string, THREE.Material | THREE.Material[]>()

function vertexColorize(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3) => [number, number, number]) {
  const pos = geo.attributes.position
  const col = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const c = fn(v)
    col.set([lin(c[0]), lin(c[1]), lin(c[2])], i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
}

function crateTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#a77a43'
  g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 5; i++) {
    g.fillStyle = i % 2 ? '#b98a50' : '#9c6f3b'
    g.fillRect(0, i * 51, 256, 49)
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(60,35,15,${0.08 + Math.random() * 0.1})`
      g.beginPath()
      const y = i * 51 + Math.random() * 49
      g.moveTo(0, y)
      g.bezierCurveTo(80, y + Math.random() * 4 - 2, 170, y + Math.random() * 4 - 2, 256, y)
      g.stroke()
    }
  }
  g.strokeStyle = '#5a3a1c'
  g.lineWidth = 22
  g.strokeRect(11, 11, 234, 234)
  g.lineWidth = 18
  g.beginPath(); g.moveTo(16, 16); g.lineTo(240, 240); g.stroke()
  g.fillStyle = '#2c2c2c'
  for (const [x, y] of [[20, 20], [236, 20], [20, 236], [236, 236]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill() }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

export function geometryFor(def: ObjectDef): THREE.BufferGeometry {
  const hit = geoCache.get(def.id)
  if (hit) return hit
  let geo: THREE.BufferGeometry
  const d = def.dims
  switch (def.look) {
    case 'rock': {
      geo = new THREE.IcosahedronGeometry(d[0], 2)
      const pos = geo.attributes.position
      const v = new THREE.Vector3()
      const seed = def.id.length * 3.7
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i)
        const n = v.clone().normalize()
        const k = 1 + 0.16 * fbm(n.x * 2.2 + seed, n.y * 2.2 + n.z * 1.7, 3)
        v.copy(n.multiplyScalar(d[0] * k))
        pos.setXYZ(i, v.x, v.y, v.z)
      }
      geo = geo.toNonIndexed()
      geo.computeVertexNormals()
      vertexColorize(geo, (p) => {
        const s = 0.42 + 0.1 * fbm(p.x * 3, p.y * 3 + p.z * 2, 3)
        return [s * 1.02, s * 0.97, s * 0.9]
      })
      break
    }
    case 'beachball': {
      geo = new THREE.SphereGeometry(d[0], 40, 28)
      const cols = [[0.95, 0.2, 0.2], [1, 0.85, 0.15], [0.15, 0.45, 0.95], [0.98, 0.98, 0.98], [0.2, 0.75, 0.35], [1, 0.55, 0.1]]
      vertexColorize(geo, (p) => {
        if (Math.abs(p.y) > d[0] * 0.93) return [1, 1, 1]
        const a = (Math.atan2(p.z, p.x) / (Math.PI * 2) + 1) % 1
        return cols[Math.floor(a * 6)] as [number, number, number]
      })
      break
    }
    case 'melon': {
      geo = new THREE.SphereGeometry(d[0], 36, 24)
      vertexColorize(geo, (p) => {
        const a = Math.atan2(p.z, p.x)
        const s = Math.sin(a * 9 + 1.4 * fbm(p.y * 9, a * 2, 2)) > 0.1 ? 1 : 0
        return s ? [0.12, 0.36, 0.13] : [0.42, 0.66, 0.3]
      })
      break
    }
    case 'barrel': {
      geo = new THREE.CylinderGeometry(d[1], d[1], d[0] * 2, 32, 12)
      const pos = geo.attributes.position
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / d[0]
        const bulge = 1 + 0.07 * (1 - y * y)
        pos.setX(i, pos.getX(i) * bulge * 0.95)
        pos.setZ(i, pos.getZ(i) * bulge * 0.95)
      }
      geo.computeVertexNormals()
      vertexColorize(geo, (p) => {
        const y = Math.abs(p.y / d[0])
        const hoop = (y > 0.62 && y < 0.72) || y > 0.9
        if (hoop) return [0.18, 0.18, 0.19]
        const a = Math.atan2(p.z, p.x)
        const stave = 0.85 + 0.15 * Math.sin(a * 22)
        return [0.55 * stave, 0.29 * stave, 0.15 * stave]
      })
      break
    }
    case 'log':
      geo = new THREE.CylinderGeometry(d[1], d[1] * 1.04, d[0] * 2, 20, 1)
      break
    default:
      if (def.shape === 'ball') geo = new THREE.SphereGeometry(d[0], 32, 22)
      else if (def.shape === 'box') geo = new THREE.BoxGeometry(d[0] * 2, d[1] * 2, d[2] * 2)
      else geo = new THREE.CylinderGeometry(d[1], d[1], d[0] * 2, 28)
  }
  geoCache.set(def.id, geo)
  return geo
}

export function materialFor(def: ObjectDef): THREE.Material | THREE.Material[] {
  const hit = matCache.get(def.id)
  if (hit) return hit
  let m: THREE.Material | THREE.Material[]
  switch (def.look) {
    case 'rock':
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })
      break
    case 'beachball':
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 })
      break
    case 'melon':
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 })
      break
    case 'barrel':
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 })
      break
    case 'wood':
      m = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85 })
      break
    case 'log': {
      const bark = new THREE.MeshStandardMaterial({ color: '#5a3d24', roughness: 1, flatShading: true })
      const end = new THREE.MeshStandardMaterial({ color: '#c79a62', roughness: 0.9 })
      m = [bark, end, end]
      break
    }
    case 'metal':
      m = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.38, metalness: 0.85 })
      break
    case 'ice':
      m = new THREE.MeshPhysicalMaterial({
        color: '#cdeefa', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.78, clearcoat: 1, clearcoatRoughness: 0.1,
      })
      break
    default:
      m = new THREE.MeshStandardMaterial({ color: def.color })
  }
  matCache.set(def.id, m)
  return m
}
