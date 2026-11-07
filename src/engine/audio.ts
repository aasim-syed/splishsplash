import type { SplashSound } from './objects'

/**
 * Physically based liquid sound (after van den Doel, "Physically-based models for liquid
 * sounds", 2005). Almost everything you hear in a splash is air bubbles ringing at their
 * Minnaert frequency  f₀ ≈ 3.26 / r  (r in m), decaying with
 * d ≈ 0.13·f₀ + 0.0072·f₀^1.5  and chirping upward as they rise:  f(t) = f₀ (1 + ξ·d·t).
 *
 * A splash = (impact transient) + (cavity bubble "plunk") + (cloud of entrained bubbles,
 * power-law sized) + (pinch-off bubble when the cavity collapses) + (spray patter — every
 * droplet the simulation lands back in the sea entrains its own tiny bubble).
 * Buffers are synthesised per splash from the object's real size, speed, flatness & density.
 */
let ctx: AudioContext | null = null
let master: GainNode | null = null
let verbIn: GainNode | null = null
let pingBank: AudioBuffer[] = []

function ensure() {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.9
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.ratio.value = 3.5
    comp.attack.value = 0.003
    master.connect(comp).connect(ctx.destination)
    // outdoor slapback off the cliff + short diffuse tail
    const verb = ctx.createConvolver()
    const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 1.4), ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c)
      for (let i = 0; i < ch.length; i++) {
        const t = i / ctx.sampleRate
        const slap = Math.abs(t - 0.14 - c * 0.006) < 0.004 ? 0.5 : 0
        ch[i] = ((Math.random() * 2 - 1) * Math.exp(-t * 4.5) * (t > 0.02 ? 0.35 : 0) + slap * (Math.random() * 2 - 1))
      }
    }
    verb.buffer = ir
    verbIn = ctx.createGain()
    verbIn.gain.value = 0.25
    verbIn.connect(verb).connect(master)
    // bank of small-droplet bubble pings for spray patter (r ≈ 0.6–3.5 mm)
    pingBank = Array.from({ length: 28 }, (_, i) => {
      const r = 0.0006 + (i / 27) ** 1.5 * 0.003
      return render(ctx!, 0.06, (out, sr) => bubble(out, sr, 0, r, 1))
    })
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function unlockAudio() { ensure() }

function render(c: AudioContext, seconds: number, fn: (out: Float32Array, sr: number) => void) {
  const sr = c.sampleRate
  const buf = c.createBuffer(1, Math.max(1, Math.floor(seconds * sr)), sr)
  const out = buf.getChannelData(0)
  fn(out, sr)
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak
  return buf
}

/** One Minnaert bubble: damped, upward-chirping sinusoid. */
function bubble(out: Float32Array, sr: number, t0: number, r: number, amp: number, xi = 0.1) {
  const f0 = Math.min(9000, 3.26 / r)
  const d = 0.13 * f0 + 0.0072 * Math.pow(f0, 1.5)
  const start = Math.floor(t0 * sr)
  const len = Math.min(out.length - start, Math.floor((7 / d) * sr))
  let phase = 0
  for (let i = 0; i < len; i++) {
    const t = i / sr
    const f = f0 * (1 + xi * d * t)
    phase += (2 * Math.PI * f) / sr
    // soft 1 ms onset avoids clicks
    const on = Math.min(1, t * 1000)
    out[start + i] += amp * on * Math.exp(-d * t) * Math.sin(phase)
  }
}

/** Short band-limited impact transient (one-pole filtered noise). */
function transient(out: Float32Array, sr: number, t0: number, dur: number, amp: number, cutoff: number) {
  const start = Math.floor(t0 * sr)
  const len = Math.min(out.length - start, Math.floor(dur * sr))
  const a = Math.exp((-2 * Math.PI * cutoff) / sr)
  let y = 0
  for (let i = 0; i < len; i++) {
    const t = i / len
    y = (1 - a) * (Math.random() * 2 - 1) + a * y
    out[start + i] += amp * y * Math.exp(-t * 5) * 3
  }
}

/** power-law bubble radius in [rMin, rMax] (more small than large) */
const radius = (rMin: number, rMax: number, k = 2.2) => {
  const u = Math.random()
  const a = Math.pow(rMin, 1 - k), b = Math.pow(rMax, 1 - k)
  return Math.pow(a + u * (b - a), 1 / (1 - k))
}

export interface SplashAudio {
  kind: SplashSound
  energy: number
  radius: number // equivalent-sphere radius of the body (m)
  speed: number // vertical entry speed (m/s)
  flat: number // 0..1 face-on slap
  density: number // kg/m³
  jet: boolean
}

