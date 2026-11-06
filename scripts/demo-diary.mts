// `node scripts/demo-diary.mts <spec.json> <userData dir>`: builds a demo diary
// for recording the app. The spec (kept out of git, .claude/demo/days.json):
//   { "end": "2026-11-05", "days": [{ "text": "...", "photos": ["/path.jpg"] }],
//     "kinds": { "lotus": 2, ... } }
// One submitted page a day, ending on `end`, through the app's own rules
// (shared/diary.ts): the words at the top, the photos as prints (copied and
// resized into the folder's media; the originals are only read), and each
// day's flower the planned kind (the evening's submit time is picked so the
// next seed draws it). Today is left empty. Writes state.json, media/ and a
// demo.json (replay on, lotus seeds: src/main/demo.ts).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error: node runs the model's .ts directly (type stripping); tsc doesn't allow the extension.
import { initialState, plantId, rollDay, seedKind, setToday, submitDay, type FlowerId, type Item } from '../src/shared/diary.ts'

const [specPath, out] = process.argv.slice(2)
if (!specPath || !out) throw new Error('usage: node scripts/demo-diary.mts <spec.json> <userData dir>')
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as { end: string; days: { text: string; photos: string[] }[]; kinds: Partial<Record<FlowerId, number>> }

let seed = 11
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296)

// ---- Photos into media, and their shape as shown (EXIF turns respected) ----
const media = join(out, 'media')
fs.mkdirSync(media, { recursive: true })
const prop = (file: string, key: string) => execFileSync('sips', ['-g', key, file], { encoding: 'utf8' }).match(new RegExp(`${key}: (\\S+)`))?.[1]
let n = 0
const copied = new Map<string, { file: string; aspect: number }>()
for (const d of spec.days)
  for (const src of d.photos) {
    if (copied.has(src)) continue
    const file = `demo-${String(++n).padStart(3, '0')}.jpg`
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '1400', src, '--out', join(media, file)], { stdio: 'ignore' })
    const w = Number(prop(join(media, file), 'pixelWidth'))
    const h = Number(prop(join(media, file), 'pixelHeight'))
    const turned = Number(prop(join(media, file), 'orientation') ?? 1) >= 5
    copied.set(src, { file, aspect: turned ? w / h : h / w })
  }

// ---- Pages: the words at the top, prints stuck on crooked below ----
const ONE = [
  { x: 64, y: 92, rot: -6 },
  { x: 118, y: 100, rot: 7 },
  { x: 40, y: 108, rot: -3 },
  { x: 92, y: 96, rot: 4 }
]
const TWO = [
  [
    { x: -36, y: 104, rot: 30 * 0.5 },
    { x: 150, y: 118, rot: -9 }
  ],
  [
    { x: 6, y: 96, rot: -8 },
    { x: 140, y: 140, rot: 6 }
  ]
]
function page(d: (typeof spec.days)[number], i: number): Item[] {
  const items: Item[] = [{ id: `w${i}`, kind: 'text', x: 13, y: 21, text: d.text }]
  const spots = d.photos.length === 1 ? [ONE[i % ONE.length]] : TWO[i % TWO.length]
  d.photos.forEach((src, k) => {
    const { file, aspect } = copied.get(src)!
    // About the Figma's prints: landscape 172 wide; portrait 150 wide and
    // cropped to 185 tall at most, so a tall photo isn't a sliver.
    const tall = aspect > 1.15
    const w = tall ? 150 : 172
    const h = Math.round(Math.min(tall ? 185 : 150, w * aspect))
    const at = spots[k] ?? ONE[k % ONE.length]
    items.push({ id: `p${i}-${k}`, kind: 'image', x: at.x, y: at.y, w, h, rot: Math.round((at.rot + (rnd() - 0.5) * 3) * 10) / 10, file })
  })
  return items
}

// ---- The garden's kinds, spread through the days ----
const kinds = (Object.entries(spec.kinds) as [FlowerId, number][]).flatMap(([k, c]) => Array<FlowerId>(c).fill(k))
for (let i = kinds.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1))
  ;[kinds[i], kinds[j]] = [kinds[j], kinds[i]]
}
if (kinds.length !== spec.days.length) throw new Error(`${kinds.length} kinds for ${spec.days.length} days`)
/** The first moment from `t` whose seed draws `kind` (minute steps). */
const when = (t: number, kind: FlowerId) => {
  for (let k = 0; k < 2000; k++) if (seedKind(plantId(t + k * 60_000)) === kind) return t + k * 60_000
  throw new Error(`no time draws ${kind}`)
}

const DAY = 86_400_000
const [y, m, dd] = spec.end.split('-').map(Number)
const last = new Date(y, m - 1, dd).getTime()
const first = last - (spec.days.length - 1) * DAY
let s = initialState(when(first + 7 * 3_600_000, kinds[0]))
spec.days.forEach((d, i) => {
  const morning = first + i * DAY + 8 * 3_600_000 + Math.floor(rnd() * 3_600_000)
  s = rollDay(s, morning)
  s = setToday(s, morning + 60_000, page(d, i))
  // The evening's submit plants this day's flower and draws tomorrow's seed.
  const evening = first + i * DAY + 19 * 3_600_000 + Math.floor(rnd() * 3_600_000)
  s = submitDay(s, i + 1 < kinds.length ? when(evening, kinds[i + 1]) : evening)
})
s = rollDay(s, Date.now())

fs.writeFileSync(join(out, 'state.json'), JSON.stringify(s, null, 2))
fs.writeFileSync(join(out, 'demo.json'), JSON.stringify({ replay: true, seed: 'lotus' }, null, 2) + '\n')
const tally: Record<string, number> = {}
for (const f of s.garden) tally[f.flower] = (tally[f.flower] ?? 0) + 1
console.log(`demo diary: ${s.garden.length} flowers (${Object.entries(tally).map(([k, c]) => `${k} ${c}`).join(', ')}), ${copied.size} photos, today empty`)
