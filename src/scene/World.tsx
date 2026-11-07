import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Body, Engine } from '@/engine/engine'
import { useStore } from '@/store'
import { viewPresets } from '@/engine/terrain'
import { patter, playSplash } from '@/engine/audio'
import { makeFarOcean, makeWaterMaterial } from './waterMaterial'
import { SEASONS, SUN_COLOR, SUN_DIR, applyShared, sunFrom, type Atmos } from './atmosphere'
import { swellState } from '@/engine/water'
import { geometryFor, materialFor } from './meshes'
import { makeTerrainMaterial } from './terrainMaterial'
import { WaterPasses } from './waterPasses'
import { makeClouds } from './clouds'
import { makeSun } from './sun'

export const HOME_TARGET = new THREE.Vector3(12, 5, -4)
const VIEWS = viewPresets()

function makeSky() {
  const sky = new Sky()
  sky.scale.setScalar(4500)
  return sky
}
function setSky(sky: Sky, a: Atmos) {
  const u = sky.material.uniforms
  u.turbidity.value = a.sky.turbidity
  u.rayleigh.value = a.sky.rayleigh
  u.mieCoefficient.value = a.sky.mieCoefficient
  u.mieDirectionalG.value = a.sky.mieDirectionalG
  u.sunPosition.value.copy(SUN_DIR)
  u.showSunDisc.value = 0
}

export function World({ engine }: { engine: Engine }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  const season = useStore((st) => st.season)
  const atmos = SEASONS[season]

  // Sky (+clouds) → cubemap: exact sky reflections in the water + PBR environment for everything else.
  const env = useMemo(() => {
    const skyScene = new THREE.Scene()
    const skySky = makeSky()
    skyScene.add(skySky, makeClouds(SUN_DIR).mesh)
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter })
    const cc = new THREE.CubeCamera(1, 10000, rt)
    return { cube: rt.texture, rt, cc, skyScene, skySky }
  }, [])

  const sky = useMemo(makeSky, [])
  const sun = useMemo(makeSun, [])
  const clouds = useMemo(() => makeClouds(SUN_DIR), [])
  // all shader clocks follow simulation time → slow-mo slows the sea and sky too, captures are deterministic
  useFrame(() => { clouds.mat.uniforms.uTime.value = engine.simTime })

  // season → sun, sky, clouds, fog, exposure, sea state; re-bake the environment
  useEffect(() => {
    applyShared(atmos)
    swellState.scale = atmos.swell
    setSky(sky, atmos)
    setSky(env.skySky, atmos)
    env.cc.update(gl, env.skyScene)
    const pmrem = new THREE.PMREMGenerator(gl)
    const pm = pmrem.fromCubemap(env.cube).texture
    pmrem.dispose()
    scene.environment = pm
    scene.environmentIntensity = atmos.env
    scene.fog = new THREE.Fog(atmos.fog[0], atmos.fog[1], atmos.fog[2])
    gl.toneMappingExposure = atmos.exposure
    sun.mat.uniforms.uIntensity.value = atmos.sunDisc
    return () => { pm.dispose() }
  }, [atmos, gl, scene, env, sky, sun])

  const sunPos = useMemo(() => sunFrom(atmos).multiplyScalar(160).add(HOME_TARGET), [atmos])

  return (
    <>
      <primitive object={sky} />
      <primitive object={sun.mesh} />
      <primitive object={clouds.mesh} />
      <hemisphereLight key={season} args={atmos.hemi} />
      <directionalLight
        position={sunPos}
        intensity={atmos.sunIntensity}
        color={new THREE.Color(...atmos.sunColor)}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-camera-near={10}
        shadow-camera-far={400}
        shadow-bias={-0.0003}
        shadow-normalBias={0.05}
      >
        <object3D attach="target" position={HOME_TARGET.toArray()} />
      </directionalLight>
      <Terrain engine={engine} />
      <Water engine={engine} env={env.cube} />
      <Bodies engine={engine} />
      <Spray engine={engine} />
      <Aim engine={engine} />
      <Stepper engine={engine} />
      <OrbitControls
        makeDefault
        target={VIEWS.sea.target}
        maxPolarAngle={Math.PI * 0.48}
        minDistance={3}
        maxDistance={180}
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.6}
      />
      <CameraRig engine={engine} />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.6} luminanceThreshold={1.6} luminanceSmoothing={0.3} radius={0.65} />
        <HueSaturation saturation={-0.04} />
        <BrightnessContrast contrast={0.1} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.3} darkness={0.5} />
        <Noise opacity={0.03} blendFunction={BlendFunction.OVERLAY} />
      </EffectComposer>
    </>
  )
}

