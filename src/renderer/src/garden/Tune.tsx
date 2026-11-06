import { useEffect, useRef, useState } from 'react'
import { TimeArt, WeatherArt } from './Dithered'
import { view } from './Look'
import { tune } from './paint'
import { GLASS_DEFAULTS, GLASS_GROUPS, glassText, loadGlass, onGlass, saveGlass, type Glass } from '../ui/glass'

// The garden's dials, after the pixel-art farm panel (.claude/ref): a dark
// frosted panel over the garden with two cards (time of day, weather), each
// a dithered sky over a ‹ name › stepper, a one-line caption,
// and Fine tune for the sliders; under it a pill of icon buttons.
// Your values are kept in this window's storage and come back next launch
// (loadTune, before the first paint); the pill's Reset puts the defaults back.
// Fine tune also holds the glass (ui/glass.ts), shared with the pad: Keep the
// pad open shows it beside the garden while you move them, Copy puts the
// numbers on the clipboard.

type Dial = keyof typeof tune
type Spec = { key: Dial; label: string; min: number; max: number; step?: number }

const GROUPS: { title: string; dials: Spec[] }[] = [
  {
    title: 'Colour',
    dials: [
      { key: 'grassBright', label: 'Grass brightness', min: 0.7, max: 1.4 },
      { key: 'grassSat', label: 'Grass saturation', min: 0.4, max: 1.6 },
      { key: 'sat', label: 'Saturation', min: 0.5, max: 1.4 },
      { key: 'glow', label: 'Glow', min: 0, max: 3 }
    ]
  },
  {
    title: 'Paper',
    dials: [
      { key: 'fade', label: 'Edge fade', min: 0.7, max: 1.3 },
      { key: 'paper', label: 'Texture', min: 0, max: 2.5 },
      { key: 'shadows', label: 'Grass shadows', min: 0, max: 2.5 }
    ]
  },
  {
    title: 'Motion',
    dials: [
      { key: 'wind', label: 'Wind', min: 0, max: 2 },
      { key: 'ripples', label: 'Ripples', min: 0, max: 3 },
      { key: 'fish', label: 'Fish', min: 0, max: 1 }
    ]
  },
  {
    title: 'Sky',
    dials: [
      { key: 'hour', label: 'Hour', min: 0, max: 24, step: 0.25 },
      { key: 'cloud', label: 'Cloud', min: 0, max: 1 },
      { key: 'rain', label: 'Rain', min: 0, max: 1 }
    ]
  },
  {
    title: 'View (temporary)',
    dials: [
      { key: 'turn', label: 'Turn', min: -90, max: 90, step: 1 },
      { key: 'tilt', label: 'Tilt', min: 0, max: 80, step: 0.5 },
      { key: 'lens', label: 'Lens', min: 4, max: 60, step: 1 }
    ]
  },
  {
    title: 'Dither',
    dials: [
      { key: 'dither', label: 'Amount', min: 0, max: 1 },
      { key: 'pixel', label: 'Pixel size', min: 0.5, max: 8, step: 0.25 }
    ]
  }
]
const DIALS = GROUPS.flatMap((g) => g.dials)
const KEY = 'sip-garden-tune-2'
const DEFAULTS = Object.fromEntries(DIALS.map((d) => [d.key, tune[d.key].value])) as Record<Dial, number>
/** How long the panel takes to leave: quicker than it comes in. */
const EXIT_MS = 150

const TIMES = [
  { name: 'Dawn', hour: 6.5 },
  { name: 'Day', hour: 13 },
  { name: 'Dusk', hour: 18.6 },
  { name: 'Night', hour: 23 }
]
const WEATHERS = [
  { name: 'Clear skies', cloud: 0, rain: 0, shadows: 1, ripples: 1 },
  { name: 'Cloudy', cloud: 0.6, rain: 0, shadows: 1.8, ripples: 1 },
  { name: 'Gentle rain', cloud: 0.75, rain: 0.45, shadows: 0.6, ripples: 2.2 },
  { name: 'Downpour', cloud: 0.95, rain: 1, shadows: 0.3, ripples: 3 }
]
const nearest = <T,>(list: T[], score: (x: T) => number) => list.reduce((best, x, i) => (score(x) < score(list[best]) ? i : best), 0)

