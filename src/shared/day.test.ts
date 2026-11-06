import { describe, expect, it } from 'vitest'
import {
  addEntry,
  asItem,
  daySize,
  asItems,
  daysFromEntries,
  gardenView,
  GOAL,
  growth,
  initialState,
  normalize,
  pastDays,
  plantToGarden,
  reopenToday,
  rollDay,
  seedAs,
  setToday,
  startOfDay,
  submitDay,
  visitFor,
  type DiaryState,
  type Item
} from './diary'

const T0 = new Date(2026, 10, 5, 9).getTime()
const DAY = 86_400_000
const text = (id: string, t: string, x = 0, y = 0): Item => ({ id, kind: 'text', x, y, text: t })
const ink = (id: string): Item => ({ id, kind: 'ink', x: 10, y: 10, points: [0, 0, 5, 5, 10, 2] })

describe('items', () => {
  it('keeps a well-formed item of each kind', () => {
    expect(asItem(text('a', 'hi\nthere'))).toEqual({ id: 'a', kind: 'text', x: 0, y: 0, text: 'hi\nthere' })
    expect(asItem(ink('b'))?.points).toEqual([0, 0, 5, 5, 10, 2])
    expect(asItem({ id: 'c', kind: 'image', x: 1, y: 2, w: 120, h: 80, file: 'pic.png' })).toMatchObject({ w: 120, h: 80, file: 'pic.png' })
    expect(asItem({ id: 'd', kind: 'voice', x: 0, y: 0, file: 'a.webm', ms: 3000.4, peaks: [0.5, 2] })).toMatchObject({ ms: 3000, peaks: [0.5, 1] })
  })
  it('drops broken ones', () => {
    expect(asItem({ id: 'a', kind: 'text', x: 0, y: 0 })).toBeNull()
    expect(asItem({ id: 'a', kind: 'ink', x: 0, y: 0, points: [1, 2] })).toBeNull()
    expect(asItem({ id: 'a', kind: 'image', x: 0, y: 0, file: '../etc/passwd' })).toBeNull()
    expect(asItem({ id: 'a', kind: 'voice', x: 0, y: 0, file: 'a.webm' })).toBeNull()
    expect(asItem({ id: 'a b', kind: 'text', x: 0, y: 0, text: '' })).toBeNull()
    expect(asItem({ id: 'a', kind: 'sticker', x: 0, y: 0 })).toBeNull()
    expect(asItems([text('a', 'x'), text('a', 'y'), null])).toHaveLength(1)
  })
})

describe('the day', () => {
  it('starts empty, and autosaves as you go', () => {
    let s = initialState(T0)
    expect(s.today).toEqual({ date: startOfDay(T0), items: [] })
    s = setToday(s, T0, [text('a', 'coffee with Jo'), ink('b')])
    expect(s.today.items).toHaveLength(2)
    expect(growth(s)).toBe(0)
  })

  it('submit grows the day’s flower all the way and plants it; a seed waits for tomorrow', () => {
    const s0 = setToday(initialState(T0), T0, [text('a', 'coffee with Jo'), ink('b'), text('c', '   '), { id: 'd', kind: 'voice', x: 0, y: 0, file: 'v.webm', ms: 2000 }])
    const id = s0.plant.id
    const s = submitDay(s0, T0 + 1000)
    expect(s.today.submittedAt).toBe(T0 + 1000)
    // One day, one flower: planted now, full bloom, the empty text block not counted.
    expect(s.garden).toHaveLength(1)
    expect(s.garden[0].id).toBe(id)
    expect(s.garden[0].entries.map((e) => e.text)).toEqual(['coffee with Jo', 'a drawing', ''])
    expect(s.garden[0].entries[2].audio?.file).toBe('v.webm')
    expect(s.garden[0].days).toHaveLength(1)
    expect(s.garden[0].size).toBeCloseTo(daySize(3))
    expect(s.today.flower).toBe(id)
    expect(s.today.grew).toEqual([0, 1])
    expect(visitFor(s)).toEqual({ id, from: 0, to: 1 })
    // A new seed for tomorrow, nothing on it yet.
    expect(s.plant.id).not.toBe(id)
    expect(growth(s)).toBe(0)
    // Locked: autosave and a second submit change nothing.
    expect(setToday(s, T0 + 2000, [])).toBe(s)
    expect(submitDay(s, T0 + 3000)).toBe(s)
  })

  it('sizes a day’s flower by how much it held: 70 % for one thing, full from five', () => {
    expect(daySize(1)).toBeCloseTo(0.7)
    expect(daySize(3)).toBeCloseTo(0.85)
    expect(daySize(5)).toBe(1)
    expect(daySize(12)).toBe(1)
    const one = submitDay(setToday(initialState(T0), T0, [text('a', 'x')]), T0)
    expect(one.garden[0].size).toBeCloseTo(0.7)
    const five = submitDay(setToday(initialState(T0), T0, ['a', 'b', 'c', 'd', 'e'].map((k) => text(k, k))), T0)
    expect(five.garden[0].size).toBeUndefined()
  })

  it('an empty day submits nothing', () => {
    const s = setToday(initialState(T0), T0, [text('a', '')])
    expect(submitDay(s, T0)).toBe(s)
  })

  it('a plant part-grown by older lines is finished by the day', () => {
    let s = initialState(T0 - 10 * DAY)
    for (let i = 0; i < 5; i++) s = addEntry(s, T0 - 5 * DAY + i, `line ${i}`)
    const id = s.plant.id
    s = submitDay(setToday(s, T0, [text('a', 'one'), text('b', 'two')]), T0)
    expect(s.garden[0].id).toBe(id)
    expect(s.garden[0].entries).toHaveLength(7)
    expect(s.garden[0].days.at(-1)?.items.map((i) => i.text)).toEqual(['one', 'two'])
    expect(visitFor(s)).toEqual({ id, from: 5 / GOAL, to: 1 })
  })

  it('a new day submits what was left on yesterday’s board and starts clean', () => {
    let s = setToday(initialState(T0), T0, [text('a', 'left open')])
    s = rollDay(s, T0 + DAY)
    expect(s.today).toEqual({ date: startOfDay(T0 + DAY), items: [] })
    // Yesterday's flower, planted with its day.
    expect(s.garden[0].entries[0].text).toBe('left open')
    expect(startOfDay(s.garden[0].entries[0].at)).toBe(startOfDay(T0))
    expect(pastDays(s).map((p) => p.day.date)).toEqual([startOfDay(T0)])
  })

  it('the garden sees a part-grown plant at its growth, and not an empty seed', () => {
    let s = initialState(T0)
    expect(gardenView(s)).toEqual([])
    s = addEntry(s, T0, 'an older line')
    const view = gardenView(s)
    expect(view).toHaveLength(1)
    expect(view[0]).toMatchObject({ id: s.plant.id, growth: 1 / GOAL })
  })
})

