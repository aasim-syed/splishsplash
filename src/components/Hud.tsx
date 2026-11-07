import { useEffect, useState } from 'react'
import { Bird, Crosshair, Sun, Pause, PersonStanding, Ship, Play, RotateCcw, SlidersHorizontal, Sparkles, Timer, Volume2, VolumeX } from 'lucide-react'
import type { Engine } from '@/engine/engine'
import { OBJECTS, OBJECT_MAP, volumeOf } from '@/engine/objects'
import { useStore } from '@/store'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SEASONS, type SeasonId } from '@/scene/atmosphere'

const glass = 'border border-white/10 bg-neutral-950/35 backdrop-blur-xl shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)]'

const fmtMass = (m: number) => (m < 1000 ? `${m.toFixed(m < 10 ? 1 : 0)} kg` : `${(m / 1000).toFixed(m < 1e4 ? 2 : 1)} t`)
const fmtEnergy = (e: number) =>
  e >= 1e6 ? [(e / 1e6).toFixed(2), 'MJ'] : e >= 1000 ? [(e / 1000).toFixed(1), 'kJ'] : [e.toFixed(0), 'J']

function IconButton({
  label, kbd, active, onClick, children,
}: { label: string; kbd?: string; active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'grid size-10 place-items-center rounded-xl text-white/70 transition hover:bg-white/10 hover:text-white [&_svg]:size-[18px]',
            active && 'bg-white/15 text-white',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label}
        {kbd && <kbd className="ml-2 rounded border border-white/15 px-1 font-mono text-[10px] text-white/60">{kbd}</kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

export function Dock({ engine, onBarrage }: { engine: Engine; onBarrage: () => void }) {
  const s = useStore()
  const [paused, setPaused] = useState(false)
  return (
    <TooltipProvider>
      <div className={cn('absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl p-1.5 select-none', glass)}>
        {OBJECTS.map((o, i) => {
          const mass = o.density * volumeOf(o, s.scale)
          const active = s.selected === o.id
          return (
            <Tooltip key={o.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => s.set({ selected: o.id })}
                  className={cn(
                    'relative grid size-12 place-items-center rounded-xl transition',
                    active ? 'bg-white/[0.14] ring-1 ring-white/40' : 'hover:bg-white/[0.07]',
                  )}
                >
                  {s.thumbs[o.id] ? (
                    <img src={s.thumbs[o.id]} alt={o.label} className={cn('size-10 transition', !active && 'opacity-80')} draggable={false} />
                  ) : (
                    <span className="size-6 rounded-full bg-white/10" />
                  )}
                  <span className="absolute right-1 top-0.5 font-mono text-[9px] text-white/35">{(i + 1) % 10}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="space-y-0.5">
                <div className="font-medium">{o.label}</div>
                <div className="font-mono text-[10px] text-white/60">
                  {fmtMass(mass)} · ρ {o.density} · {o.density < 1000 ? `floats ${Math.round(o.density / 10)}% under` : 'sinks'}
                </div>
              </TooltipContent>
            </Tooltip>
          )
        })}
        <div className="mx-1.5 h-8 w-px bg-white/10" />
        <IconButton label="Thrower's view (cliff top)" kbd="V" active={s.view === 'edge'} onClick={() => s.set({ view: 'edge' })}><PersonStanding /></IconButton>
        <IconButton label="View from the sea" kbd="V" active={s.view === 'sea'} onClick={() => s.set({ view: 'sea' })}><Ship /></IconButton>
        <IconButton label="Aerial" kbd="V" active={s.view === 'aerial'} onClick={() => s.set({ view: 'aerial' })}><Bird /></IconButton>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button className="grid size-10 place-items-center rounded-xl text-white/70 transition hover:bg-white/10 hover:text-white data-[state=open]:bg-white/15 data-[state=open]:text-white [&_svg]:size-[18px]">
                  <Sun />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">Season & time <kbd className="ml-2 rounded border border-white/15 px-1 font-mono text-[10px] text-white/60">T</kbd></TooltipContent>
          </Tooltip>
          <PopoverContent side="top" align="center" className="w-64 p-2">
            <div className="px-2 pb-2 pt-1 text-[10px] uppercase tracking-[0.18em] text-white/45">Season & light</div>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(SEASONS) as SeasonId[]).map((id) => {
                const a = SEASONS[id]
                return (
                  <button
                    key={id}
                    onClick={() => s.set({ season: id })}
                    className={cn(
                      'group overflow-hidden rounded-lg border text-left transition',
                      s.season === id ? 'border-white/50' : 'border-white/10 hover:border-white/25',
                    )}
                  >
                    <div className="h-10" style={{ background: `linear-gradient(160deg, ${a.swatch[0]}, ${a.swatch[1]})` }} />
                    <div className="px-2 py-1.5">
                      <div className="text-xs text-white">{a.label}</div>
                      <div className="text-[10px] text-white/50">{a.sub}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
        <div className="mx-1.5 h-8 w-px bg-white/10" />
        <IconButton label="Barrage" kbd="Space" onClick={onBarrage}><Sparkles /></IconButton>
        <IconButton label="Slow motion" kbd="S" active={s.timeScale < 1} onClick={() => s.set({ timeScale: s.timeScale < 1 ? 1 : 0.2 })}>
          <Timer />
        </IconButton>
        <IconButton label="Follow throws" active={s.track} onClick={() => s.set({ track: !s.track })}><Crosshair /></IconButton>
        <IconButton label={paused ? 'Resume' : 'Pause'} kbd="P" onClick={() => { engine.paused = !engine.paused; setPaused(engine.paused) }}>
          {paused ? <Play /> : <Pause />}
        </IconButton>
        <IconButton label="Reset sea" kbd="C" onClick={() => engine.clear()}><RotateCcw /></IconButton>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button className="grid size-10 place-items-center rounded-xl text-white/70 transition hover:bg-white/10 hover:text-white data-[state=open]:bg-white/15 data-[state=open]:text-white [&_svg]:size-[18px]">
                  <SlidersHorizontal />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">Launch settings</TooltipContent>
          </Tooltip>
          <PopoverContent side="top" align="end" className="space-y-5">
            <Setting label="Elevation" value={`${s.angle}°`}>
              <Slider min={0} max={70} step={1} value={[s.angle]} onValueChange={([v]) => s.set({ angle: v })} />
            </Setting>
            <Setting label="Scale" value={`${s.scale.toFixed(2)}×`}>
              <Slider min={0.4} max={2.5} step={0.05} value={[s.scale]} onValueChange={([v]) => s.set({ scale: v })} />
            </Setting>
            <Setting label="Spin" value={`${s.spin.toFixed(1)} rad/s`}>
              <Slider min={0} max={12} step={0.5} value={[s.spin]} onValueChange={([v]) => s.set({ spin: v })} />
            </Setting>
            <Setting label="Time" value={s.timeScale === 1 ? '1.00×' : `${s.timeScale.toFixed(2)}×`}>
              <Slider min={0.05} max={1} step={0.05} value={[s.timeScale]} onValueChange={([v]) => s.set({ timeScale: v })} />
            </Setting>
            <div className="flex items-center justify-between border-t border-white/10 pt-4 text-xs text-white/70">
              <label className="flex items-center gap-2"><Switch checked={s.showArc} onCheckedChange={(v) => s.set({ showArc: v })} /> Trajectory</label>
              <label className="flex items-center gap-2">
                <Switch checked={s.sound} onCheckedChange={(v) => s.set({ sound: v })} />
                {s.sound ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
              </label>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  )
}

function Setting({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-[0.14em] text-white/50">{label}</span>
        <span className="font-mono text-xs tabular-nums">{value}</span>
      </div>
      {children}
    </div>
  )
}

export function Brand() {
  const thrown = useStore((s) => s.thrown)
  const def = OBJECT_MAP[useStore((s) => s.selected)]
  return (
    <>
      <div className="pointer-events-none absolute left-6 top-5 select-none">
        <div className="text-[13px] font-semibold tracking-[0.32em] text-white/90">CLIFF&nbsp;SPLASH</div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
          rigid body · buoyancy · height-field water
        </div>
      </div>
      <div
        className={cn(
          'pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full px-4 py-1.5 text-xs text-white/80 transition-opacity duration-700 select-none',
          glass,
          thrown ? 'opacity-0' : 'opacity-100',
        )}
      >
        Click the sea to throw the {def.label.toLowerCase()} · drag to orbit
      </div>
    </>
  )
}

export function Telemetry({ engine }: { engine: Engine }) {
  const impacts = useStore((s) => s.impacts)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 120)
    return () => clearInterval(id)
  }, [])
  const last = impacts[0]
  if (!last) return null
  const [ev, eu] = fmtEnergy(last.energy)
  const peak = Math.max(0, engine.splashPeak(last.splashId))
  return (
    <div className={cn('absolute bottom-5 left-6 w-[248px] rounded-2xl p-4 select-none', glass)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-white/45">Impact</span>
        <span className="text-xs text-white/80">{last.label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5 font-mono tabular-nums">
        <span className="text-4xl font-light tracking-tight text-white">{last.speed.toFixed(1)}</span>
        <span className="text-xs text-white/50">m/s</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 font-mono tabular-nums">
        <Metric label="Energy" value={ev} unit={eu} />
        <Metric label="Spray" value={peak.toFixed(1)} unit="m" />
        <Metric label="Mass" value={fmtMass(last.mass).split(' ')[0]} unit={fmtMass(last.mass).split(' ')[1]} />
      </div>
      {impacts.length > 1 && (
        <div className="mt-3 space-y-1 border-t border-white/10 pt-2.5">
          {impacts.slice(1, 4).map((i) => (
            <div key={i.splashId} className="flex justify-between font-mono text-[10px] text-white/40 tabular-nums">
              <span className="font-sans">{i.label}</span>
              <span>{i.speed.toFixed(1)} m/s · ↑{Math.max(0, engine.splashPeak(i.splashId)).toFixed(1)} m</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.16em] text-white/40 font-sans">{label}</div>
      <div className="text-sm text-white">
        {value}<span className="ml-0.5 text-[10px] text-white/45">{unit}</span>
      </div>
    </div>
  )
}

export function Stats() {
  const stats = useStore((s) => s.stats)
  const ts = useStore((s) => s.timeScale)
  return (
    <div className="pointer-events-none absolute right-6 top-5 text-right font-mono text-[10px] leading-relaxed text-white/45 tabular-nums select-none">
      <div>{stats.fps} fps</div>
      <div>{stats.bodies} bodies · {stats.particles >= 1000 ? `${(stats.particles / 1000).toFixed(1)}k` : stats.particles} drops</div>
      {ts < 1 && <div className="text-white/80">{ts.toFixed(2)}× time</div>}
    </div>
  )
}
