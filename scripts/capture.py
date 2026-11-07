import asyncio, base64, json, time, math, sys
from playwright.async_api import async_playwright
FPS = 24
OUT = '/tmp/cap'
events, patters = [], []
frame_no = 0

def lerp(a, b, t): return [a[i] + (b[i] - a[i]) * t for i in range(3)]
def ease(t): return t * t * (3 - 2 * t)

async def main():
    global frame_no
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':1280,'height':720})
        pg.set_default_timeout(600000)
        await pg.goto('http://localhost:4173/?capture')
        await pg.wait_for_function("() => window.__engine && window.__frame && window.__rig", timeout=300000)
        await pg.evaluate("""() => {
          const e = window.__engine
          window.__ev = []
          e.onSplashSound = (p) => window.__ev.push({ t: e.simTime, p })
          window.__step = (simDt) => {
            e.__acc = (e.__acc || 0) + simDt
            while (e.__acc >= 1/120) { e.paused = false; e.timeScale = 1; e.update(1/120); e.paused = true; e.__acc -= 1/120 }
          }
          window.__cam = (pos, tgt) => { const { camera, controls } = window.__rig; camera.position.set(...pos); controls.target.set(...tgt); controls.update() }
        }""")
        async def season(s):
            await pg.evaluate(f"() => window.__store.getState().set({{ season: '{s}' }})")
            await pg.evaluate("() => window.__frame()"); await pg.evaluate("() => window.__frame()")
        async def js(code): return await pg.evaluate(code)
        async def prerun(sec):
            await js(f"() => {{ for (let i = 0; i < {int(sec*120)}; i++) window.__step(1/120) }}")
        async def shot(n, ts, cam_from, cam_to, tgt_from, tgt_to, label):
            global frame_no
            for i in range(n):
                t = ease(i / max(1, n - 1))
                pos, tgt = lerp(cam_from, cam_to, t), lerp(tgt_from, tgt_to, t)
                vt = frame_no / FPS
                res = await js(f"""async () => {{
                  const e = window.__engine
                  window.__ev = []
                  window.__step({ts / FPS})
                  const P = e.particles; const landed = P.landed, lr = P.landedR; P.landed = 0; P.landedR = 0
                  window.__cam({json.dumps(pos)}, {json.dumps(tgt)})
                  await window.__frame()
                  return {{ img: document.querySelector('canvas').toDataURL('image/jpeg', 0.93), ev: window.__ev, landed, lr }}
                }}""")
                open(f'{OUT}/frames/f{frame_no:05d}.jpg', 'wb').write(base64.b64decode(res['img'].split(',')[1]))
                for e in res['ev']: events.append({ 't': vt, 'rate': max(0.35, ts ** 0.5), 'p': e['p'] })
                if res['landed'] > 0: patters.append({ 't': vt, 'n': res['landed'], 'r': res['lr'] / res['landed'], 'rate': max(0.35, ts ** 0.5), 'storm': label == 'storm' })
                frame_no += 1
                if frame_no % 10 == 0:
                    print(f'{label} frame {frame_no} {time.strftime("%H:%M:%S")}', flush=True)
                    json.dump({ 'events': events, 'patters': patters, 'frames': frame_no, 'segments': SEG }, open(f'{OUT}/events.json', 'w'))
        SEG = []
        def seg(label): SEG.append({ 'label': label, 'start': frame_no / FPS })

        # A — golden hour: boulder + crate, real time, slow push-in
        seg('golden')
        await season('golden')
        await js("() => { const e = window.__engine; e.clear(); e.throwAt('boulder', 22, -6, 28, 1, 1.5) }")
        await prerun(0.6)
        await js("() => window.__engine.throwAt('crate', 15, -13, 30, 1.4, 2)")
        await prerun(0.9)
        await shot(84, 1.0, [42, 11.5, 42], [34, 9.5, 32], [10, 6, -16], [13, 5, -11], 'golden')

        # B — slow-mo cannonball jet, low camera at the waterline
        seg('slowmo')
        await js("() => { const e = window.__engine; e.clear(); window.__b = e.throwAt('cannonball', 24, 4, 32, 1.8, 0) }")
        await js("() => { const e = window.__engine; for (let i = 0; i < 2000; i++) { window.__step(1/120); const b = e.bodies[0]; if (!b || b.rb.translation().y < 4.5) break } }")
        await shot(108, 0.2, [33.5, 2.0, 15], [32.5, 2.3, 13], [24, 2.2, 4], [24, 3.0, 4], 'slowmo')

        # C — autumn storm barrage, wide
        seg('storm')
        await season('autumn')
        await js("""() => { const e = window.__engine; e.clear()
          const ids = ['rock','barrel','log','crate','boulder','anvil','ice','barrel','rock']
          ids.forEach((id, i) => e.schedule(i * 0.16, () => e.throwAt(id, 12 + (i * 37 % 30), -24 + (i * 23 % 44), 26 + (i % 3) * 6, 1, 3))) }""")
        await prerun(1.9)
        await shot(72, 1.0, [52, 24, 46], [47, 21, 40], [14, 1, -4], [15, 1, -3], 'storm')

        # D — winter: log lands flat + crate slap, 0.4×
        seg('winter')
        await season('winter')
        await js("() => { const e = window.__engine; e.clear(); e.throwAt('log', 18, -2, 22, 1.2, 0.3); e.throwAt('crate', 25, 6, 24, 1.5, 0) }")
        await js("() => { const e = window.__engine; for (let i = 0; i < 2000; i++) { window.__step(1/120); const ys = e.bodies.map(b => b.rb.translation().y); if (Math.min(...ys) < 6) break } }")
        await shot(66, 0.4, [38, 6.5, 22], [36, 6, 19], [18, 2.5, -1], [20, 2.5, 1], 'winter')

        # E — sunset: watermelon bursts in slow motion, then hold on the sun
        seg('dusk')
        await season('dusk')
        await js("() => { const e = window.__engine; e.clear(); e.throwAt('melon', 22, -4, 34, 2.0, 2) }")
        await js("() => { const e = window.__engine; for (let i = 0; i < 2000; i++) { window.__step(1/120); const b = e.bodies[0]; if (!b || b.rb.translation().y < 5) break } }")
        await shot(60, 0.25, [30, 3.2, 10], [29, 3.6, 8], [21, 2.5, -4], [21, 3.5, -5], 'dusk')
        await shot(30, 1.0, [29, 3.6, 8], [29, 4.5, 7], [21, 3.5, -5], [16, 6, -14], 'dusk')

        json.dump({ 'events': events, 'patters': patters, 'frames': frame_no, 'segments': SEG }, open(f'{OUT}/events.json', 'w'))
        print('DONE', frame_no, flush=True)
        await b.close()
asyncio.run(main())
