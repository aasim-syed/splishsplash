import * as THREE from 'three'

/**
 * Two extra views the water shader needs to look like water rather than paint:
 *  - refraction: the scene *without* water (colour + depth) → see the seabed, sunk bodies,
 *    rocks below the surface, absorbed by the actual water thickness along each ray.
 *  - reflection: the scene mirrored about the sea plane (oblique near-plane clip) → the
 *    cliff, stacks and floating bodies mirrored in the sea, not just the sky.
 */
export class WaterPasses {
  refr: THREE.WebGLRenderTarget
  refl: THREE.WebGLRenderTarget
  reflCam = new THREE.PerspectiveCamera()
  textureMatrix = new THREE.Matrix4()
  private size = new THREE.Vector2()
  private plane = new THREE.Plane()
  private clip = new THREE.Vector4()
  private q = new THREE.Vector4()
  private v = {
    camPos: new THREE.Vector3(), view: new THREE.Vector3(), look: new THREE.Vector3(), target: new THREE.Vector3(),
    rot: new THREE.Matrix4(), n: new THREE.Vector3(0, 1, 0), o: new THREE.Vector3(0, 0, 0),
  }

  constructor() {
    this.refr = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true })
    this.refr.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)
    this.refl = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    })
  }

  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[], seaLevel = 0) {
    gl.getDrawingBufferSize(this.size)
    const w = Math.max(1, Math.floor(this.size.x)), h = Math.max(1, Math.floor(this.size.y))
    if (this.refr.width !== w || this.refr.height !== h) {
      this.refr.setSize(w, h)
      this.refl.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1))
    }
    const vis = hide.map((o) => o.visible)
    hide.forEach((o) => (o.visible = false))
    const prevRT = gl.getRenderTarget()

    // 1) refraction (also refreshes the shadow map once for the frame)
    gl.shadowMap.autoUpdate = true
    gl.setRenderTarget(this.refr)
    gl.clear()
    gl.render(scene, camera)
    gl.shadowMap.autoUpdate = false

    // 2) mirrored view (port of three's Reflector math)
    const { camPos, view, look, target, rot, n, o } = this.v
    o.set(0, seaLevel, 0)
    camPos.setFromMatrixPosition(camera.matrixWorld)
    view.subVectors(o, camPos)
    if (view.dot(n) <= 0) {
      view.reflect(n).negate().add(o)
      rot.extractRotation(camera.matrixWorld)
      look.set(0, 0, -1).applyMatrix4(rot).add(camPos)
      target.subVectors(o, look).reflect(n).negate().add(o)
      const rc = this.reflCam
      rc.position.copy(view)
      rc.up.set(0, 1, 0).applyMatrix4(rot).reflect(n)
      rc.lookAt(target)
      rc.far = camera.far
      rc.updateMatrixWorld()
      rc.projectionMatrix.copy(camera.projectionMatrix)
      rc.projectionMatrix.elements[8] *= -1
      rc.projectionMatrix.elements[12] *= -1
      this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      this.textureMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse)
      // oblique near plane = sea plane, so nothing below the surface leaks into the mirror
      this.plane.setFromNormalAndCoplanarPoint(n, o).applyMatrix4(rc.matrixWorldInverse)
      this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant)
      const pm = rc.projectionMatrix.elements
      this.q.set((Math.sign(this.clip.x) + pm[8]) / pm[0], (Math.sign(this.clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14])
      this.clip.multiplyScalar(2 / this.clip.dot(this.q))
      pm[2] = this.clip.x; pm[6] = this.clip.y; pm[10] = this.clip.z + 1 - 0.02; pm[14] = this.clip.w
      gl.setRenderTarget(this.refl)
      gl.clear()
      gl.render(scene, rc)
    }

    gl.setRenderTarget(prevRT)
    hide.forEach((ob, i) => (ob.visible = vis[i]))
  }

  dispose() {
    this.refr.dispose()
    this.refl.dispose()
  }
}
