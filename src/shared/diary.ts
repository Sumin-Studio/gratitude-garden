// Pure model shared by main and renderers. No Electron, no DOM.
//
// The loop:
//   1. Write down what you did today, one line at a time. Each line waters the
//      plant once.
//   2. Growth is entries / goal. Nothing drains: a plant never wilts or dies.
//   3. At the goal it's full grown, and is planted in the garden with the
//      entries that grew it. A new seed takes its place.

/** The lotus, and six autorig v3 plants (docs/FLOWERS.md). */
export const FLOWER_IDS = ['lotus', 'blossom', 'chrysanthemum', 'shrub', 'iris', 'lily', 'jasmine', 'daisy', 'nemophila'] as const
export type FlowerId = (typeof FLOWER_IDS)[number]

export const FLOWER_LABELS: Record<FlowerId, string> = {
  lotus: 'Lotus',
  blossom: 'Blossom',
  chrysanthemum: 'Chrysanthemum',
  shrub: 'Shrub',
  iris: 'Iris',
  lily: 'Lily of the valley',
  jasmine: 'Jasmine',
  daisy: 'Daisy patch',
  nemophila: 'Baby blue eyes'
}

export const POT_IDS = ['celadon', 'clay', 'sage', 'cream', 'ochre'] as const
export type PotId = (typeof POT_IDS)[number]

export const POT_LABELS: Record<PotId, string> = {
  celadon: 'Celadon',
  clay: 'Clay',
  sage: 'Sage',
  cream: 'Cream',
  ochre: 'Ochre'
}

/** Entries to full grown: about a week of three things a day. Tune it here;
 * a plant keeps the goal it was planted with, the next seed takes the new one. */
export const GOAL = 21

/** From the last Enter to the planting: the rain (~0.7 s), then a 1.5 s hold
 * on the full bloom. */
export const PLANT_HOLD_MS = 2200

const MAX_TEXT = 200
/** What a logged drink becomes in an older save. */
export const DRINK_TEXT = 'a drink'

/** A voice note: a file under userData/audio (name only, no path), its
 * length, and its loudness across it (~96 values 0..1, for the wave; older
 * notes have none and are measured from the file). */
export type Voice = { file: string; ms: number; peaks?: number[] }

/** How many peaks a note keeps, at most. */
export const MAX_PEAKS = 256

/** One thing written down (or said). Text may be empty when there's a voice note. */
export type Entry = { at: number; text: string; audio?: Voice }

// ---- The day canvas ------------------------------------------------------
//
// Each day is a board: text, ink, pictures and voice notes laid out freely.
// Nothing waters the plant until the day is submitted; then each thing on
// it waters it once (an entry per item, so growth, the goal and the garden
// work as before) and the board is locked and kept with the flower it grew.

