// Offline soundtrack for a capture: re-synthesises every splash & spray patter that the
// simulation produced (same physics-based synth as the app), plus sea ambience, to WAV.
// usage: tsx scripts/mix-soundtrack.ts events.json out.wav
import { readFileSync, writeFileSync } from 'node:fs'
import { synthPing, synthSplash, type SplashAudio } from '../src/engine/audio'

const [, , inPath, outPath] = process.argv
const data = JSON.parse(readFileSync(inPath, 'utf8')) as {
  events: { t: number; rate: number; p: SplashAudio }[]
  patters: { t: number; n: number; r: number; rate: number; storm: boolean }[]
  frames: number
  segments: { label: string; start: number }[]
}
const sr = 48000
const fps = 24
const dur = data.frames / fps + 1.5
const L = new Float32Array(Math.ceil(dur * sr)), R = new Float32Array(L.length)

// resample by playback rate (slow-mo → lower & longer, like the in-app audio)
function add(buf: Float32Array, t: number, gain: number, rate: number, pan = 0) {
  const start = Math.floor(t * sr)
  const n = Math.floor(buf.length / rate)
  const gl = gain * Math.sqrt(0.5 * (1 - pan)), gr = gain * Math.sqrt(0.5 * (1 + pan))
  for (let i = 0; i < n && start + i < L.length; i++) {
    const x = i * rate, i0 = Math.floor(x), f = x - i0
    const s = (buf[i0] ?? 0) * (1 - f) + (buf[i0 + 1] ?? 0) * f
    L[start + i] += s * gl
    R[start + i] += s * gr
  }
}

for (const e of data.events) {
  const loud = Math.min(1, 0.12 + Math.log10(1 + e.p.energy) / 6.5)
  add(synthSplash(e.p, sr), e.t, loud * 0.9, e.rate, (Math.random() - 0.5) * 0.4)
}
const pings = Array.from({ length: 28 }, (_, i) => synthPing(0.0006 + (i / 27) ** 1.5 * 0.003, sr))
for (const p of data.patters) {
  const n = Math.min(14, Math.ceil(Math.sqrt(p.n) * 1.4))
  const gain = Math.min(0.5, 0.04 + 0.012 * Math.sqrt(p.n))
  const bias = Math.min(1, p.r / 0.012)
  for (let i = 0; i < n; i++) {
    const idx = Math.max(0, Math.min(27, Math.floor((Math.random() * 0.7 + bias * 0.3) * 28)))
    add(pings[idx], p.t + Math.random() / fps, gain * (0.4 + Math.random() * 0.6), p.rate * (0.9 + Math.random() * 0.2), Math.random() * 1.2 - 0.6)
  }
}

// slapback off the cliff + short diffuse tail
for (const ch of [L, R]) {
  const d1 = Math.floor(0.14 * sr), d2 = Math.floor(0.031 * sr)
  for (let i = L.length - 1; i >= d1; i--) ch[i] += ch[i - d1] * 0.22
  for (let i = d2; i < L.length; i++) ch[i] += ch[i - d2] * 0.3
}

// sea ambience: brown-ish noise with slow wave swells; storm segment gets wind & heavier surf
const segAt = (t: number) => [...data.segments].reverse().find((s) => t >= s.start)?.label ?? 'golden'
let b1 = 0, b2 = 0, w = 0
for (let i = 0; i < L.length; i++) {
  const t = i / sr
  const storm = segAt(t) === 'storm' ? 1 : 0
  const slow = segAt(t) === 'slowmo' || segAt(t) === 'dusk' ? 0.6 : 1
  b1 = 0.995 * b1 + 0.02 * (Math.random() * 2 - 1)
  b2 = 0.995 * b2 + 0.02 * (Math.random() * 2 - 1)
  w = 0.9 * w + 0.1 * (Math.random() * 2 - 1)
  const swell = 0.55 + 0.45 * Math.sin(t * 0.9 * slow) * Math.sin(t * 0.37 + 1)
  const amb = (0.05 + 0.08 * storm) * swell
  const wind = storm * 0.03 * (0.6 + 0.4 * Math.sin(t * 1.7))
  L[i] += b1 * amb * 3 + w * wind
  R[i] += b2 * amb * 3 + w * wind * 0.9
}
// fade in/out + normalise to −1 dBFS
const fadeN = Math.floor(0.4 * sr)
for (let i = 0; i < fadeN; i++) { const g = i / fadeN; L[i] *= g; R[i] *= g; L[L.length - 1 - i] *= g; R[R.length - 1 - i] *= g }
let peak = 0
for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
const norm = peak > 0 ? 0.89 / peak : 1
const pcm = Buffer.alloc(44 + L.length * 4)
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + L.length * 4, 4); pcm.write('WAVEfmt ', 8)
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(sr, 24)
pcm.writeUInt32LE(sr * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(L.length * 4, 40)
for (let i = 0; i < L.length; i++) {
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32000), 44 + i * 4)
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32000), 46 + i * 4)
}
writeFileSync(outPath, pcm)
console.log('mixed', data.events.length, 'splashes,', data.patters.length, 'patter frames →', outPath, dur.toFixed(1), 's')