const Chevron = ({ flip }: { flip?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={flip ? 'm6 3.5 4.5 4.5L6 12.5' : 'M10 3.5 5.5 8l4.5 4.5'} />
  </svg>
)

/** A small switch, as in the reference. */
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange(on: boolean): void }) {
  return (
    <label className="tune-toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** One of the big cards: a little sky over a ‹ name › stepper.
 * The name slides in from the side you pressed, so stepping through reads as
 * moving along. */
function Card({ title, art, name, onStep }: { title: string; art: React.ReactNode; name: string; onStep(d: number): void }) {
  const [dir, setDir] = useState(1)
  const step = (d: number) => {
    setDir(d)
    onStep(d)
  }
  return (
    <div className="tune-card">
      <h3>{title}</h3>
      {art}
      <div className="tune-step">
        <button onClick={() => step(-1)} aria-label={`Previous ${title.toLowerCase()}`}>
          <Chevron />
        </button>
        <span key={name} data-from={dir > 0 ? 'right' : 'left'}>
          {name}
        </span>
        <button onClick={() => step(1)} aria-label={`Next ${title.toLowerCase()}`}>
          <Chevron flip />
        </button>
      </div>
    </div>
  )
}

function apply(values: Record<Dial, number>) {
  for (const d of DIALS) tune[d.key].value = values[d.key]
}


/** Put your saved dials on the uniforms. Call before the garden first draws. */
export function loadTune() {
  apply(load())
}

/** Defaults Simon changed later: a saved value still at an old default
 * takes the new one (pixel 1 → 0.75, grass 1.3 → 1.2, 2026-11-06; dither
 * went to 0.5 for an hour and back to 1). */
const RETUNED: Partial<Record<Dial, number[]>> = { pixel: [1], grassBright: [1.3], dither: [0.5] }

function load(): Record<Dial, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<Dial, number>>
    for (const [k, old] of Object.entries(RETUNED) as [Dial, number[]][]) if (old.includes(saved[k] as number)) delete saved[k]
    return { ...DEFAULTS, ...saved }
  } catch {
    return DEFAULTS
  }
}