export const ITEM_KINDS = ['text', 'ink', 'image', 'voice', 'video'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

/** One thing on a board, in board px from its origin. Ink `points` are flat
 * x,y pairs relative to the item's own x,y. `file` is a name under
 * userData/media (image, video) or userData/audio (voice). */
export type Item = {
  id: string
  kind: ItemKind
  x: number
  y: number
  w?: number
  h?: number
  rot?: number
  text?: string
  points?: number[]
  file?: string
  ms?: number
  peaks?: number[]
}

/** A day's board. `date` is its local midnight. Submitted, it's locked and
 * says which plant it watered and how far that plant grew (growth before,
 * after), for the garden's bloom. */
export type Day = {
  date: number
  items: Item[]
  submittedAt?: number
  flower?: string
  grew?: [number, number]
  /** Once submitted: a picture of the garden round the plant it grew, taken
   * just after (a file in media), shown on the page as a window into it. */
  window?: string
}

const MAX_ITEMS = 200
const MAX_ITEM_TEXT = 2000
const MAX_POINTS = 6000
const FAR = 100_000
/** What an item that isn't words says in the diary's lines. */
export const ITEM_LINE: Record<ItemKind, string> = { text: '', ink: 'a drawing', image: 'a picture', voice: '', video: 'a video' }

export type Plant = {
  /** The same id it keeps in the garden. */
  id: string
  flower: FlowerId
  pot: PotId
  name: string
  plantedAt: number
  entries: Entry[]
  goal: number
  /** The submitted days that watered it, oldest first. */
  days: Day[]
}

/** A full-grown flower, planted in the garden. */
export type GardenFlower = {
  id: string
  flower: FlowerId
  pot: PotId
  name: string
  plantedAt: number
  bloomedAt: number
  entries: Entry[]
  /** The days that grew it, as their boards. */
  days: Day[]
  /** Only on the plant still growing, as the garden is sent it: 0..1. */
  growth?: number
  /** How big it grew, against its kind's full size (0.7..1): the more the
   * day held, the bigger. Older flowers have none (full size). */
  size?: number
}

export type DiaryState = {
  /** There is always a plant, if only a seed. */
  plant: Plant
  garden: GardenFlower[]
  /** Today's board, submitted or not. */
  today: Day
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const DAY_MS = 86_400_000

export const plantId = (plantedAt: number) => `p${plantedAt.toString(36)}`

/** How often each kind comes up as the next seed (Simon, 2026-11-06): the
 * pond's lotus rarest, then the colourful (the coral chrysanthemum), then the
 * blues and purples, then the whites, and the ground flowers commonest (about
 * half of all seeds). */
export const RARITY: Record<FlowerId, number> = {
  lotus: 2,
  chrysanthemum: 4,
  blossom: 6,
  iris: 6,
  lily: 9,
  jasmine: 9,
  shrub: 9,
  daisy: 20,
  nemophila: 18
}
const RARITY_SUM = FLOWER_IDS.reduce((n, k) => n + RARITY[k], 0)

/** The kind a seed grows into: drawn by RARITY, always the same for its id. */
export function seedKind(id: string): FlowerId {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  let at = (((h ^ (h >>> 16)) >>> 0) / 2 ** 32) * RARITY_SUM
  for (const k of FLOWER_IDS) if ((at -= RARITY[k]) < 0) return k
  return 'daisy'
}

function seed(now: number, pot: PotId, kind?: FlowerId): Plant {
  const id = plantId(now)
  const flower = kind ?? seedKind(id)
  return { id, flower, pot, name: FLOWER_LABELS[flower], plantedAt: now, entries: [], goal: GOAL, days: [] }
}

export const emptyDay = (now: number): Day => ({ date: startOfDay(now), items: [] })

export function initialState(now: number): DiaryState {
  // Day one's flower is always the pond's lily, the lotus (Simon): the rarest,
  // so the first garden starts with something special.
  return { plant: seed(now, 'clay', 'lotus'), garden: [], today: emptyDay(now) }
}

// ---- The plant ------------------------------------------------------------

export type Phase = 'growing' | 'bloomed'

/** 0 seed … 1 full grown. */
export function growth(s: DiaryState): number {
  return clamp01(s.plant.entries.length / s.plant.goal)
}

export function phaseAt(s: DiaryState): Phase {
  return growth(s) >= 1 ? 'bloomed' : 'growing'
}

export type Stage = 'Seed' | 'Sprout' | 'Young' | 'Budding' | 'In bloom' | 'Full grown'

/** The flower opens early, by about 60% of the goal, so it's pretty for most
 * of the way; the rest it fills out and a second bloom opens. At the goal
 * it's full grown. (Matches rig.ts poseRig.) */
export function stageFor(g: number): Stage {
  if (g >= 1) return 'Full grown'
  if (g >= 0.55) return 'In bloom'
  if (g >= 0.3) return 'Budding'
  if (g >= 0.12) return 'Young'
  if (g > 0) return 'Sprout'
  return 'Seed'
}

// ---- Reading the diary ----------------------------------------------------

/** Everything ever written, oldest first, garden and pot together. */
export function allEntries(s: DiaryState): Entry[] {
  return [...s.garden.flatMap((f) => f.entries), ...s.plant.entries].sort((a, b) => a.at - b.at)
}

/** The entries written on the day `day` falls in. */
export function entriesOn(s: DiaryState, day: number): Entry[] {
  const from = startOfDay(day)
  const next = new Date(from)
  next.setDate(next.getDate() + 1)
  return allEntries(s).filter((e) => e.at >= from && e.at < next.getTime())
}

/** The days before `now` that have entries, newest first. */
export function earlierDays(s: DiaryState, now: number): { day: number; entries: Entry[] }[] {
  const today = startOfDay(now)
  const days = new Map<number, Entry[]>()
  for (const e of allEntries(s)) {
    if (e.at >= today) continue
    const day = startOfDay(e.at)
    const list = days.get(day)
    if (list) list.push(e)
    else days.set(day, [e])
  }
  return [...days.entries()].sort((a, b) => b[0] - a[0]).map(([day, entries]) => ({ day, entries }))
}

// ---- Actions --------------------------------------------------------------

const isVoice = (a: unknown): a is Voice =>
  !!a && typeof a === 'object' && typeof (a as Voice).file === 'string' && /^[\w.-]+$/.test((a as Voice).file) && Number.isFinite((a as Voice).ms) && (a as Voice).ms > 0

/** A well-formed voice note, cleaned: whole milliseconds, peaks clamped to
 * 0..1 and rounded (a broken peaks list is dropped, the note kept). */
export function asVoice(a: unknown): Voice | undefined {
  if (!isVoice(a)) return undefined
  const v: Voice = { file: a.file, ms: Math.round(a.ms) }
  const p = (a as { peaks?: unknown }).peaks
  if (Array.isArray(p) && p.length > 0 && p.length <= MAX_PEAKS && p.every((x) => typeof x === 'number' && Number.isFinite(x)))
    v.peaks = p.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000)
  return v
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)

/** Move the plant to the garden and put a seed in the next glaze in the pot. */
/** The id the growing plant keeps in the garden (made unique if it must be). */
const gardenId = (s: DiaryState) => (s.garden.some((f) => f.id === s.plant.id) ? `${s.plant.id}-${s.garden.length}` : s.plant.id)

/** One day, one flower (Simon, 2026-11-06): a submitted day grows its flower
 * all the way, 70 % of its kind's size for one thing on the page, up to full
 * size from five things. */
export const daySize = (things: number) => Math.min(1, 0.7 + 0.075 * Math.max(0, things - 1))

function plantOut(s: DiaryState, now: number, bloomedAt: number, size?: number): DiaryState {
  const p = s.plant
  // A plant keeps its id in the garden, so it stands where it grew.
  const id = gardenId(s)
  const flower: GardenFlower = {
    id,
    flower: p.flower,
    pot: p.pot,
    name: p.name,
    plantedAt: p.plantedAt,
    bloomedAt,
    entries: p.entries,
    days: p.days,
    ...(size !== undefined && size < 1 ? { size } : {})
  }
  const pot = POT_IDS[(POT_IDS.indexOf(p.pot) + 1) % POT_IDS.length]
  return { ...s, plant: seed(now, pot), garden: [...s.garden, flower] }
}

/** A full-grown plant goes to the garden. Anything else stays put. */
export function plantToGarden(s: DiaryState, now: number): DiaryState {
  if (phaseAt(s) !== 'bloomed') return s
  return plantOut(s, now, s.plant.entries[s.plant.entries.length - 1].at)
}

/** Write a line, or say one: the plant grows by one. A voice note may have
 * no text. Typing never waits on the bloom, so a line written during the
 * hold plants the flower now and waters the seed. */
export function addEntry(s: DiaryState, now: number, text: string, audio?: Voice): DiaryState {
  const line = clean(text)
  const voice = asVoice(audio)
  if (!line && !voice) return s
  s = plantToGarden(s, now)
  const last = s.plant.entries[s.plant.entries.length - 1]
  // `at` identifies a line, so two in one millisecond must differ.
  const at = last && last.at >= now ? last.at + 1 : now
  const entry: Entry = voice ? { at, text: line, audio: voice } : { at, text: line }
  return { ...s, plant: { ...s.plant, entries: [...s.plant.entries, entry] } }
}

/** Take a line back, and say which it was (so a voice note's file can go
 * too). Only the plant's own: a flower in the garden keeps what grew it. */
export function takeEntry(s: DiaryState, at: number): { state: DiaryState; removed: Entry | null } {
  const removed = s.plant.entries.find((e) => e.at === at) ?? null
  if (!removed) return { state: s, removed }
  return { state: { ...s, plant: { ...s.plant, entries: s.plant.entries.filter((e) => e !== removed) } }, removed }
}

/** Take a line back. */
export function removeEntry(s: DiaryState, at: number): DiaryState {
  return takeEntry(s, at).state
}

/** Fix a line, in the pot or the garden. Emptied, a line in the pot goes
 * (a voice note keeps its file and loses its caption); one in the garden
 * stays as it was. */
export function editEntry(s: DiaryState, at: number, text: string): DiaryState {
  const line = clean(text)
  const voice = s.plant.entries.find((e) => e.at === at)?.audio
  // A voice note emptied of its caption is still a voice note.
  if (!line && !voice) return removeEntry(s, at)
  const fix = (entries: Entry[]) => entries.map((e) => (e.at === at ? { ...e, text: line } : e))
  if (s.plant.entries.some((e) => e.at === at)) return { ...s, plant: { ...s.plant, entries: fix(s.plant.entries) } }
  return { ...s, garden: s.garden.map((f) => (f.entries.some((e) => e.at === at) ? { ...f, entries: fix(f.entries) } : f)) }
}

// ---- Loading --------------------------------------------------------------

const isTime = (v: unknown, now: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= now + 60_000

/** Older builds had four placeholder types; anything else becomes a lotus. */
const asFlower = (v: unknown): FlowerId | null =>
  FLOWER_IDS.includes(v as FlowerId) ? (v as FlowerId) : typeof v === 'string' ? 'lotus' : null

const asPot = (v: unknown): PotId | null => (POT_IDS.includes(v as PotId) ? (v as PotId) : null)

/** A name is kept only if it was chosen, not an older build's default. */
const asName = (v: unknown, flower: FlowerId) =>
  typeof v === 'string' && v.trim() && !['Tulip', 'Daisy', 'Sunflower', 'Rose'].includes(v)
    ? v.trim().slice(0, 24)
    : FLOWER_LABELS[flower]

function asEntries(raw: unknown, now: number): Entry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is Entry => !!e && isTime(e.at, now) && typeof e.text === 'string' && (!!clean(e.text) || isVoice(e.audio)))
    .map((e) => {
      const audio = asVoice(e.audio)
      return audio ? { at: e.at, text: clean(e.text), audio } : { at: e.at, text: clean(e.text) }
    })
    .sort((a, b) => a.at - b.at)
}