function Stepper({ engine }: { engine: Engine }) {
  const set = useStore((s) => s.set)
  const sound = useStore((s) => s.sound)
  const pushImpact = useStore((s) => s.pushImpact)
  const timeScale = useStore((s) => s.timeScale)
  const acc = useRef({ t: 0, frames: 0 })
  useEffect(() => { engine.timeScale = timeScale }, [engine, timeScale])
  useEffect(() => {
    engine.onImpact = (i) => pushImpact(i)
    engine.onSplashSound = sound
      ? (p) => playSplash(p, Math.max(0.35, engine.timeScale ** 0.5))
      : undefined
  }, [engine, sound, pushImpact])
  useFrame((_, dt) => {
    engine.update(dt)
    const P = engine.particles
    if (P.landed > 0) {
      if (useStore.getState().sound) patter(P.landed, P.landedR / P.landed, Math.max(0.35, engine.timeScale ** 0.5))
      P.landed = 0
      P.landedR = 0
    }
    const a = acc.current
    a.t += dt
    a.frames++
    if (a.t > 0.5) {
      set({ stats: { bodies: engine.bodies.length, particles: engine.particles.count, fps: Math.round(a.frames / a.t) } })
      a.t = 0
      a.frames = 0
    }
  }, -2)
  return null
}

/** Follows the last throw a little, then eases back; adds impact shake. */
function CameraRig({ engine }: { engine: Engine }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__frame = () =>
      new Promise<void>((res) => { invalidate(); requestAnimationFrame(() => requestAnimationFrame(() => res())) })
  }, [invalidate])
  const track = useStore((s) => s.track)
  const view = useStore((s) => s.view)
  const anim = useRef<{ p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; k: number } | null>(null)
  const first = useRef(true)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null
  useEffect(() => {
    if (!controls) return
    const v = VIEWS[view]
    const p1 = new THREE.Vector3(...v.pos), t1 = new THREE.Vector3(...v.target)
    if (first.current) {
      first.current = false
      camera.position.copy(p1)
      controls.target.copy(t1)
      controls.update()
      return
    }
    anim.current = { p0: camera.position.clone(), t0: controls.target.clone(), p1, t1, k: 0 }
  }, [view, camera, controls])
  const home = useRef<THREE.Vector3 | null>(null)
  const followed = useRef<Body | null>(null)
  const desired = useMemo(() => new THREE.Vector3(), [])
  const delta = useMemo(() => new THREE.Vector3(), [])
  useFrame((state, dt) => {
    const controls = state.controls as unknown as OrbitControlsImpl | null
    if (!controls) return
    ;(window as unknown as Record<string, unknown>).__rig = { camera: state.camera, controls }
    const a = anim.current
    if (a) {
      a.k = Math.min(1, a.k + dt / 1.6)
      const e = a.k < 0.5 ? 4 * a.k ** 3 : 1 - (-2 * a.k + 2) ** 3 / 2
      state.camera.position.lerpVectors(a.p0, a.p1, e)
      controls.target.lerpVectors(a.t0, a.t1, e)
      if (a.k >= 1) anim.current = null
    }
    const b = engine.lastThrown
    if (b !== followed.current) {
      followed.current = b
      if (b) home.current = controls.target.clone()
    }
    if (track && home.current) {
      const alive = b && engine.bodies.includes(b) && engine.simTime - b.bornAt < 4.5
      if (alive && b) {
        const t = b.rb.translation()
        // only once it's out over the water; horizontal only, so the horizon stays put
        if (t.x > 4) desired.set(t.x, home.current.y, t.z).lerp(home.current, 0.7)
        else desired.copy(home.current)
      } else desired.copy(home.current)
      delta.copy(desired).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 2.2))
      controls.target.add(delta)
      state.camera.position.add(delta)
      if (!alive && delta.lengthSq() < 1e-6) home.current = null
    }
    engine.shake *= Math.exp(-dt * 3.2)
    const s = engine.shake * 0.01
    if (s > 1e-4) {
      const t = state.clock.elapsedTime
      state.camera.rotateX(Math.sin(t * 37) * s)
      state.camera.rotateY(Math.sin(t * 29 + 1) * s)
    }
  }, 0.5)
  return null
}

