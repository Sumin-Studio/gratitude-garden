import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Board } from '../board/Board'
import { useLens } from '../ui/lens'
import { wordsOf } from '../ui/words'
import type { ScreenBox } from './Look'
import type { GardenFlower } from './types'

// The callout, as Simon's Figma sheet (ui/sheet.css, the smoke kind) without
// its header (like the pad): the day on a paper card as it was on the pad (its words from the top,
// its pictures where they were stuck; read-only), and Back. Under it the
// garden draws real glass (ui/lens.ts). A white line runs from a ring beside the card to
// a dot on the bloom, and four small corner brackets on the flower's edges. A flower
// grown over several days pages through them: the paper scrolls a day at a
// time.
// The line draws itself from the bloom to the card, then the card grows in;
// stepping back runs it the other way. Look redraws the line every frame
// (point), so it stays on the bloom while the camera eases.

const dayName = (t: number) => new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

const calm = matchMedia('(prefers-reduced-motion: reduce)')
/** The line's draw, and the card's fade after it. */
const DRAW = 300
/** The card's exit (garden.css), before the line draws back. */
const FADE = 150
/** The ring the line starts from, left of the card's top corner (Figma: 21 px). */
const RING_X = -21.5
const RING_Y = 26.5
/** The four corner brackets on the flower's edges: how far out from them, and
 * the arm length (shorter on a small flower). */
const OUT = 3
const ARM = 8
/** One L per corner of the box, each arm running in from the corner. */
function brackets({ l, t, r, b }: ScreenBox) {
  l -= OUT
  t -= OUT
  r += OUT
  b += OUT
  const a = Math.min(ARM, (r - l) / 3, (b - t) / 3)
  return `M${l} ${t + a}V${t}H${l + a}M${r - a} ${t}H${r}V${t + a}M${r} ${b - a}V${b}H${r - a}M${l + a} ${b}H${l}V${b - a}`
}
const ease = (t: number) => 1 - (1 - t) * (1 - t)

// ---- The card ---------------------------------------------------------------

export type LabelHandle = { point(x: number, y: number, box?: ScreenBox): void }

type Props = {
  flower: GardenFlower
  /** True while the flower is in focus; false while stepping back. */
  open: boolean
  /** The line has drawn back: nothing left to show. */
  onGone?(): void
  /** Back: step out of the flower. */
  onBack?(): void
}

export const Label = forwardRef<LabelHandle, Props>(function Label({ flower, open, onGone, onBack }, ref) {
  const line = useRef<SVGLineElement>(null)
  const dot = useRef<SVGGElement>(null)
  const ring = useRef<SVGCircleElement>(null)
  const frame = useRef<SVGPathElement>(null)
  // The garden draws the glass under the card (Film's lens): the painting
  // blurred, lifted and pulled in at the rim.
  const card = useLens<HTMLDivElement>(32)
  // When the current phase began, and how far the line was drawn at that moment.
  const phase = useRef({ open, since: performance.now(), from: open ? 0 : 1, drawn: 0 })
  const [shown, setShown] = useState(false)
  const goneRef = useRef(onGone)
  goneRef.current = onGone
  const done = useRef(false)

  useEffect(() => {
    const p = phase.current
    p.from = p.drawn
    p.open = open
    p.since = performance.now()
    // The card follows the line in, and leads it out.
    if (calm.matches) setShown(open)
    else if (open) {
      const t = setTimeout(() => setShown(true), DRAW)
      return () => clearTimeout(t)
    } else setShown(false)
  }, [open])

  useImperativeHandle(ref, () => ({
    point(x, y, box) {
      const l = line.current
      const c = card.current
      if (!l || !c) return
      const r = c.getBoundingClientRect()
      const x2 = r.left + RING_X
      const y2 = r.top + RING_Y
      l.setAttribute('x1', String(x))
      l.setAttribute('y1', String(y))
      l.setAttribute('x2', String(x2))
      l.setAttribute('y2', String(y2))
      // How much of it to show: drawing in from the bloom, or back out to it.
      const p = phase.current
      const wait = p.open ? 0 : FADE
      const t = calm.matches ? 1 : Math.max(0, Math.min(1, (performance.now() - p.since - wait) / DRAW))
      p.drawn = p.open ? p.from + (1 - p.from) * ease(t) : p.from * (1 - ease(t))
      const len = Math.hypot(x2 - x, y2 - y)
      l.setAttribute('stroke-dasharray', `${len} ${len}`)
      l.setAttribute('stroke-dashoffset', String(len * (1 - p.drawn)))
      const d = dot.current
      if (d) {
        d.setAttribute('transform', `translate(${x} ${y})`)
        // The dot and brackets land first and lift last: there while any line is.
        d.setAttribute('opacity', String(Math.min(1, p.drawn * 6)))
      }
      const fr = frame.current
      if (fr) {
        fr.setAttribute('d', box ? brackets(box) : '')
        fr.setAttribute('opacity', String(Math.min(1, p.drawn * 6)))
      }
      const o = ring.current
      if (o) {
        o.setAttribute('cx', String(x2))
        o.setAttribute('cy', String(y2))
        // The ring arrives with the line's end.
        o.setAttribute('opacity', String(Math.max(0, Math.min(1, (p.drawn - 0.85) / 0.15))))
      }
      if (!p.open && p.drawn <= 0 && !done.current) {
        done.current = true
        goneRef.current?.()
      }
    }
  }))

  return (
    <>
      <svg className="leader" aria-hidden>
        <line ref={line} stroke="#fff" strokeWidth="1" strokeLinecap="round" />
        <path ref={frame} className="leader-brackets" opacity="0" />
        <g ref={dot} opacity="0">
          <circle r="5" className="leader-dot" />
        </g>
        <circle ref={ring} r="10" className="leader-dot" opacity="0" />
      </svg>
      <div ref={card} className="label sheet is-smoke" data-shown={shown || undefined} aria-hidden={!shown}>
        <Scrapbook flower={flower} onBack={onBack} />
      </div>
    </>
  )
})

/** The days that grew the flower, newest first, one paper page each, as it
 * was on the pad. Read-only; nothing to click but Back (and an older day's
 * voice note). */
function Scrapbook({ flower, onBack }: { flower: GardenFlower; onBack?(): void }) {
  const days = [...flower.days].reverse()
  return (
    <>
      <div className="sheet-paper scrap" data-test="scrapbook">
        {days.length ? (
          days.map((d) => (
            <section className="scrap-page" key={d.date}>
              <p className="sheet-words">{wordsOf(d.items)}</p>
              <Board items={d.items.filter((i) => i.kind !== 'text')} fitKey={`${flower.id}:${d.date}`} page fixed />
            </section>
          ))
        ) : (
          <p className="scrap-none">Nothing kept for this one.</p>
        )}
      </div>
      <footer className="sheet-foot">
        <button type="button" className="sheet-pill sheet-button is-primary" data-test="back" onClick={onBack}>
          Back
        </button>
      </footer>
    </>
  )
}