/** One entry per logged drink. */
function fromDrinks(raw: unknown, now: number): Entry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((d): d is { at: number } => !!d && isTime(d.at, now))
    .map((d) => ({ at: d.at, text: DRINK_TEXT }))
    .sort((a, b) => a.at - b.at)
}

/** What a garden flower and an old library flower have in common. */
function asFlowerBase(f: Record<string, unknown> | null | undefined, now: number) {
  const flower = asFlower(f?.flower)
  const pot = asPot(f?.pot)
  const { id, plantedAt, bloomedAt, name, size } = f ?? {}
  if (!flower || !pot || typeof id !== 'string' || !isTime(plantedAt, now) || !isTime(bloomedAt, now)) return null
  const base = { id, flower, pot, name: asName(name, flower), plantedAt, bloomedAt }
  return typeof size === 'number' && size >= 0.5 && size < 1 ? { ...base, size } : base
}

function asGarden(raw: unknown, now: number): GardenFlower[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((f) => {
    const base = asFlowerBase(f, now)
    if (!base) return []
    const entries = asEntries(f.entries, now)
    return [{ ...base, entries, days: Array.isArray(f.days) ? asDays(f.days, now, base.id) : daysFromEntries(entries, base.id) }]
  })
}

/** The old library kept only how many drinks each flower had, so its lines
 * are spread evenly from planting to bloom. */