describe('migration', () => {
  it('old lines become one text item each, a board per day, submitted', () => {
    const days = daysFromEntries(
      [
        { at: T0, text: 'one' },
        { at: T0 + 1000, text: 'two', audio: { file: 'a.webm', ms: 1000 } },
        { at: T0 + DAY, text: 'three' }
      ],
      'f1'
    )
    expect(days).toHaveLength(2)
    expect(days[0]).toMatchObject({ date: startOfDay(T0), flower: 'f1', submittedAt: T0 + 1000 })
    expect(days[0].items.map((i) => i.kind)).toEqual(['text', 'voice', 'text'])
    expect(days[1].items).toEqual([{ id: `m${(T0 + DAY).toString(36)}`, kind: 'text', x: 0, y: 0, text: 'three' }])
  })

  it('an older save gets boards for its garden and its plant, and a clean today', () => {
    const now = T0 + 3 * DAY
    const raw = {
      plant: { flower: 'lotus', pot: 'clay', name: 'Lotus', plantedAt: T0, goal: 21, entries: [{ at: T0, text: 'a' }, { at: T0 + DAY, text: 'b' }] },
      garden: [{ id: 'g1', flower: 'iris', pot: 'sage', name: 'Iris', plantedAt: T0 - 9 * DAY, bloomedAt: T0 - DAY, entries: [{ at: T0 - 2 * DAY, text: 'c' }] }]
    }
    const s: DiaryState = normalize(raw, now)
    expect(s.plant.days).toHaveLength(2)
    expect(s.plant.id).toBe(`p${T0.toString(36)}`)
    expect(s.garden[0].days).toHaveLength(1)
    expect(s.today).toEqual({ date: startOfDay(now), items: [] })
    // Growth is unchanged: the lines are still the waterings.
    expect(s.plant.entries).toHaveLength(2)
    // And round-trips.
    expect(normalize(JSON.parse(JSON.stringify(s)), now)).toEqual(s)
  })
})

describe('demo', () => {
  it('reopens today: the flower goes back to being the seed, the page open with its things', () => {
    const s0 = seedAs(setToday(initialState(T0), T0, [text('a', 'hello'), text('b', 'there')]), 'lotus')
    const s1 = submitDay(s0, T0 + 1000)
    expect(s1.garden).toHaveLength(1)
    const back = reopenToday(s1)
    expect(back.garden).toHaveLength(0)
    expect(back.plant).toMatchObject({ id: s0.plant.id, flower: 'lotus', pot: s0.plant.pot, entries: [] })
    expect(back.today).toEqual({ date: s0.today.date, items: s0.today.items })
    // And again, the same take.
    expect(submitDay(back, T0 + 2000).garden[0]).toMatchObject({ id: s0.plant.id, flower: 'lotus' })
  })

  it('makes only an empty seed the asked kind', () => {
    const s = initialState(T0)
    expect(seedAs(s, 'lotus').plant).toMatchObject({ flower: 'lotus', name: 'Lotus' })
    const grown = addEntry(s, T0, 'a line')
    expect(seedAs(grown, 'lotus')).toBe(grown)
  })
})
