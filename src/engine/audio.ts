// Procedural splash audio: filtered noise burst + a low "plunk" for the cavity.
let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null
let master: GainNode | null = null

function ensure() {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.7
    master.connect(ctx.destination)
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = noise.getChannelData(0)
    let b = 0
    for (let i = 0; i < d.length; i++) {
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1) // slightly pink
      d[i] = b * 6 + (Math.random() * 2 - 1) * 0.25
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function unlockAudio() { ensure() }

export function playSplash(energy: number, radius: number, speed: number, rate = 1) {
  const c = ensure()
  if (!noise || !master) return
  const now = c.currentTime
  const loud = Math.min(1, Math.log10(1 + energy) / 5.5)
  const dur = (0.35 + radius * 0.9 + loud * 0.6) / Math.max(rate, 0.25)
  // body: noise through lowpass that closes over time
  const src = c.createBufferSource()
  src.buffer = noise
  src.playbackRate.value = rate
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  const f0 = 5200 / (0.6 + radius) * rate
  lp.frequency.setValueAtTime(f0, now)
  lp.frequency.exponentialRampToValueAtTime(Math.max(180, f0 * 0.12), now + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, now)
  g.gain.exponentialRampToValueAtTime(0.9 * loud + 0.05, now + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  src.connect(lp).connect(g).connect(master)
  src.start(now, Math.random())
  src.stop(now + dur + 0.05)
  // plunk: resonant air cavity closing
  const o = c.createOscillator()
  const og = c.createGain()
  const f = (Math.min(900, 220 / (radius + 0.08)) + speed * 4) * rate
  o.frequency.setValueAtTime(f * 0.6, now)
  o.frequency.exponentialRampToValueAtTime(f * 1.6, now + 0.12 / rate)
  og.gain.setValueAtTime(0.0001, now)
  og.gain.exponentialRampToValueAtTime(0.25 * loud + 0.02, now + 0.02)
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.25 / rate)
  o.connect(og).connect(master)
  o.start(now)
  o.stop(now + 0.3 / rate)
}