function fromLibrary(raw: unknown, now: number): GardenFlower[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((f) => {
    const base = asFlowerBase(f, now)
    if (!base) return []
    const n = typeof f.drinks === 'number' && f.drinks > 0 ? Math.min(1000, Math.floor(f.drinks)) : 0
    const step = (base.bloomedAt - base.plantedAt) / Math.max(1, n)
    const entries = Array.from({ length: n }, (_, i) => ({ at: Math.round(base.plantedAt + step * (i + 1)), text: DRINK_TEXT }))
    return [{ ...base, entries, days: daysFromEntries(entries, base.id) }]
  })
}

/** Is this the water tracker's file? (For keeping a copy before it's replaced.) */
export function isOldSave(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && 'library' in raw
}

/** Fill in anything missing or broken, and bring an older file forward: the
 * water tracker's drinks become entries and its library the garden. A plant
 * that had bloomed goes straight to the garden; one that had died comes back,
 * since nothing dies any more. */
export function normalize(raw: unknown, now: number): DiaryState {
  const base = initialState(now)
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown> & { plant?: Record<string, unknown> | null }
  const p = r.plant && typeof r.plant === 'object' ? r.plant : null
  const flower = asFlower(p?.flower)
  const entries = Array.isArray(p?.entries) ? asEntries(p.entries, now) : fromDrinks(p?.drinks, now)
  const plantedAt = isTime(p?.plantedAt, now) ? p.plantedAt : (entries[0]?.at ?? now)
  const id = typeof p?.id === 'string' && ID.test(p.id) ? p.id : plantId(plantedAt)
  let s: DiaryState = {
    plant: flower
      ? {
          id,
          flower,
          pot: asPot(p?.pot) ?? 'clay',
          name: asName(p?.name, flower),
          plantedAt,
          entries,
          goal: typeof p?.goal === 'number' && p.goal >= 1 && p.goal <= 1000 ? Math.floor(p.goal) : GOAL,
          days: Array.isArray(p?.days) ? asDays(p.days, now, id) : daysFromEntries(entries, id)
        }
      : seed(now, asPot(r.lastPot) ?? base.plant.pot),
    // The old desktop window's position and switch (pos, desktop) are left behind.
    garden: [...asGarden(r.garden, now), ...fromLibrary(r.library, now)],
    today: asDay(r.today, now) ?? emptyDay(now)
  }
  // Today's board must not be one already kept as submitted.
  if (s.today.submittedAt && !s.today.flower) s = { ...s, today: { ...s.today, flower: s.plant.id } }
  if (flower && isTime(p?.bloomedAt, now)) s = plantOut(s, now, p.bloomedAt)
  else s = plantToGarden(s, now)
  return rollDay(s, now)
}

