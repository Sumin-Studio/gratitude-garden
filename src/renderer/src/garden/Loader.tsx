import { useEffect, useState } from 'react'

// While the garden loads: an ASCII sprout that grows and opens, over the
// page, until every flower is baked and (on Visit the garden) the camera is
// already on the flower. Then it fades and the garden is just there.

const FRAMES = [
  ['         ', '         ', '         ', '         ', '    .    ', '~~~~~~~~~'],
  ['         ', '         ', '         ', '    ,    ', '    |    ', '~~~~~~~~~'],
  ['         ', '         ', '    .    ', '   \\|    ', '    |    ', '~~~~~~~~~'],
  ['         ', '    o    ', '   \\|/   ', '    |    ', '   \\|    ', '~~~~~~~~~'],
  ['   . .   ', '  :(@):  ', '   \\|/   ', '    |/   ', '   \\|    ', '~~~~~~~~~'],
  ['  .:*:.  ', ' *:(@):* ', "  '\\|/'  ", '    |/   ', '   \\|    ', '~~~~~~~~~']
]
/** The full bloom holds a few beats before it starts again. */
const HOLD = 4

export function Loader({ shown }: { shown: boolean }) {
  const [tick, setTick] = useState(0)
  const [gone, setGone] = useState(!shown)
  useEffect(() => {
    if (!shown) {
      const t = window.setTimeout(() => setGone(true), 600)
      return () => window.clearTimeout(t)
    }
    setGone(false)
    const id = window.setInterval(() => setTick((n) => n + 1), 170)
    return () => window.clearInterval(id)
  }, [shown])
  if (gone) return null
  const f = FRAMES[Math.min(tick % (FRAMES.length + HOLD), FRAMES.length - 1)]
  return (
    <div className="loader" data-shown={shown || undefined} aria-live="polite" aria-label="Growing your garden">
      <pre aria-hidden>{f.join('\n')}</pre>
      <p>
        growing your garden<span>{'.'.repeat(1 + (tick % 3))}</span>
      </p>
    </div>
  )
}