function Terrain({ engine }: { engine: Engine }) {
  const { geos, mat } = useMemo(() => {
    const geos = [engine.terrain, ...engine.rockMeshes].map((m) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
      g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3))
      g.setIndex(new THREE.BufferAttribute(m.indices, 1))
      g.computeVertexNormals()
      return g
    })
    return { geos, mat: makeTerrainMaterial() }
  }, [engine])
  return (
    <>
      {geos.map((g, i) => (
        <mesh
          key={i}
          geometry={g}
          material={mat}
          receiveShadow
          castShadow
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        />
      ))}
    </>
  )
}

function Water({ engine, env }: { engine: Engine; env: THREE.Texture }) {
  const w = engine.water
  const simRef = useRef<THREE.Mesh>(null!)
  const farRef = useRef<THREE.Mesh>(null!)
  const passes = useMemo(() => new WaterPasses(), [])
  useEffect(() => () => passes.dispose(), [passes])
  // render refraction + reflection views right before the composer draws the frame
  useFrame(({ gl, scene, camera }) => {
    const cam = camera as THREE.PerspectiveCamera
    passes.render(gl, scene, cam, [simRef.current, farRef.current])
    for (const m of [mat, farMat]) {
      const u = m.uniforms
      u.uRefr.value = passes.refr.texture
      u.uDepth.value = passes.refr.depthTexture
      u.uRefl.value = passes.refl.texture
      u.uReflMat.value.copy(passes.textureMatrix)
      u.uRes.value.set(passes.refr.width, passes.refr.height)
      u.uNear.value = cam.near
      u.uFar2.value = cam.far
      u.uPasses.value = 1
    }
  }, 0.9)
  const { geo, mat, farMat, farGeo } = useMemo(() => {
    const rect: [number, number, number, number] = [w.x0, w.z0, w.x0 + w.size, w.z0 + w.size]
    const N = w.N
    const pos = new Float32Array(N * N * 3)
    const nrm = new Float32Array(N * N * 3)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i
      pos[k * 3] = w.x0 + i * w.dx
      pos[k * 3 + 2] = w.z0 + j * w.dx
      nrm[k * 3 + 1] = 1
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6)
    let p = 0
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1
      idx[p++] = a; idx[p++] = c; idx[p++] = b
      idx[p++] = b; idx[p++] = c; idx[p++] = d
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aFoam', new THREE.BufferAttribute(new Float32Array(N * N), 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aFloor', new THREE.BufferAttribute(w.floor, 1))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    return {
      geo: g,
      mat: makeWaterMaterial(false, rect, env),
      farMat: makeWaterMaterial(true, rect, env),
      farGeo: makeFarOcean(w.x0 + w.size / 2, w.z0 + w.size / 2),
    }
  }, [w, env])

  useFrame(() => {
    const N = w.N
    const pos = geo.attributes.position.array as Float32Array
    const nrm = geo.attributes.normal.array as Float32Array
    const foam = geo.attributes.aFoam.array as Float32Array
    const h = w.h
    const inv = 1 / (2 * w.dx)
    for (let j = 0; j < N; j++) {
      const jm = j > 0 ? j - 1 : j, jp = j < N - 1 ? j + 1 : j
      for (let i = 0; i < N; i++) {
        const k = j * N + i
        pos[k * 3 + 1] = h[k]
        const im = i > 0 ? i - 1 : i, ip = i < N - 1 ? i + 1 : i
        const sx = (h[j * N + ip] - h[j * N + im]) * inv
        const sz = (h[jp * N + i] - h[jm * N + i]) * inv
        const l = 1 / Math.sqrt(sx * sx + 1 + sz * sz)
        nrm[k * 3] = -sx * l
        nrm[k * 3 + 1] = l
        nrm[k * 3 + 2] = -sz * l
        foam[k] = w.foam[k]
      }
    }
    geo.attributes.position.needsUpdate = true
    geo.attributes.normal.needsUpdate = true
    geo.attributes.aFoam.needsUpdate = true
    for (const m of [mat, farMat]) {
      m.uniforms.uTime.value = w.time
      m.uniforms.uSimTime.value = w.time
    }
  })

  return (
    <>
      <mesh ref={simRef} geometry={geo} material={mat} frustumCulled={false} />
      <mesh ref={farRef} geometry={farGeo} material={farMat} position={[0, -0.01, 0]} frustumCulled={false} />
    </>
  )
}