// ---- Boards -----------------------------------------------------------------

const ID = /^[\w-]{1,40}$/
const FILE = /^[\w.-]{1,80}$/
const num = (v: unknown, lo = -FAR, hi = FAR): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v)) * 10) / 10 : undefined

/** A well-formed item, cleaned, or nothing. */
export function asItem(raw: unknown): Item | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = ITEM_KINDS.includes(r.kind as ItemKind) ? (r.kind as ItemKind) : null
  const x = num(r.x)
  const y = num(r.y)
  if (!kind || typeof r.id !== 'string' || !ID.test(r.id) || x === undefined || y === undefined) return null
  const it: Item = { id: r.id, kind, x, y }
  const w = num(r.w, 1, 4000)
  const h = num(r.h, 1, 4000)
  const rot = num(r.rot, -360, 360)
  if (w !== undefined) it.w = w
  if (h !== undefined) it.h = h
  if (rot) it.rot = rot
  if (kind === 'text') {
    if (typeof r.text !== 'string') return null
    it.text = r.text.slice(0, MAX_ITEM_TEXT)
  }
  if (kind === 'ink') {
    const p = r.points
    if (!Array.isArray(p) || p.length < 4 || p.length % 2 || p.length > MAX_POINTS || !p.every((v) => typeof v === 'number' && Number.isFinite(v)))
      return null
    it.points = p.map((v) => num(v)!)
  }
  if (kind === 'image' || kind === 'video' || kind === 'voice') {
    if (typeof r.file !== 'string' || !FILE.test(r.file) || r.file.includes('..')) return null
    it.file = r.file
  }
  if (kind === 'voice') {
    const v = asVoice({ file: r.file, ms: r.ms, peaks: r.peaks })
    if (!v) return null
    it.ms = v.ms
    if (v.peaks) it.peaks = v.peaks
  }
  return it
}

