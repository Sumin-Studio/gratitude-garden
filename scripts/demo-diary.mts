// `node scripts/demo-diary.mts <spec.json> <userData dir>`: builds a demo diary
// for recording the app. The spec (kept out of git, .claude/demo/days.json):
//   { "end": "2026-11-05", "days": [{ "text": "...", "photos": ["/path.jpg"] }],
//     "kinds": { "lotus": 2, ... } }
// One submitted page a day, ending on `end`, through the app's own rules
// (shared/diary.ts): the words at the top, the photos as prints (copied and
// resized into the folder's media; the originals are only read), and each
// day's flower the planned kind (the evening's submit time is picked so the
// next seed draws it). Today is left empty. Writes state.json, a copy as
// demo-100.json (the Demo controls' "100 days"), media/ and a demo.json
// (replay on, lotus seeds: src/main/demo.ts).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error: node runs the model's .ts directly (type stripping); tsc doesn't allow the extension.
import { initialState, plantId, rollDay, seedAs, seedKind, setToday, submitDay, type FlowerId, type Item } from '../src/shared/diary.ts'

const [specPath, out] = process.argv.slice(2)
if (!specPath || !out) throw new Error('usage: node scripts/demo-diary.mts <spec.json> <userData dir>')
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as { end: string; days: { text: string; photos: string[] }[]; kinds: Partial<Record<FlowerId, number>> }

let seed = 11
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296)

/** A JPEG without its metadata: drops EXIF and XMP (APP1), IPTC (APP13), the
 * other application blocks but JFIF (APP0) and the colour profile (APP2), and
 * comments. */
function bare(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 2)]
  let i = 2
  while (i < b.length && b[i] === 0xff) {
    const m = b[i + 1]
    if (m === 0xda) {
      out.push(b.subarray(i))
      break
    }
    const len = b.readUInt16BE(i + 2)
    const keep = !(m === 0xe1 || m === 0xed || m === 0xfe || (m >= 0xe3 && m <= 0xef))
    if (keep) out.push(b.subarray(i, i + 2 + len))
    i += 2 + len
  }
  return Buffer.concat(out)
}

/** The camera's EXIF orientation (1 upright, 6 turn 90° clockwise, 8 turn
 * 270°, 3 turn 180°); sips doesn't report it for every JPEG. */
function orientation(b: Buffer): number {
  let i = 2
  while (i < b.length - 4 && b[i] === 0xff) {
    const m = b[i + 1]
    const len = b.readUInt16BE(i + 2)
    if (m === 0xe1 && b.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
      const t = b.subarray(i + 10, i + 2 + len)
      const le = t.subarray(0, 2).toString('latin1') === 'II'
      const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o))
      const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o))
      const ifd = u32(4)
      for (let k = 0; k < u16(ifd); k++) if (u16(ifd + 2 + 12 * k) === 0x0112) return u16(ifd + 2 + 12 * k + 8)
      return 1
    }
    if (m === 0xda) break
    i += 2 + len
  }
  return 1
}

// ---- Photos into media, upright and bare ----
const media = join(out, 'media')
fs.mkdirSync(media, { recursive: true })
const prop = (file: string, key: string) => execFileSync('sips', ['-g', key, file], { encoding: 'utf8' }).match(new RegExp(`${key}: (\\S+)`))?.[1]
let n = 0
const copied = new Map<string, { file: string; aspect: number }>()
for (const d of spec.days)
  for (const src of d.photos) {
    if (copied.has(src)) continue
    const file = `demo-${String(++n).padStart(3, '0')}.jpg`
    const dst = join(media, file)
    // Resized, turned upright (the camera's orientation tag is lost on the
    // way, so the pixels are turned instead), and every bit of metadata
    // (location, camera, dates) removed: these can end up in a public repo.
    const turn = ({ 3: 180, 6: 90, 8: 270 } as Record<number, number>)[orientation(fs.readFileSync(src))]
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '1400', src, '--out', dst], { stdio: 'ignore' })
    if (turn) execFileSync('sips', ['-r', String(turn), dst], { stdio: 'ignore' })
    fs.writeFileSync(dst, bare(fs.readFileSync(dst)))
    copied.set(src, { file, aspect: Number(prop(dst, 'pixelHeight')) / Number(prop(dst, 'pixelWidth')) })
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
// A new diary's first seed is always a lotus; the plan's first kind wins here.
let s = seedAs(initialState(when(first + 7 * 3_600_000, kinds[0])), kinds[0])
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
// The same diary kept aside, for the garden's Demo → "100 days" (main: sip:demo-scene).
fs.writeFileSync(join(out, 'demo-100.json'), JSON.stringify(s, null, 2))
fs.writeFileSync(join(out, 'demo.json'), JSON.stringify({ replay: true, seed: 'lotus' }, null, 2) + '\n')
const tally: Record<string, number> = {}
for (const f of s.garden) tally[f.flower] = (tally[f.flower] ?? 0) + 1
console.log(`demo diary: ${s.garden.length} flowers (${Object.entries(tally).map(([k, c]) => `${k} ${c}`).join(', ')}), ${copied.size} photos, today empty`)
