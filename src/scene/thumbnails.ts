import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { OBJECTS, boundingRadius } from '@/engine/objects'
import { geometryFor, materialFor } from './meshes'

/** Render a studio-lit thumbnail of every throwable once, for the dock. */
export function renderThumbnails(size = 128): Record<string, string> {
  const out: Record<string, string> = {}
  const canvas = document.createElement('canvas')
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  r.setSize(size, size, false)
  r.toneMapping = THREE.ACESFilmicToneMapping
  r.toneMappingExposure = 1.05
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(r)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  const key = new THREE.DirectionalLight('#fff1dc', 2.4)
  key.position.set(3, 4, 2)
  scene.add(key, new THREE.HemisphereLight('#dbe8ff', '#3a3328', 0.6))
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100)
  for (const def of OBJECTS) {
    const mesh = new THREE.Mesh(geometryFor(def), materialFor(def))
    const rad = boundingRadius(def)
    mesh.rotation.set(-0.35, 0.6, def.shape === 'cylinder' && def.dims[0] > 1 ? 0.9 : 0.15)
    scene.add(mesh)
    const d = (rad / Math.sin((15 * Math.PI) / 180)) * 1.02
    cam.position.set(0, rad * 0.25, d)
    cam.lookAt(0, 0, 0)
    r.render(scene, cam)
    out[def.id] = canvas.toDataURL('image/png')
    scene.remove(mesh)
  }
  pmrem.dispose()
  r.dispose()
  r.forceContextLoss()
  return out
}
