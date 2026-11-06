import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Empty } from './Empty'
import { Loader } from './Loader'
import { bridge } from '../store'
import { Garden } from './Garden'
import { growing } from './Planted'
import type { Visit } from '../../../shared/diary'
import { view, type Looker } from './Look'
import { FULL, mockFlowers } from './mock'
import { loadTune, Tune } from './Tune'
import { tune } from './paint'
import { applyGlass, GLASS_DEFAULTS, onGlass, startGlass } from '../ui/glass'
import type { GardenFlower } from './types'
import '../ui/panel.css'
import '../ui/sheet.css'
import '../board/board.css'
import './garden.css'

// The garden window. In the app it shows the real garden; in a plain browser
// (`pnpm web`, /garden.html) mock flowers (every bed full), `?n=30` for how many
// (`?n=0` for the empty garden). `?capture`
// is the capture harness's mode (scripts/garden-shot.mjs, glass-shot.mjs): no dials, and the
// defaults, so shots are comparable.

const params = new URLSearchParams(location.search)
// `?snap`: the app's own picture of a flower for a submitted page (main/snap.ts):
// capture mode's hooks, but your dials (sky, weather), and no callout.
const SNAP = params.has('snap')
const CAPTURE = params.has('capture') || SNAP
// Shots show what's settled, not entrances (a harness window in the back may never run them).
if (CAPTURE) document.documentElement.classList.add('is-capture')
// `?tune` shows the dials in capture mode too (open with `?tune=open`), for the glass shots.
const TUNE = params.get('tune')
const COUNT = params.has('n') ? Number(params.get('n')) : null

// The app's bridge; absent in a plain browser, where `?diary` (or a visit from
// the browser pad) uses the browser's own pretend diary (store.ts) instead of
// mock flowers, so the whole flow can be tried in the preview.
const sip = window.sip ?? (params.has('diary') || params.has('visit') ? bridge : undefined)

// Your dials, from last time, before anything is drawn: no flash of the defaults.
if (!CAPTURE || SNAP) loadTune()
// The glass dials (shared with the pad): the lens under the callout reads
// them as uniforms. Shots use the defaults.
onGlass((g) => {
  tune.glassBlur.value = g.blur
  tune.glassSat.value = g.sat
  tune.glassBright.value = g.bright
  tune.glassBand.value = g.band
  tune.glassPull.value = g.pull
  tune.glassDisp.value = g.split
})
if (CAPTURE) applyGlass(GLASS_DEFAULTS)
else startGlass()