/** A board's items, cleaned; duplicates by id dropped. */
export function asItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw.slice(0, MAX_ITEMS).flatMap((r) => {
    const it = asItem(r)
    if (!it || seen.has(it.id)) return []
    seen.add(it.id)
    return [it]
  })
}

function asDay(raw: unknown, now: number): Day | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isTime(r.date, now)) return null
  const d: Day = { date: startOfDay(r.date), items: asItems(r.items) }
  if (isTime(r.submittedAt, now)) d.submittedAt = r.submittedAt
  if (typeof r.flower === 'string' && ID.test(r.flower)) d.flower = r.flower
  const g = r.grew
  if (Array.isArray(g) && g.length === 2 && g.every((v) => typeof v === 'number' && Number.isFinite(v))) d.grew = [clamp01(g[0]), clamp01(g[1])]
  if (typeof r.window === 'string' && /^[\w.-]{1,80}$/.test(r.window)) d.window = r.window
  return d
}

/** A submitted day's garden picture, wherever that day is kept now: today,
 * the growing plant's days, or a planted flower's. */
export function setDayWindow(s: DiaryState, date: number, file: string): DiaryState {
  const put = (d: Day) => (d.date === date && d.submittedAt ? { ...d, window: file } : d)
  return {
    ...s,
    today: put(s.today),
    plant: { ...s.plant, days: s.plant.days.map(put) },
    garden: s.garden.map((f) => (f.days.some((d) => d.date === date) ? { ...f, days: f.days.map(put) } : f))
  }
}

function asDays(raw: unknown[], now: number, flower: string): Day[] {
  return raw
    .flatMap((r) => {
      const d = asDay(r, now)
      return d && d.submittedAt ? [{ ...d, flower }] : []
    })
    .sort((a, b) => a.date - b.date)
}

/** An older save's lines, as boards: one per day, a text item per line (a
 * voice item for a voice note), stacked, submitted when the last was written. */
export function daysFromEntries(entries: Entry[], flower: string): Day[] {
  const days = new Map<number, Entry[]>()
  for (const e of entries) {
    const d = startOfDay(e.at)
    days.set(d, [...(days.get(d) ?? []), e])
  }
  return [...days.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([date, list]) => ({
      date,
      flower,
      submittedAt: list[list.length - 1].at,
      items: list.flatMap((e, i): Item[] => {
        const id = `m${e.at.toString(36)}`
        const y = i * 64
        if (e.audio) {
          const v: Item = { id, kind: 'voice', x: 0, y, file: e.audio.file, ms: e.audio.ms }
          if (e.audio.peaks) v.peaks = e.audio.peaks
          return e.text ? [v, { id: `${id}t`, kind: 'text', x: 0, y: y + 36, text: e.text }] : [v]
        }
        return [{ id, kind: 'text', x: 0, y, text: e.text }]
      })
    }))
}

/** What on a board counts: words with something in them, ink with a line in it, any file. */
export function keeps(it: Item): boolean {
  if (it.kind === 'text') return !!it.text?.trim()
  if (it.kind === 'ink') return (it.points?.length ?? 0) >= 4
  return !!it.file
}

/** The day's board as you left it (autosave). A submitted day doesn't change. */
export function setToday(s: DiaryState, now: number, items: unknown): DiaryState {
  s = rollDay(s, now)
  if (s.today.submittedAt) return s
  return { ...s, today: { ...s.today, items: asItems(items) } }
}

/** Submit the day: it locks, and each thing on it waters the plant once. A
 * day with nothing on it submits nothing. The board goes with the plant that
 * took its first watering, and remembers how far that plant grew. */
