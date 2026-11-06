import { daysFromEntries, type Day, type FlowerId, type PotId } from '../../../shared/diary'
import { bedRoom } from './layout'
import type { GardenFlower } from './types'

const LAWN: FlowerId[] = ['blossom', 'iris', 'lily', 'chrysanthemum', 'daisy', 'nemophila', 'jasmine', 'shrub']

const POTS: PotId[] = ['celadon', 'ochre', 'cream', 'sage', 'clay']
const NAMES = ['Ume', 'Hasu', 'Sora', 'Kumo', 'Mizu', 'Tsuki', 'Yuki', 'Hana', 'Nagi', 'Koto']
const DONE = [
  'shipped the pad',
  'walked to the river',
  'fixed the tray icon',
  'called mum',
  'read a chapter',
  'cooked something new',
  'cleared the inbox',
  'stretched for ten minutes',
  'drew a koi',
  'went to bed on time'
]
const DAY = 86_400_000
/** What a third of the flowers were told, as voice notes (the 3 s sample tone in the preview). */
const SAID = ['the light on the water this morning', '', 'that long call with Nagi']

/** A garden's worth, in the proportions the beds are planted in (layout.ts):
 * each kind's share of the lawn, lotuses in the pond. */
const SHARE: Partial<Record<FlowerId, number>> = { lotus: 5, ...Object.fromEntries(LAWN.map((k) => [k, bedRoom(k)])) }
/** The kinds in the order they bloom: interleaved by share, so any first few
 * are a mix of everything, and the whole is the planted border. */
const KINDS: FlowerId[] = (Object.entries(SHARE) as [FlowerId, number][])
  .flatMap(([kind, n]) => Array.from({ length: n }, (_, i) => ({ kind, at: (i + 0.5) / n })))
  .sort((a, b) => a.at - b.at)
  .map((p) => p.kind)
/** Every kind's beds full. */
export const FULL = KINDS.length

/** `n` flowers of every kind, with different glazes and dates, oldest first. */
export function mockFlowers(n = 6, now = Date.UTC(2026, 10, 2, 12)): GardenFlower[] {
  return Array.from({ length: n }, (_, i) => {
    const bloomedAt = now - (n - i) * 9 * DAY
    const plantedAt = bloomedAt - 7 * DAY
    const flower = {
      id: `mock-${i}`,
      flower: KINDS[i % KINDS.length],
      pot: POTS[i % POTS.length],
      name: NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ''),
      plantedAt,
      bloomedAt,
      entries: Array.from({ length: 5 + (i * 3) % 4 }, (_, k) => {
        const e = { at: plantedAt + k * DAY, text: DONE[(i * 3 + k) % DONE.length] }
        // Every third flower has a voice note or two among its lines.
        if (i % 3 === 0 && (k === 1 || (k === 3 && i % 2 === 0)))
          return { ...e, text: SAID[(i + k) % SAID.length], audio: { file: 'sample.webm', ms: 3000 } }
        return e
      })
    }
    return { ...flower, days: daysFromEntries(flower.entries, flower.id).map((d, k) => board(d, i + k)) }
  })
}

/** A migrated day as a page: its lines as the words at the top, any voice
 * note (an older day's) low on the paper. */
function board(d: Day, seed: number): Day {
  const text = d.items
    .filter((i) => i.kind === 'text')
    .map((i) => i.text)
    .join('. ')
  const notes = d.items.filter((i) => i.kind === 'voice').map((it, k) => ({ ...it, x: 30 + ((seed * 13) % 30), y: 180 + k * 52 }))
  return { ...d, items: [...(text ? [{ id: `${d.date}t`, kind: 'text' as const, x: 13, y: 21, text }] : []), ...notes] }
}
