import { Suspense, useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Engine } from '@/engine/engine'
import { OBJECTS } from '@/engine/objects'
import { unlockAudio } from '@/engine/audio'
import { World } from '@/scene/World'
import { useStore } from '@/store'
import { Brand, Dock, Stats, Telemetry } from '@/components/Hud'
import { renderThumbnails } from '@/scene/thumbnails'

export default function App() {
  const [engine, setEngine] = useState<Engine | null>(null)
  useEffect(() => {
    let alive = true
    Engine.create().then((e) => {
      if (!alive) return
      ;(window as unknown as { __engine: Engine }).__engine = e
      setEngine(e)
      useStore.getState().set({ thumbs: renderThumbnails() })
    })
    return () => { alive = false }
  }, [])

  const barrage = useCallback(() => {
    if (!engine) return
    const { angle, scale, spin } = useStore.getState()
    for (let i = 0; i < 12; i++) {
      engine.schedule(i * 0.14, () => {
        const def = OBJECTS[Math.floor(Math.random() * OBJECTS.length)]
        const x = 10 + Math.random() * 50
        const z = -32 + Math.random() * 64
        useStore.getState().set({ thrown: true })
        engine.throwAt(def.id, x, z, angle + (Math.random() - 0.5) * 16, scale * (0.8 + Math.random() * 0.4), spin)
      })
    }
  }, [engine])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!engine || e.target instanceof HTMLInputElement) return
      const s = useStore.getState()
      const n = '1234567890'.indexOf(e.key)
      if (n >= 0 && OBJECTS[n]) s.set({ selected: OBJECTS[n].id })
      else if (e.code === 'Space') { e.preventDefault(); barrage() }
      else if (e.key === 'c' || e.key === 'C') engine.clear()
      else if (e.key === 's' || e.key === 'S') s.set({ timeScale: s.timeScale < 1 ? 1 : 0.2 })
      else if (e.key === 'p' || e.key === 'P') engine.paused = !engine.paused
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine, barrage])

  return (
    <div className="relative h-full w-full" onPointerDown={unlockAudio}>
      {engine ? (
        <Canvas
          shadows="soft"
          flat
          dpr={[1, 2]}
          gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
          camera={{ position: [48, 17, 50], fov: 42, near: 0.1, far: 9000 }}
          onCreated={({ gl }) => { gl.toneMappingExposure = 0.66 }}
        >
          <Suspense fallback={null}>
            <World engine={engine} />
          </Suspense>
        </Canvas>
      ) : (
        <div className="grid h-full place-items-center font-mono text-[11px] uppercase tracking-[0.25em] text-white/40">loading physics</div>
      )}
      {engine && (
        <>
          <Brand />
          <Telemetry engine={engine} />
          <Stats />
          <Dock engine={engine} onBarrage={barrage} />
        </>
      )}
    </div>
  )
}