export function playSplash(p: SplashAudio, rate = 1) {
  const c = ensure()
  if (!master || !verbIn) return
  const loud = Math.min(1, 0.12 + Math.log10(1 + p.energy) / 6.5)

  const data = synthSplash(p, c.sampleRate)
  const buf = c.createBuffer(1, data.length, c.sampleRate)
  buf.getChannelData(0).set(data)
  const src = c.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate
  const g = c.createGain()
  g.gain.value = loud
  src.connect(g)
  g.connect(master)
  g.connect(verbIn)
  src.start()
}

/**
 * Spray patter: called every frame with how many droplets the simulation just landed back
 * in the sea. Each one entrains a tiny bubble; we play a capped random subset with jitter.
 */
export function patter(count: number, meanRadius: number, rate = 1) {
  if (!ctx || !master || count <= 0 || !pingBank.length) return
  const n = Math.min(14, Math.ceil(Math.sqrt(count) * 1.4))
  const gain = Math.min(0.5, 0.04 + 0.012 * Math.sqrt(count))
  const sizeBias = Math.min(1, meanRadius / 0.012)
  for (let i = 0; i < n; i++) {
    const idx = Math.max(0, Math.min(pingBank.length - 1, Math.floor((Math.random() * 0.7 + sizeBias * 0.3) * pingBank.length)))
    const s = ctx.createBufferSource()
    s.buffer = pingBank[idx]
    s.playbackRate.value = rate * (0.9 + Math.random() * 0.2)
    const g = ctx.createGain()
    g.gain.value = gain * (0.4 + Math.random() * 0.6)
    s.connect(g).connect(master)
    s.start(ctx.currentTime + Math.random() * 0.016)
  }
}

/** Pure synthesis (usable offline): normalised mono samples for one splash. */
export function synthSplash(p: SplashAudio, sr: number): Float32Array {
  const R = Math.max(0.08, p.radius)
  const heavy = Math.min(1.3, Math.sqrt(p.density / 1000))
  const dur = 0.9 + 1.4 * Math.min(1, R) + (p.kind === 'boom' ? 1.2 : 0)
  const out = new Float32Array(Math.floor(dur * sr))
    // 1) impact: a flat face traps air → sharp broadband crack; spheres → soft thud
    const crack = 0.25 + 0.9 * p.flat + (p.kind === 'pat' ? -0.15 : 0)
    transient(out, sr, 0, 0.012 + 0.02 * p.flat + 0.02 * R, crack, 1800 + 4000 * p.flat)
    if (R > 0.5 || p.kind === 'boom' || p.kind === 'thunk') transient(out, sr, 0, 0.12 + 0.1 * R, 0.6 * heavy, 140) // low body thump

    // 2) cavity bubble: the iconic "plunk" — bigger, faster, denser bodies → deeper & louder
    if (p.kind !== 'pat') {
      const rc = (0.004 + 0.011 * R) * (1 + 0.15 * Math.random())
      bubble(out, sr, 0.015 + 0.01 * R, rc, 0.9 * heavy * (1 - 0.6 * p.flat), 0.12)
    }

    // 3) entrained bubble cloud — flat slaps & big bodies entrain far more air
    const n = Math.floor((30 + 140 * R + 260 * p.flat) * Math.min(1.5, p.speed / 15) * (p.kind === 'pat' ? 0.25 : 1))
    const rMax = 0.002 + 0.006 * Math.min(1.5, R) * (1 + p.flat)
    for (let i = 0; i < n; i++) {
      const t = Math.abs((Math.random() + Math.random() - 1)) * (0.05 + 0.25 * R)
      bubble(out, sr, 0.005 + t, radius(0.0006, rMax), (0.25 + 0.35 * Math.random()) * (0.4 + 0.6 * Math.random()))
    }

    // 4) pinch-off bubble when the cavity seals & the jet fires
    if (p.jet) {
      const tj = 0.12 + 0.22 * Math.sqrt(R) + 0.004 * p.speed
      bubble(out, sr, tj, (0.003 + 0.007 * R), 0.7 * heavy, 0.15)
      for (let i = 0; i < 25 + 60 * R; i++) bubble(out, sr, tj + Math.random() * 0.08, radius(0.0007, 0.003), 0.25)
    }

    // 5) fruit: wet crunch of rind breaking (short clicks) before the water
    if (p.kind === 'splat') for (let i = 0; i < 14; i++) transient(out, sr, Math.random() * 0.05, 0.003, 0.5, 6000)
    // ice: crystalline micro-fractures
    if (p.kind === 'clink') for (let i = 0; i < 8; i++) bubble(out, sr, Math.random() * 0.12, radius(0.0004, 0.0009), 0.2, 0.02)
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak
  // fade tail
  const fade = Math.floor(0.05 * sr)
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade
  return out
}

/** Pure synthesis of one small-droplet bubble ping (spray patter). */
export function synthPing(r: number, sr: number): Float32Array {
  const out = new Float32Array(Math.floor(0.06 * sr))
  bubble(out, sr, 0, r, 1)
  return out
}
