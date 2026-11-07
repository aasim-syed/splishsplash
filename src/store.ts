import { create } from 'zustand'
import type { ImpactInfo } from '@/engine/engine'

interface State {
  selected: string
  angle: number
  scale: number
  spin: number
  timeScale: number
  sound: boolean
  showArc: boolean
  track: boolean
  thrown: boolean
  thumbs: Record<string, string>
  impacts: ImpactInfo[]
  stats: { bodies: number; particles: number; fps: number }
  set: (p: Partial<State>) => void
  pushImpact: (i: ImpactInfo) => void
}

export const useStore = create<State>((set) => ({
  selected: 'rock',
  angle: 28,
  scale: 1,
  spin: 3,
  timeScale: 1,
  sound: true,
  showArc: true,
  track: false,
  thrown: false,
  thumbs: {},
  impacts: [],
  stats: { bodies: 0, particles: 0, fps: 0 },
  set: (p) => set(p),
  pushImpact: (i) => set((s) => ({ impacts: [i, ...s.impacts].slice(0, 6) })),
}))
