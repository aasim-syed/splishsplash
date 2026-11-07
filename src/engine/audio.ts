import type { SplashSound } from './objects'

// Procedural splash audio. Each object family gets its own physically-motivated voice:
//  plunk  – cavity-collapse bubble ring (rising sine chirp) over a short wash: rocks, cannonball
//  boom   – deep displacement thump + long rumbling wash: boulder
//  slap   – broadband crack from a flat face hitting the surface (trapped-air pop): crate, log
//  thunk  – heavy slap with a low body: anvil
//  bonk   – hollow resonant knock of an air-filled shell + slap: barrel
//  pat    – soft, short, muted tap: beach ball
//  splat  – wet squelch with crunchy crackle (fruit bursting): watermelon
//  clink  – bright glassy pings + crisp slap: ice
let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null
let master: GainNode | null = null
let verb: ConvolverNode | null = null

function ensure() {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.8
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    master.connect(comp).connect(ctx.destination)
    noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    // short outdoor reflection off the cliff
    verb = ctx.createConvolver()
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.6, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c)
      for (let i = 0; i < ch.length; i++) {
        const t = i / ctx.sampleRate
        ch[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.2) * (t > 0.09 ? 1 : 0.15)
      }
    }
    verb.buffer = ir
    const vg = ctx.createGain()
    vg.gain.value = 0.22
    verb.connect(vg).connect(master)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function unlockAudio() { ensure() }

type Ctx = { c: AudioContext; out: AudioNode; now: number; rate: number }

function env(c: AudioContext, t0: number, peak: number, attack: number, decay: number) {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay)
  return g
}

function noiseBurst(x: Ctx, opts: { type: BiquadFilterType; f0: number; f1: number; q?: number; peak: number; attack: number; decay: number; delay?: number }) {
  const { c, out, now, rate } = x
  const t0 = now + (opts.delay ?? 0) / rate
  const src = c.createBufferSource()
  src.buffer = noise
  src.playbackRate.value = rate
  const f = c.createBiquadFilter()
  f.type = opts.type
  f.Q.value = opts.q ?? 0.7
  f.frequency.setValueAtTime(opts.f0 * rate, t0)
  f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.f1 * rate), t0 + (opts.attack + opts.decay) / rate)
  const g = env(c, t0, opts.peak, opts.attack / rate, opts.decay / rate)
  src.connect(f).connect(g).connect(out)
  src.start(t0, Math.random() * 1.5)
  src.stop(t0 + (opts.attack + opts.decay) / rate + 0.05)
}

function tone(x: Ctx, opts: { type?: OscillatorType; f0: number; f1: number; peak: number; attack: number; decay: number; delay?: number }) {
  const { c, out, now, rate } = x
  const t0 = now + (opts.delay ?? 0) / rate
  const o = c.createOscillator()
  o.type = opts.type ?? 'sine'
  o.frequency.setValueAtTime(opts.f0 * rate, t0)
  o.frequency.exponentialRampToValueAtTime(opts.f1 * rate, t0 + (opts.attack + opts.decay) / rate)
  const g = env(c, t0, opts.peak, opts.attack / rate, opts.decay / rate)
  o.connect(g).connect(out)
  o.start(t0)
  o.stop(t0 + (opts.attack + opts.decay) / rate + 0.05)
}