const icon = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const Sliders = () => (
  <svg {...icon}>
    <path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" />
    <circle cx="11" cy="4.5" r="1.5" />
    <circle cx="5" cy="11.5" r="1.5" />
  </svg>
)
const Moon = () => (
  <svg {...icon}>
    <path d="M12.8 9.6A5.2 5.2 0 0 1 6.4 3.2a5.2 5.2 0 1 0 6.4 6.4Z" />
  </svg>
)
const Undo = () => (
  <svg {...icon}>
    <path d="M3.5 6.5h6a3.5 3.5 0 0 1 0 7h-4" />
    <path d="M6 4 3.5 6.5 6 9" />
  </svg>
)
/** One slider row: its name and value over the track. */
function Range({ label, value, min, max, step = 0.01, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange(v: number): void }) {
  return (
    <label>
      <span>
        {label}
        <b>{step >= 1 ? value.toFixed(0) : value.toFixed(2)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function Tune({ initialOpen = false }: { initialOpen?: boolean } = {}) {
  const [values, setValues] = useState(() => {
    const v = load()
    apply(v)
    return v
  })
  const [open, setOpen] = useState(initialOpen)
  // Kept on screen while it plays its exit.
  const [leaving, setLeaving] = useState(false)
  const leave = useRef(0)
  const [spin, setSpin] = useState(0)
  const [fine, setFine] = useState(false)
  const [glass, setGlassState] = useState<Glass>(loadGlass)
  useEffect(() => onGlass(setGlassState), [])
  const setGlass = (g: Glass) => {
    setGlassState(g)
    saveGlass(g)
  }
  // Keep the pad open beside the garden while the glass is tuned; let it go
  // when the panel closes or the window does.
  const [pinned, setPinnedState] = useState(false)
  const setPinned = (on: boolean) => {
    setPinnedState(on)
    window.sip?.pinPad(on)
  }
  useEffect(() => {
    if (!pinned) return
    const off = () => window.sip?.pinPad(false)
    window.addEventListener('beforeunload', off)
    return () => {
      window.removeEventListener('beforeunload', off)
      off()
    }
  }, [pinned])
  const [copied, setCopied] = useState(false)
  // Demo mode (the app's demo.json): replay today after a Submit, a lotus
  // every time, and a reset for another take.
  const [demo, setDemoState] = useState({ replay: false, lotus: false })
  useEffect(() => {
    void window.sip?.getDemo().then(setDemoState)
  }, [])
  const setDemo = (d: { replay: boolean; lotus: boolean }) => {
    setDemoState(d)
    window.sip?.setDemo(d)
  }
  const set = (next: Record<Dial, number>) => {
    setValues(next)
    apply(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* private mode: this session only */
    }
  }
  const toggle = (next = !open) => {
    clearTimeout(leave.current)
    if (next) {
      setLeaving(false)
      setOpen(true)
      return
    }
    setLeaving(true)
    setPinnedState(false)
    leave.current = window.setTimeout(() => {
      setOpen(false)
      setLeaving(false)
    }, EXIT_MS)
  }
  useEffect(() => () => clearTimeout(leave.current), [])
  const timeAt = nearest(TIMES, (x) => Math.min(Math.abs(x.hour - values.hour), 24 - Math.abs(x.hour - values.hour)))
  const night = values.hour < 5.5 || values.hour >= 19.5
  const weatherAt = nearest(WEATHERS, (x) => Math.abs(x.cloud - values.cloud) + Math.abs(x.rain - values.rain))
  const step = (len: number, at: number, d: number) => (at + d + len) % len
  return (
    <div className="tune">
      {open && (
        <section className="tune-panel panel" aria-label="Garden controls" data-leaving={leaving || undefined}>
          <header>
            <h2>A quiet garden</h2>
            <button className="tune-x" onClick={() => toggle(false)} aria-label="Close">
              <svg {...icon}>
                <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          </header>
          <div className="tune-cards">
            <Card
              title="Time of day"
              art={<TimeArt hour={values.hour} />}
              name={TIMES[timeAt].name}
              onStep={(d) => {
                set({ ...values, hour: TIMES[step(TIMES.length, timeAt, d)].hour })
              }}
            />
            <Card
              title="Weather"
              art={<WeatherArt cloud={values.cloud} rain={values.rain} />}
              name={WEATHERS[weatherAt].name}
              onStep={(d) => {
                const { name: _, ...w } = WEATHERS[step(WEATHERS.length, weatherAt, d)]
                set({ ...values, ...w })
              }}
            />
          </div>
          <footer className="tune-foot">
            <p>Your garden keeps these until you change them.</p>
            <button className="tune-more" onClick={() => setFine(!fine)} aria-expanded={fine}>
              Fine tune
              <Chevron flip={!fine} />
            </button>
          </footer>
          {/* Always there, folded to nothing when closed, so it can open and
              close smoothly and be interrupted halfway. */}
          <div className="tune-drawer" data-open={fine || undefined} inert={!fine}>
          <div className="tune-groups">
            {GROUPS.map((g, i) => (
              <div className="tune-group" key={g.title} style={{ '--i': i } as React.CSSProperties}>
                <h3>{g.title}</h3>
                {g.dials.map((d) => (
                  <Range key={d.key} label={d.label} value={values[d.key]} min={d.min} max={d.max} step={d.step} onChange={(v) => set({ ...values, [d.key]: v })} />
                ))}
              </div>
            ))}
            <div className="tune-group" style={{ '--i': GROUPS.length } as React.CSSProperties}>
              <h3>Demo</h3>
              <Toggle label="Replay today" on={demo.replay} onChange={(replay) => setDemo({ ...demo, replay })} />
              <Toggle label="Lotus every time" on={demo.lotus} onChange={(lotus) => setDemo({ ...demo, lotus })} />
              <div className="tune-chips">
                <button className="tune-chip" onClick={() => window.sip?.resetToday()}>
                  Reset today
                </button>
                <button className="tune-chip" onClick={() => window.sip?.demoScene('day1')}>
                  Day 1
                </button>
                <button className="tune-chip" onClick={() => window.sip?.demoScene('days100')}>
                  100 days
                </button>
              </div>
              <h3 className="tune-sub">Timelapse</h3>
              <button
                className="tune-chip tune-lapse"
                onClick={() => {
                  toggle(false)
                  window.dispatchEvent(new Event('sip-timelapse'))
                }}
              >
                Play every day, 1 min
              </button>
            </div>
            {GLASS_GROUPS.map((g, i) => (
              <div className="tune-group" key={g.title} style={{ '--i': GROUPS.length + 1 + i } as React.CSSProperties}>
                <h3>{g.title}</h3>
                {i === 0 && (
                  <div className="tune-glass-tools">
                    <Toggle label="Keep the pad open" on={pinned} onChange={setPinned} />
                    <button
                      className="tune-chip"
                      onClick={() => {
                        void navigator.clipboard?.writeText(glassText(glass)).then(() => {
                          setCopied(true)
                          window.setTimeout(() => setCopied(false), 1200)
                        })
                      }}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button className="tune-chip" onClick={() => setGlass(GLASS_DEFAULTS)}>
                      Reset
                    </button>
                  </div>
                )}
                {g.dials.map((d) => (
                  <Range key={d.key} label={d.label} value={glass[d.key]} min={d.min} max={d.max} step={d.step} onChange={(v) => setGlass({ ...glass, [d.key]: v })} />
                ))}
              </div>
            ))}
          </div>
          </div>
        </section>
      )}
      <nav className="tune-bar panel">
        <button className={open && !leaving ? 'on' : ''} onClick={() => toggle()} aria-label="Settings" aria-pressed={open && !leaving} title="Settings">
          <Sliders />
        </button>
        <button
          onClick={() => {
            set(DEFAULTS)
            setGlass(GLASS_DEFAULTS)
            view.home()
            setSpin((n) => n + 1)
          }}
          aria-label="Reset to defaults"
          title="Reset to defaults"
        >
          <span className="tune-spin" key={spin} data-spun={spin > 0 || undefined}>
            <Undo />
          </span>
        </button>
        <button
          className={night ? 'on' : ''}
          onClick={() => {
            set({ ...values, hour: night ? 13 : 23 })
          }}
          aria-label={night ? 'Day' : 'Night'}
          aria-pressed={night}
          title={night ? 'Day' : 'Night'}
        >
          <Moon />
        </button>
      </nav>
    </div>
  )
}
