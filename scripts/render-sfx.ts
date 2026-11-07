// Renders each object's splash at a typical cliff impact to WAV (for listening/tuning).
import { writeFileSync } from 'node:fs'
import { synthSplash } from '../src/engine/audio'
import { OBJECTS, volumeOf } from '../src/engine/objects'
const sr = 44100
const out = process.argv[2] ?? '.'
for (const o of OBJECTS) {
  const V = volumeOf(o), R = Math.cbrt((3 * V) / (4 * Math.PI)), m = o.density * V, v = 22
  const flat = o.shape === 'box' ? 0.9 : o.shape === 'cylinder' ? 0.6 : 0
  const d = synthSplash({ kind: o.splash.sound, energy: 0.5 * m * v * v, radius: R, speed: v, flat, density: o.density, jet: o.density > 400 && o.splash.jet > 0.3 && flat < 0.5 }, sr)
  const pcm = Buffer.alloc(44 + d.length * 2)
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + d.length * 2, 4); pcm.write('WAVEfmt ', 8)
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(sr, 24)
  pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(d.length * 2, 40)
  for (let i = 0; i < d.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, d[i])) * 32000), 44 + i * 2)
  writeFileSync(`${out}/${o.id}.wav`, pcm)
  // spectral centroid over first 300 ms (crude DFT bins)
  let num = 0, den = 0
  const N = Math.min(d.length, Math.floor(0.3 * sr))
  for (let f = 50; f < 6000; f *= 1.12) {
    let re = 0, im = 0
    for (let i = 0; i < N; i += 2) { re += d[i] * Math.cos((2 * Math.PI * f * i) / sr); im += d[i] * Math.sin((2 * Math.PI * f * i) / sr) }
    const mag = Math.hypot(re, im); num += mag * f; den += mag
  }
  console.log(o.id.padEnd(11), 'centroid', Math.round(num / den), 'Hz', 'dur', (d.length / sr).toFixed(2), 's')
}
