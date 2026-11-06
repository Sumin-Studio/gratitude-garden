// The glass dials: how the sheets (ui/sheet.css) and the garden's lens under
// the callout (ui/lens.ts) look, on sliders in the garden's Fine tune. Kept
// in this Mac's storage; the pad and the garden are both windows of the app,
// so a slider moved in the garden shows on the pad straight away (the
// storage event). The CSS reads them as variables on the root; the lens
// takes the rest through onGlass.

export type GlassKey =
  | 'padTint'
  | 'padPaper'
  | 'smokeTint'
  | 'smokePaper'
  | 'paperShadow'
  | 'rim'
  | 'glow'
  | 'sheen'
  | 'blur'
  | 'sat'
  | 'bright'
  | 'band'
  | 'pull'
  | 'split'
  | 'pillRim'
  | 'pillLight'
  | 'outline'

type Spec = { key: GlassKey; label: string; min: number; max: number; step?: number; def: number }

export const GLASS_GROUPS: { title: string; dials: Spec[] }[] = [
  {
    title: 'Glass: the pad',
    dials: [
      { key: 'padTint', label: 'Panel tint', min: 0, max: 1, def: 0.62 },
      { key: 'padPaper', label: 'Paper', min: 0.3, max: 1, def: 0.86 }
    ]
  },
  {
    title: 'Glass: the callout',
    dials: [
      { key: 'smokeTint', label: 'Smoke tint', min: 0, max: 0.8, def: 0.22 },
      { key: 'smokePaper', label: 'Paper', min: 0.3, max: 1, def: 0.79 },
      { key: 'paperShadow', label: 'Paper shadow', min: 0, max: 1, def: 0 },
      { key: 'blur', label: 'Blur', min: 0, max: 12, step: 0.5, def: 4 },
      { key: 'sat', label: 'Saturate', min: 1, max: 2.5, def: 1.09 },
      { key: 'bright', label: 'Brightness', min: 0.8, max: 1.3, def: 0.96 },
      { key: 'band', label: 'Refraction band', min: 0, max: 80, step: 1, def: 24 },
      { key: 'pull', label: 'Refraction', min: 0, max: 2, def: 1.1 },
      { key: 'split', label: 'Colour split', min: 0, max: 0.4, def: 0.15 }
    ]
  },
  {
    title: 'Glass: edges and buttons',
    dials: [
      { key: 'rim', label: 'Rim light', min: 0, max: 4, def: 2 },
      { key: 'glow', label: 'Inner glow', min: 0, max: 4, def: 2 },
      { key: 'sheen', label: 'Sheen', min: 0, max: 0.8, def: 0.4 },
      { key: 'pillRim', label: 'Button rim', min: 0, max: 1, def: 0.95 },
      { key: 'pillLight', label: 'Button top light', min: 0, max: 1, def: 0.34 },
      { key: 'outline', label: 'Button outline', min: 0, max: 0.6, def: 0.22 }
    ]
  }
]

export type Glass = Record<GlassKey, number>
export const GLASS_DIALS = GLASS_GROUPS.flatMap((g) => g.dials)
export const GLASS_DEFAULTS = Object.fromEntries(GLASS_DIALS.map((d) => [d.key, d.def])) as Glass
const KEY = 'sip-glass'

export function loadGlass(): Glass {
  try {
    return { ...GLASS_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...GLASS_DEFAULTS }
  }
}

const listeners = new Set<(g: Glass) => void>()
/** Called with the dials whenever they change here or in another window. */
export function onGlass(cb: (g: Glass) => void) {
  listeners.add(cb)
  cb(loadGlass())
  return () => void listeners.delete(cb)
}

/** The dials onto the page: CSS variables, and whoever listens (the lens). */
export function applyGlass(g: Glass) {
  const s = document.documentElement.style
  s.setProperty('--glass-pad-tint', String(g.padTint))
  s.setProperty('--glass-pad-paper', String(g.padPaper))
  s.setProperty('--glass-smoke-tint', String(g.smokeTint))
  s.setProperty('--glass-smoke-paper', String(g.smokePaper))
  s.setProperty('--glass-paper-shadow', String(g.paperShadow))
  s.setProperty('--glass-rim', String(g.rim))
  s.setProperty('--glass-glow', String(g.glow))
  s.setProperty('--glass-sheen', String(g.sheen))
  s.setProperty('--glass-pill-rim', String(g.pillRim))
  s.setProperty('--glass-pill-light', String(g.pillLight))
  s.setProperty('--glass-outline', String(g.outline))
  listeners.forEach((l) => l(g))
}

export function saveGlass(g: Glass) {
  applyGlass(g)
  try {
    localStorage.setItem(KEY, JSON.stringify(g))
  } catch {
    /* this window only */
  }
}

/** Apply the saved dials now, and again whenever another window moves them. */
export function startGlass() {
  applyGlass(loadGlass())
  const changed = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) applyGlass(loadGlass())
  }
  window.addEventListener('storage', changed)
  return () => window.removeEventListener('storage', changed)
}

/** The dials as text, for pasting back into the defaults. */
export const glassText = (g: Glass) => JSON.stringify(g, null, 2)
