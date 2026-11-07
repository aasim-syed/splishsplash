# splishsplash

Throw things off a chalk cliff and watch them splash. Built with React, Vite, shadcn/ui, Three.js (R3F) and Rapier.

```bash
npm install
npm run dev            # http://localhost:5173
npm run build
npm run test:physics   # headless check: landing accuracy and float depth vs density
```

## Controls
Click the sea to throw · drag to orbit · `1–0` pick object · `Space` barrage · `S` slow‑mo · `V` camera · `T` season/time · `P` pause · `C` clear

Seasons: summer golden hour, summer midday, spring morning, autumn storm (bigger swell, choppier sea), winter (snow, low sun), sunset.
Every object has its own splash and sound: orientation-aware slaps for flat faces, line splashes for logs, tall narrow jets for cannonballs, bursting watermelons.

## Physics
| Layer | Model |
|---|---|
| Rigid bodies | Rapier 3D, fixed 120 Hz step, CCD on all bodies, real densities (kg/m³) |
| Aiming | Shooting + bisection on the same integrator Rapier uses, including quadratic air drag, so the dashed arc is the true path |
| Air | Quadratic drag ½ρCdA·v² on the dry fraction of each body |
| Buoyancy | Each body is split into 32–64 volume cells. Archimedes force is applied per cell at its world point, so torque and righting come out naturally |
| Hydrodynamic drag | Per‑cell quadratic + linear damping against the local water velocity, implicitly limited (with added mass) so it never overshoots |
| Water surface | 256² height field, wave equation with shallow‑water speed √(g·depth) (shoals near the cliff), reflective land, absorbing sponge at open edges |
| Two‑way coupling | Each step a body displaces exactly the volume it newly submerges, which forms the impact crater, the rings, bobbing ripples and wakes |
| Splash | Crown sheet + mist at impact, plus a delayed Worthington jet when the cavity collapses. Scaled by impact speed, size and density |
| Water rendering | Refraction pre-pass (colour + depth) → Beer–Lambert absorption by true ray thickness; planar mirror pass (oblique clip) for cliff/stack reflections; sky cubemap fallback; wind-aligned 16-component chop |
| Sound | Physically based liquid audio (van den Doel): Minnaert bubbles f₀≈3.26/r with rising chirp, power-law entrained-bubble clouds, cavity & pinch-off bubbles, impact transients scaled by face flatness; spray patter driven by every simulated droplet that lands. `npm run sfx <dir>` renders each object's splash to WAV |
| Spray | 40k droplets with physical radii (terminal velocity from drag). Each droplet that lands punches its own small crater, which gives the secondary ripples |

Floating depth at rest matches ρ_body/ρ_water (crate 0.48, barrel 0.32, log 0.64, ice 0.91).

## Layout
```
src/engine/   terrain.ts  water.ts  particles.ts  objects.ts  engine.ts  audio.ts
src/scene/    World.tsx  waterMaterial.ts  meshes.ts
src/components/  Hud.tsx  ui/ (shadcn: button, card, slider, switch, badge, separator)
```
