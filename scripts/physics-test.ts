import { Engine } from '../src/engine/engine'
const e = await Engine.create()
const impacts: any[] = []
e.onImpact = (i) => impacts.push(i)
const targets: [string, number, number][] = [
  ['rock', 20, 0], ['cannonball', 30, 10], ['crate', 25, -8], ['beachball', 18, 5],
  ['barrel', 22, 12], ['anvil', 28, -12], ['ice', 16, -3], ['melon', 24, 3], ['log', 26, 18], ['boulder', 30, -20],
]
const t0 = performance.now()
for (const [id, x, z] of targets) {
  const sol = e.throwAt(id, x, z, 28, 1, 2)!
  console.log(id.padEnd(10), 'v0', Math.hypot(...sol.velocity).toFixed(1), 'reachable', sol.reachable)
}
// record landing points
const landed = new Map<number, [number, number]>()
for (let s = 0; s < 120 * 25; s++) {
  e.update(1 / 120)
  for (const b of e.bodies) if (b.submerged > 0.004 && !landed.has(b.id)) { const t = b.rb.translation(); landed.set(b.id, [t.x, t.z]) }
}
const ms = performance.now() - t0
e.bodies.forEach((b) => {
  const tg = targets.find((q) => q[0] === b.def.id)!
  const t = b.rb.translation(); const [tx, , tz] = [tg[1], 0, tg[2]]
  const l = landed.get(b.id)
  console.log(b.def.id.padEnd(10), 'land err', l ? Math.hypot(l[0] - tx, l[1] - tz).toFixed(2) : '-', 'y', t.y.toFixed(2), 'sub', b.submerged.toFixed(2), 'expected', Math.min(1, b.def.density / 1000).toFixed(2), 'v', Math.hypot(b.rb.linvel().x, b.rb.linvel().y, b.rb.linvel().z).toFixed(2))
})
let mx = 0; for (const h of e.water.h) mx = Math.max(mx, Math.abs(h))
console.log('impacts', impacts.map((i) => `${i.label}:${i.speed.toFixed(1)}m/s peak ${e.splashPeak(i.splashId).toFixed(1)}m`).join(' | '))
console.log('max |h| after 25s', mx.toFixed(3), 'particles', e.particles.count, 'sim ms/s', (ms / 25).toFixed(1))