function Bodies({ engine }: { engine: Engine }) {
  const group = useRef<THREE.Group>(null!)
  const map = useRef(new Map<number, THREE.Mesh>())
  useEffect(() => {
    const add = (b: Body) => {
      const m = new THREE.Mesh(geometryFor(b.def), materialFor(b.def))
      m.castShadow = true
      m.receiveShadow = true
      m.scale.setScalar(b.scale)
      map.current.set(b.id, m)
      group.current.add(m)
    }
    const remove = (b: Body) => {
      const m = map.current.get(b.id)
      if (m) { group.current.remove(m); map.current.delete(b.id) }
    }
    engine.bodies.forEach(add)
    engine.onAdd = add
    engine.onRemove = remove
    return () => { engine.onAdd = undefined; engine.onRemove = undefined }
  }, [engine])
  useFrame(() => {
    for (const b of engine.bodies) {
      const m = map.current.get(b.id)
      if (!m) continue
      const t = b.rb.translation()
      const r = b.rb.rotation()
      m.position.set(t.x, t.y, t.z)
      m.quaternion.set(r.x, r.y, r.z, r.w)
    }
  })
  return <group ref={group} />
}

// Velocity-stretched droplets (≈1/40 s motion blur) + soft mist, lit by the low sun.
const sprayVert = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute float iSize;
attribute float iAlpha;
attribute float iMist;
attribute vec3 iColor;
varying vec3 vColor;
uniform vec3 uSun;
varying vec2 vQ;
varying float vL;
varying float vR;
varying float vAlpha;
varying float vMist;
varying float vFwd;
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  vec3 vv = mat3(viewMatrix) * iVel;
  float sp = length(vv.xy);
  float R = iSize * 0.5;
  float streak = iMist > 0.5 ? (iMist > 1.5 ? sp * 0.006 : 0.0) : sp * 0.024;
  vColor = iColor;
  float L = R + streak * 0.5;
  vec2 ax = sp > 1e-4 ? vv.xy / sp : vec2(1.0, 0.0);
  vec2 ay = vec2(-ax.y, ax.x);
  mv.xy += ax * position.x * L + ay * position.y * R;
  gl_Position = projectionMatrix * mv;
  vQ = vec2(position.x * L, position.y * R);
  vL = L; vR = R;
  vAlpha = iAlpha;
  vMist = iMist;
  vec3 toCam = normalize(cameraPosition - iPos);
  vFwd = pow(max(dot(-toCam, uSun), 0.0), 5.0);
}
`
const sprayFrag = /* glsl */ `
uniform vec3 uSunColor;
varying vec3 vColor;
varying vec2 vQ;
varying float vL;
varying float vR;
varying float vAlpha;
varying float vMist;
varying float vFwd;
void main() {
  float dx = max(abs(vQ.x) - (vL - vR), 0.0);
  float d = length(vec2(dx, vQ.y)) / vR;
  if (d > 1.0) discard;
  if (vMist > 1.5) {
    // solid debris chunk: lit sphere-ish blob in its own colour
    vec3 n = vec3(vQ.x / vL, vQ.y / vR, sqrt(max(0.0, 1.0 - d * d)));
    float diff = 0.45 + 0.55 * max(dot(n, normalize(vec3(0.4, 0.6, 0.7))), 0.0);
    gl_FragColor = vec4(vColor * diff * 0.9 + uSunColor * vFwd * 0.3, vAlpha * (1.0 - smoothstep(0.8, 1.0, d)));
  } else if (vMist > 0.5) {
    float a = pow(1.0 - d * d, 2.0) * vAlpha;
    vec3 c = vec3(0.86, 0.88, 0.9) + uSunColor * vFwd * 0.6;
    gl_FragColor = vec4(c, a);
  } else {
    float core = 1.0 - smoothstep(0.55, 1.0, d);
    vec3 c = vec3(0.8, 0.86, 0.9) * (0.75 + 0.25 * core) + uSunColor * vFwd * 2.6;
    gl_FragColor = vec4(min(c, vec3(20.0)), vAlpha * core * 0.95);
  }
  #include <colorspace_fragment>
}
`

function Spray({ engine }: { engine: Engine }) {
  const P = engine.particles
  const { geo, mat } = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    const ia = (arr: Float32Array, n: number) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('iPos', ia(P.rPos, 3))
    g.setAttribute('iVel', ia(P.rVel, 3))
    g.setAttribute('iSize', ia(P.rSize, 1))
    g.setAttribute('iAlpha', ia(P.rAlpha, 1))
    g.setAttribute('iMist', ia(P.rMist, 1))
    g.setAttribute('iColor', ia(P.rColor, 3))
    g.instanceCount = 0
    const m = new THREE.ShaderMaterial({
      vertexShader: sprayVert,
      fragmentShader: sprayFrag,
      transparent: true,
      depthWrite: false,
      uniforms: { uSun: { value: SUN_DIR }, uSunColor: { value: SUN_COLOR } },
    })
    return { geo: g, mat: m }
  }, [P])
  useFrame(() => {
    P.pack()
    const n = P.rCount
    geo.instanceCount = n
    for (const name of ['iPos', 'iVel', 'iSize', 'iAlpha', 'iMist', 'iColor']) {
      const a = geo.attributes[name] as THREE.InstancedBufferAttribute
      a.clearUpdateRanges()
      a.addUpdateRange(0, Math.max(1, n) * a.itemSize)
      a.needsUpdate = true
    }
  })
  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={2} />
}

function Aim({ engine }: { engine: Engine }) {
  const selected = useStore((s) => s.selected)
  const angle = useStore((s) => s.angle)
  const scale = useStore((s) => s.scale)
  const spin = useStore((s) => s.spin)
  const showArc = useStore((s) => s.showArc)
  const set = useStore((s) => s.set)
  const [target, setTarget] = useState<THREE.Vector3 | null>(null)
  const down = useRef<{ x: number; y: number } | null>(null)
  const reticle = useRef<THREE.Group>(null!)

  const sol = useMemo(
    () => (target ? engine.solveLaunch(selected, target.x, target.z, angle, scale) : null),
    [engine, target, selected, angle, scale],
  )
  const pts = useMemo(() => {
    if (!sol) return null
    const out: [number, number, number][] = []
    for (let i = 0; i < sol.points.length; i += 3) out.push([sol.points[i], sol.points[i + 1], sol.points[i + 2]])
    return out.length > 1 ? out : null
  }, [sol])

  useFrame(({ clock }) => {
    if (!target || !reticle.current) return
    reticle.current.position.set(target.x, engine.water.heightAt(target.x, target.z) + 0.04, target.z)
    const s = 1 + 0.08 * Math.sin(clock.elapsedTime * 4)
    reticle.current.scale.setScalar(s * Math.max(0.7, scale))
    reticle.current.rotation.y = clock.elapsedTime * 0.6
  })

  const onMove = (e: ThreeEvent<PointerEvent>) => setTarget(e.point.clone())
  const onDown = (e: ThreeEvent<PointerEvent>) => { down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = down.current
    down.current = null
    if (!d || e.nativeEvent.button !== 0) return
    if (Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y) > 6) return
    if (engine.throwAt(selected, e.point.x, e.point.z, angle, scale, spin)) set({ thrown: true })
  }
  const color = !sol ? '#ff6b5a' : sol.reachable ? '#ffffff' : '#ffb35a'

  return (
    <>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[60, 0.02, 0]}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={() => setTarget(null)}
      >
        <planeGeometry args={[240, 240]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {showArc && pts && (
        <Line points={pts} color="#ffffff" lineWidth={1.25} dashed dashSize={0.35} gapSize={0.35} transparent opacity={0.55} depthWrite={false} />
      )}
      {target && (
        <group ref={reticle}>
          <mesh rotation-x={-Math.PI / 2} renderOrder={3}>
            <ringGeometry args={[0.62, 0.68, 64]} />
            <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} toneMapped={false} />
          </mesh>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} rotation-x={-Math.PI / 2} rotation-z={(i * Math.PI) / 2} renderOrder={3}>
              <ringGeometry args={[0.85, 1.0, 16, 1, -0.12, 0.24]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} toneMapped={false} />
            </mesh>
          ))}
          <mesh rotation-x={-Math.PI / 2} renderOrder={3}>
            <circleGeometry args={[0.07, 24]} />
            <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      )}
    </>
  )
}