export function submitDay(s: DiaryState, now: number): DiaryState {
  if (s.today.submittedAt) return s
  const items = s.today.items.filter(keeps)
  if (!items.length) return s
  // A plant held at full bloom goes now, so the day waters the next one.
  s = plantToGarden(s, now)
  const p = s.plant
  const before = p.entries.length
  // One day, one flower: the day grows it to full bloom and plants it.
  const day: Day = {
    ...s.today,
    items,
    submittedAt: now,
    flower: gardenId(s),
    grew: [clamp01(before / p.goal), 1]
  }
  s = { ...s, today: day, plant: { ...p, days: [...p.days, day] } }
  // The lines stand in time on the board's day (a late submit of an older
  // board, at its last moment).
  const at = Math.min(now, day.date + DAY_MS - 1)
  items.forEach((it, i) => {
    const audio = it.kind === 'voice' && it.file && it.ms ? asVoice({ file: it.file, ms: it.ms, peaks: it.peaks }) : undefined
    const text = it.kind === 'text' ? (it.text ?? '') : ITEM_LINE[it.kind]
    s = water(s, at + i, text, audio)
  })
  return plantOut(s, now, at + items.length - 1, daySize(items.length))
}

/** One watering: like addEntry, but a line that goes past the goal still
 * lands on the plant it was meant for, so a board's waterings never split. */
function water(s: DiaryState, at: number, text: string, audio?: Voice): DiaryState {
  const line = clean(text)
  const voice = asVoice(audio)
  if (!line && !voice) return s
  const last = s.plant.entries[s.plant.entries.length - 1]
  const when = last && last.at >= at ? last.at + 1 : at
  const entry: Entry = voice ? { at: when, text: line, audio: voice } : { at: when, text: line }
  return { ...s, plant: { ...s.plant, entries: [...s.plant.entries, entry] } }
}

/** A new day: yesterday's board, if it had anything on it, is submitted for
 * its own day (so closing the pad never loses one), and today starts clean. */
export function rollDay(s: DiaryState, now: number): DiaryState {
  if (s.today.date === startOfDay(now)) return s
  if (!s.today.submittedAt) s = submitDay(s, now)
  return { ...s, today: emptyDay(now) }
}

/** Every submitted board, newest first, and which flower holds it. */
export function pastDays(s: DiaryState): { day: Day; flower: string }[] {
  const all = [...s.garden.flatMap((f) => f.days.map((day) => ({ day, flower: f.id }))), ...s.plant.days.map((day) => ({ day, flower: s.plant.id }))]
  return all.filter(({ day }) => day.date !== s.today.date).sort((a, b) => b.day.date - a.day.date)
}

/** The garden as the garden window draws it: what's planted, and the plant
 * still growing (once it has been watered), at its growth. */
export function gardenView(s: DiaryState): GardenFlower[] {
  const p = s.plant
  if (!p.entries.length) return s.garden
  return [
    ...s.garden,
    { id: p.id, flower: p.flower, pot: p.pot, name: p.name, plantedAt: p.plantedAt, bloomedAt: p.entries[p.entries.length - 1].at, entries: p.entries, days: p.days, growth: growth(s) }
  ]
}

/** Where Check out the garden goes: the flower today watered, and its bloom
 * from this morning to now. */
export type Visit = { id: string; from: number; to: number }

export function visitFor(s: DiaryState): Visit | null {
  const d = s.today
  if (!d.submittedAt || !d.flower || !d.grew) return null
  return { id: d.flower, from: d.grew[0], to: d.grew[1] }
}

// ---- Demo (recording a walkthrough) -----------------------------------------

/** The seed waiting (nothing on it yet) becomes this kind. */
export function seedAs(s: DiaryState, kind: FlowerId): DiaryState {
  const p = s.plant
  if (p.entries.length || p.flower === kind) return s
  return { ...s, plant: { ...p, flower: kind, name: FLOWER_LABELS[kind] } }
}

/** Today as it was before Submit: the flower it planted goes back to being
 * the seed (its kind, pot and id), and the page is open again with the same
 * things on it. Anything else stays. */
export function reopenToday(s: DiaryState): DiaryState {
  const d = s.today
  if (!d.submittedAt) return s
  const page: Day = { date: d.date, items: d.items }
  const f = d.flower ? s.garden.find((g) => g.id === d.flower) : undefined
  if (!f) return { ...s, today: page }
  const plant: Plant = { id: f.id, flower: f.flower, pot: f.pot, name: f.name, plantedAt: f.plantedAt, entries: [], goal: GOAL, days: [] }
  return { ...s, garden: s.garden.filter((g) => g.id !== f.id), plant, today: page }
}