export function playSplash(kind: SplashSound, energy: number, radius: number, speed: number, flat: number, secondary: boolean, rate = 1) {
  const c = ensure()
  if (!noise || !master || !verb) return
  const out = c.createGain()
  out.connect(master)
  out.connect(verb)
  const x: Ctx = { c, out, now: c.currentTime + 0.005, rate }
  const loud = Math.min(1, Math.log10(1 + energy) / 6.2) * 0.9 + 0.08
  const r = Math.max(0.1, radius)
  // resonant bubble frequency (Minnaert): f ≈ 3.26 / r  (r in m)
  const minnaert = Math.min(1800, 3.26 / (r * 0.35)) * (0.85 + Math.min(0.4, speed / 60))
  const wash = (amt: number, len: number, bright = 1) =>
    noiseBurst(x, { type: 'lowpass', f0: 4200 * bright / (0.6 + r), f1: 300, peak: loud * amt, attack: 0.01, decay: len, delay: 0.02 })

  if (secondary) {
    tone(x, { f0: minnaert * 0.8, f1: minnaert * 1.7, peak: loud * 0.4, attack: 0.008, decay: 0.12 })
    noiseBurst(x, { type: 'bandpass', f0: 2500, f1: 900, q: 1.2, peak: loud * 0.25, attack: 0.005, decay: 0.35 })
    return
  }
  switch (kind) {
    case 'plunk':
      noiseBurst(x, { type: 'highpass', f0: 2500, f1: 1200, peak: loud * 0.35, attack: 0.002, decay: 0.05 })
      tone(x, { f0: minnaert * 0.55, f1: minnaert * 1.5, peak: loud * 0.55, attack: 0.006, decay: 0.16, delay: 0.015 })
      wash(0.55, 0.5 + r * 0.6)
      break
    case 'boom':
      tone(x, { f0: 90, f1: 38, peak: loud * 0.9, attack: 0.01, decay: 0.7 })
      noiseBurst(x, { type: 'lowpass', f0: 900, f1: 120, peak: loud * 0.9, attack: 0.015, decay: 1.6 })
      wash(0.7, 2.2, 0.7)
      noiseBurst(x, { type: 'bandpass', f0: 1800, f1: 600, q: 0.6, peak: loud * 0.45, attack: 0.2, decay: 2.2, delay: 0.25 }) // falling spray
      break
    case 'slap':
      noiseBurst(x, { type: 'highpass', f0: 1400 - 600 * flat, f1: 700, peak: loud * (0.7 + 0.5 * flat), attack: 0.001, decay: 0.07 + 0.05 * flat })
      noiseBurst(x, { type: 'bandpass', f0: 700, f1: 260, q: 0.9, peak: loud * 0.55, attack: 0.004, decay: 0.25 })
      wash(0.5, 0.9 + 0.4 * flat)
      break
    case 'thunk':
      noiseBurst(x, { type: 'highpass', f0: 900, f1: 500, peak: loud * 0.8, attack: 0.001, decay: 0.08 })
      tone(x, { f0: 140, f1: 55, peak: loud * 0.7, attack: 0.004, decay: 0.35 })
      tone(x, { f0: minnaert * 0.5, f1: minnaert * 1.2, peak: loud * 0.3, attack: 0.01, decay: 0.2, delay: 0.03 })
      wash(0.55, 1.0, 0.8)
      break
    case 'bonk':
      noiseBurst(x, { type: 'bandpass', f0: 210, f1: 180, q: 9, peak: loud * 1.4, attack: 0.002, decay: 0.32 })
      tone(x, { type: 'triangle', f0: 190, f1: 150, peak: loud * 0.4, attack: 0.002, decay: 0.25 })
      noiseBurst(x, { type: 'highpass', f0: 1600, f1: 800, peak: loud * 0.45, attack: 0.001, decay: 0.05 })
      wash(0.4, 0.7)
      break
    case 'pat':
      noiseBurst(x, { type: 'bandpass', f0: 900, f1: 500, q: 1.5, peak: loud * 0.45, attack: 0.002, decay: 0.08 })
      tone(x, { f0: 330, f1: 260, peak: loud * 0.18, attack: 0.002, decay: 0.09 })
      wash(0.15, 0.25, 0.6)
      break
    case 'splat':
      noiseBurst(x, { type: 'bandpass', f0: 1300, f1: 450, q: 2.2, peak: loud * 1.1, attack: 0.002, decay: 0.18 })
      for (let i = 0; i < 9; i++) // crunchy crackle of rind & pulp
        noiseBurst(x, { type: 'highpass', f0: 2500 + Math.random() * 3000, f1: 1500, peak: loud * (0.25 + Math.random() * 0.3), attack: 0.001, decay: 0.015 + Math.random() * 0.02, delay: Math.random() * 0.09 })
      wash(0.45, 0.6)
      break
    case 'clink':
      noiseBurst(x, { type: 'highpass', f0: 3000, f1: 1800, peak: loud * 0.6, attack: 0.001, decay: 0.04 })
      for (let i = 0; i < 4; i++) {
        const f = 2200 + Math.random() * 2600
        tone(x, { f0: f, f1: f * 0.98, peak: loud * (0.08 + Math.random() * 0.1), attack: 0.001, decay: 0.25 + Math.random() * 0.4, delay: Math.random() * 0.06 })
      }
      noiseBurst(x, { type: 'bandpass', f0: 800, f1: 300, q: 0.9, peak: loud * 0.45, attack: 0.003, decay: 0.25 })
      wash(0.5, 0.9, 1.2)
      break
  }
}