function App() {
  const [flowers, setFlowers] = useState<GardenFlower[]>(() => (sip && COUNT === null ? [] : mockFlowers(COUNT ?? FULL)))
  // In the app the garden comes over the bridge: nothing's said until it has.
  const [loaded, setLoaded] = useState(() => !sip || COUNT !== null)
  const [focus, setFocus] = useState<number | null>(null)
  const looker = useRef<Looker | null>(null)
  const ready = useRef(false)
  const [isReady, setReady] = useState(false)
  // Check out the garden: the visit waiting to play, and the callout held
  // until its bloom has.
  const [visit, setVisit] = useState<Visit | null>(null)
  const [held, setHeld] = useState(false)
  // The loader stays up until the garden is ready, the app has said whether
  // there's a visit, and (with one) the camera is already on its flower.
  const [asked, setAsked] = useState(() => !sip || SNAP)
  const [placed, setPlaced] = useState(false)
  const [revealed, setRevealed] = useState(CAPTURE)

  useEffect(() => {
    // A snapshot never takes the visit meant for the garden window.
    if (SNAP) return
    if (sip) {
      void sip.takeVisit().then((v) => {
        if (v) setVisit(v)
        setAsked(true)
      })
      return sip.onVisit(setVisit)
    }
    // The browser preview: /garden.html?visit=<id>,<from>,<to>
    const v = params.get('visit')?.split(',')
    if (v?.length === 3) setVisit({ id: v[0], from: Number(v[1]), to: Number(v[2]) })
  }, [])

  // The flower to bloom stands at this morning's growth from the start, so it
  // never shows at today's size first and then shrinks for the bloom.
  useEffect(() => {
    if (visit) growing.set(visit.id, visit.from)
  }, [visit])

  useEffect(() => {
    if (revealed || !isReady || !asked || (visit && !placed)) return
    const t = window.setTimeout(() => setRevealed(true), 120)
    return () => window.clearTimeout(t)
  }, [revealed, isReady, asked, visit, placed])

  // The timelapse (Fine tune → Timelapse): the garden cleared, then every
  // flower grows back in the order it was planted, all in a minute, from the
  // home view, a day counter at the bottom; each plant's shade on the grass
  // comes with it. After it, the garden as it was.
  const [lapse, setLapse] = useState<{ day: number; of: number } | null>(null)
  useEffect(() => {
    let raf = 0
    const go = () => {
      cancelAnimationFrame(raf)
      const list = [...flowersRef.current]
      if (!list.length) return
      setFocus(null)
      view.home()
      const TOTAL = 60_000
      const GROW = 2000
      const shade = (ids: Set<string> | null) => window.dispatchEvent(new CustomEvent('sip-lapse-shade', { detail: ids }))
      shade(new Set())
      let shaded = 0
      const step = (TOTAL - GROW) / list.length
      for (const f of list) growing.set(f.id, -1)
      const t0 = performance.now()
      let shownDay = -1
      const tick = () => {
        const t = performance.now() - t0
        let day = 0
        list.forEach((f, i) => {
          const k = (t - i * step) / GROW
          if (k < 0) return
          day = i + 1
          const e = k >= 1 ? 1 : k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
          growing.set(f.id, e)
        })
        if (day !== shownDay) {
          shownDay = day
          setLapse({ day, of: list.length })
        }
        // The lawn's shade, repainted every eight days (a repaint costs a frame).
        if (day - shaded >= 8) {
          shaded = day
          shade(new Set(list.slice(0, day).map((f) => f.id)))
        }
        if (t < TOTAL) raf = requestAnimationFrame(tick)
        else {
          shade(null)
          for (const f of list) growing.delete(f.id)
          window.setTimeout(() => setLapse(null), 1200)
        }
      }
      tick()
    }
    window.addEventListener('sip-timelapse', go)
    return () => {
      window.removeEventListener('sip-timelapse', go)
      cancelAnimationFrame(raf)
    }
  }, [])

  const played = useRef<Visit | null>(null)
  const flowersRef = useRef(flowers)
  flowersRef.current = flowers
  const known = flowers.some((f) => f.id === visit?.id)
  useEffect(() => {
    if (!visit || !isReady || !known || played.current === visit) return
    played.current = visit
    const v = visit
    const i = flowersRef.current.findIndex((f) => f.id === v.id)
    // Visit the garden (Simon): it opens already close on the flower, the
    // bloom plays, then the view eases out to the whole garden with nothing
    // selected (no callout).
    setHeld(true)
    setFocus(i)
    const snap = window.setTimeout(() => {
      looker.current?.snap()
      setPlaced(true)
    }, 60)
    const state = { id: v.id, phase: 'flying' as 'flying' | 'blooming' | 'done', growth: v.from }
    ;(window as unknown as { __gardenVisit: unknown }).__gardenVisit = state
    // Where it stood this morning, a beat before it opens.
    growing.set(v.id, v.from)
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    // The bud a beat after the loader lifts, then a quick bloom (Simon: it was
    // too slow), a hold on the full bloom, and a slow ease out.
    const FLY = calm ? 0 : 1100
    /** How long the full bloom holds before the view eases out. */
    const HOLD = calm ? 0 : 1000
    let out = 0
    const BLOOM = calm ? 0 : 500 + 1400 * Math.max(0.15, v.to - v.from)
    let raf = 0
    const t = window.setTimeout(() => {
      state.phase = 'blooming'
      // Advanced by each frame's time, at most 1/30 s: a hitch (a shader
      // warming up, the window waking) holds the bloom back instead of
      // skipping it, so it reads as one continuous growth.
      let done = 0
      let last = performance.now()
      const tick = () => {
        const now = performance.now()
        done += Math.min(1000 / 30, now - last)
        last = now
        const k = BLOOM ? Math.min(1, done / BLOOM) : 1
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
        state.growth = v.from + (v.to - v.from) * e
        growing.set(v.id, state.growth)
        if (k < 1) raf = requestAnimationFrame(tick)
        else {
          // Only now does the flower go back to the diary's growth.
          growing.delete(v.id)
          out = window.setTimeout(() => {
            state.phase = 'done'
            setHeld(false)
            setFocus(null)
          }, HOLD)
        }
      }
      tick()
    }, FLY)
    return () => {
      window.clearTimeout(snap)
      window.clearTimeout(t)
      window.clearTimeout(out)
      cancelAnimationFrame(raf)
    }
  }, [visit, isReady, known])

  useEffect(() => {
    if (COUNT !== null || !sip) return
    sip.getGarden().then((f) => {
      setFlowers(f)
      setLoaded(true)
    })
    return sip.onGarden(setFlowers)
  }, [])

  useEffect(() => {
    ;(window as unknown as { __gardenFocus: unknown }).__gardenFocus = focus === null ? null : flowers[focus]?.id ?? null
  }, [focus, flowers])

  useEffect(() => {
    if (!CAPTURE) return
    // What the harness drives.
    ;(window as unknown as { __garden: unknown }).__garden = {
      ready: () => ready.current,
      view(v: { dist?: number; at?: [number, number, number] }) {
        const l = looker.current!
        if (v.dist !== undefined) l.goal.dist = v.dist
        if (v.at) l.goal.at.set(...v.at)
        l.snap()
      },
      focus: (i: number | null) => {
        setFocus(i)
        setTimeout(() => looker.current?.snap(), 50)
      },
      /** Frame a flower by its id; its index, or -1. */
      focusId: (id: string) => {
        const i = flowersRef.current.findIndex((f) => f.id === id)
        if (i >= 0) {
          setFocus(i)
          setTimeout(() => looker.current?.snap(), 50)
        }
        return i
      },
      count: (n: number) => setFlowers(mockFlowers(n)),
      /** Frame times over `ms`, once the page has settled. */
      async fps(ms: number) {
        const times: number[] = []
        const end = performance.now() + ms
        let last = performance.now()
        await new Promise<void>((done) => {
          const tick = (t: number) => {
            times.push(t - last)
            last = t
            if (t < end) requestAnimationFrame(tick)
            else done()
          }
          requestAnimationFrame(tick)
        })
        times.shift()
        const sorted = [...times].sort((a, b) => a - b)
        const mean = times.reduce((a, b) => a + b, 0) / times.length
        return { fps: 1000 / mean, p95ms: sorted[Math.floor(sorted.length * 0.95)], frames: times.length }
      }
    }
  }, [])

  return (
    <>
      {/* The window has no title bar: this strip drags it. */}
      <div className="garden-drag" aria-hidden="true" />
      {loaded && flowers.length === 0 && <Empty />}
      <Loader shown={!revealed} />
      {lapse && (
        <p className="lapse" aria-live="polite">
          day {lapse.day} <span>/ {lapse.of}</span>
        </p>
      )}
      {(!CAPTURE || TUNE !== null) && <Tune initialOpen={TUNE === 'open'} />}
      <Garden
      flowers={flowers}
      capture={CAPTURE}
      callout={!SNAP}
      looker={looker}
      focus={focus}
      onFocus={setFocus}
      held={held}
      onReady={() => {
        ready.current = true
        setReady(true)
      }}
      />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
