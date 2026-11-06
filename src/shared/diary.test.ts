import { describe, expect, it } from 'vitest'
import {
  addEntry,
  FLOWER_IDS,
  FLOWER_LABELS,
  plantId,
  RARITY,
  seedKind,
  type FlowerId,
  allEntries,
  DRINK_TEXT,
  earlierDays,
  editEntry,
  entriesOn,
  GOAL,
  growth,
  initialState,
  setToday,
  submitDay,
  isOldSave,
  normalize,
  phaseAt,
  plantToGarden,
  POT_IDS,
  removeEntry,
  stageFor,
  takeEntry,
  type DiaryState
} from './diary'

const T0 = new Date(2026, 10, 2, 9, 0).getTime()
const DAY = 86_400_000

const fill = (s: DiaryState, n: number, from = T0) => {
  for (let i = 0; i < n; i++) s = addEntry(s, from + i * 1000, `thing ${i}`)
  return s
}

describe('entries water the plant', () => {
  it('starts as a seed', () => {
    const s = initialState(T0)
    expect(growth(s)).toBe(0)
    expect(phaseAt(s)).toBe('growing')
    expect(s.plant.goal).toBe(GOAL)
    expect(GOAL).toBe(21)
  })

  it('grows by one share per entry', () => {
    expect(growth(fill(initialState(T0), 3))).toBeCloseTo(3 / GOAL)
  })

  it('trims a line, and ignores an empty one', () => {
    const s = initialState(T0)
    expect(addEntry(s, T0, '   ')).toBe(s)
    expect(addEntry(s, T0, '  shipped   it \n').plant.entries[0].text).toBe('shipped it')
  })

  it('gives two lines in one millisecond different times', () => {
    const s = addEntry(addEntry(initialState(T0), T0, 'a'), T0, 'b')
    expect(new Set(s.plant.entries.map((e) => e.at)).size).toBe(2)
  })

  it('keeps the stage thresholds the bloom animation uses', () => {
    expect(stageFor(0)).toBe('Seed')
    expect(stageFor(1 / GOAL)).toBe('Sprout')
    expect(stageFor(0.3)).toBe('Budding')
    expect(stageFor(0.55)).toBe('In bloom')
    expect(stageFor(1)).toBe('Full grown')
  })
})

describe('voice notes', () => {
  const voice = { file: '1762300000000.webm', ms: 7000 }

  it('says a note with no text, and waters the plant once', () => {
    const s = addEntry(initialState(T0), T0, '', voice)
    expect(s.plant.entries).toEqual([{ at: T0, text: '', audio: voice }])
    expect(growth(s)).toBeCloseTo(1 / GOAL)
  })

  it('keeps the peaks a note was saved with', () => {
    const s = addEntry(initialState(T0), T0, '', { file: 'a.webm', ms: 2000, peaks: [0.1, 0.9] })
    expect(s.plant.entries[0].audio).toEqual({ file: 'a.webm', ms: 2000, peaks: [0.1, 0.9] })
  })

  it('keeps a caption with the note, and rounds the length', () => {
    const s = addEntry(initialState(T0), T0, '  the river  ', { file: 'a.webm', ms: 7000.4 })
    expect(s.plant.entries[0]).toEqual({ at: T0, text: 'the river', audio: { file: 'a.webm', ms: 7000 } })
  })

  it('ignores a broken note: no text and a bad file or length', () => {
    const s = initialState(T0)
    expect(addEntry(s, T0, '', { file: '../etc/passwd', ms: 1000 })).toBe(s)
    expect(addEntry(s, T0, '', { file: 'a.webm', ms: 0 })).toBe(s)
    expect(addEntry(s, T0, 'text wins', { file: 'a/b.webm', ms: 1000 }).plant.entries[0]).toEqual({ at: T0, text: 'text wins' })
  })

  it('hands the removed note back, so its file can go', () => {
    const s = addEntry(fill(initialState(T0), 1), T0 + 5000, 'said', voice)
    const { state, removed } = takeEntry(s, T0 + 5000)
    expect(removed?.audio).toEqual(voice)
    expect(state.plant.entries).toHaveLength(1)
    expect(takeEntry(s, 12345)).toEqual({ state: s, removed: null })
    expect(removeEntry(s, T0 + 5000)).toEqual(state)
  })

  it('keeps a note whose caption is emptied', () => {
    const s = addEntry(initialState(T0), T0, 'said', voice)
    expect(editEntry(s, T0, '  ').plant.entries).toEqual([{ at: T0, text: '', audio: voice }])
    expect(editEntry(s, T0, 'fixed').plant.entries[0]).toEqual({ at: T0, text: 'fixed', audio: voice })
  })
})

describe('planting in the garden', () => {
  it('blooms on the last entry and waits to be planted', () => {
    const s = fill(initialState(T0), GOAL)
    expect(phaseAt(s)).toBe('bloomed')
    expect(s.garden).toHaveLength(0)
  })

  it('moves the flower and its entries to the garden, with a new seed in the next glaze', () => {
    const before = fill(initialState(T0), GOAL)
    const s = plantToGarden(before, T0 + DAY)
    expect(s.garden).toHaveLength(1)
    expect(s.garden[0].entries).toHaveLength(GOAL)
    expect(s.garden[0].bloomedAt).toBe(before.plant.entries[GOAL - 1].at)
    expect(s.garden[0].plantedAt).toBe(T0)
    expect(s.plant.entries).toHaveLength(0)
    expect(s.plant.plantedAt).toBe(T0 + DAY)
    expect(s.plant.pot).not.toBe(before.plant.pot)
    expect(POT_IDS).toContain(s.plant.pot)
  })

  it('leaves a growing plant alone', () => {
    const s = fill(initialState(T0), 3)
    expect(plantToGarden(s, T0)).toBe(s)
  })

  it('a line written during the hold plants the flower and waters the seed', () => {
    const s = addEntry(fill(initialState(T0), GOAL), T0 + 60_000, 'one more')
    expect(s.garden).toHaveLength(1)
    expect(s.plant.entries.map((e) => e.text)).toEqual(['one more'])
  })

  it('plants a second flower with its own id', () => {
    let s = plantToGarden(fill(initialState(T0), GOAL), T0 + 60_000)
    s = plantToGarden(fill(s, GOAL, T0 + 120_000), T0 + 180_000)
    expect(new Set(s.garden.map((f) => f.id)).size).toBe(2)
  })
})

describe('changing lines', () => {
  it('removes a line from the plant', () => {
    const s = fill(initialState(T0), 2)
    const after = removeEntry(s, s.plant.entries[0].at)
    expect(after.plant.entries.map((e) => e.text)).toEqual(['thing 1'])
  })

  it('never takes a line from a flower in the garden', () => {
    const s = plantToGarden(fill(initialState(T0), GOAL), T0 + DAY)
    expect(removeEntry(s, s.garden[0].entries[0].at)).toBe(s)
  })

  it('edits a line in the pot or in the garden', () => {
    let s = fill(initialState(T0), GOAL)
    s = plantToGarden(s, T0 + DAY)
    s = addEntry(s, T0 + DAY, 'tpyo')
    const inPot = editEntry(s, s.plant.entries[0].at, 'typo')
    expect(inPot.plant.entries[0].text).toBe('typo')
    const inGarden = editEntry(s, s.garden[0].entries[3].at, 'fixed')
    expect(inGarden.garden[0].entries[3].text).toBe('fixed')
  })

  it('removes a line edited to nothing', () => {
    const s = fill(initialState(T0), 1)
    expect(editEntry(s, s.plant.entries[0].at, ' ').plant.entries).toHaveLength(0)
  })
})

describe('reading the diary', () => {
  it('finds a day across the garden and the pot', () => {
    let s = plantToGarden(fill(initialState(T0), GOAL), T0 + 60_000)
    s = addEntry(s, T0 + 120_000, 'after planting')
    expect(entriesOn(s, T0)).toHaveLength(GOAL + 1)
    expect(entriesOn(s, T0 + DAY)).toHaveLength(0)
    expect(allEntries(s).at(-1)?.text).toBe('after planting')
  })

  it('lists earlier days, newest first, leaving today out', () => {
    let s = initialState(T0 - 3 * DAY)
    s = addEntry(s, T0 - 3 * DAY, 'old')
    s = addEntry(s, T0 - DAY, 'yesterday')
    s = addEntry(s, T0 - DAY + 1000, 'yesterday too')
    s = addEntry(s, T0, 'today')
    const days = earlierDays(s, T0)
    expect(days.map((d) => d.entries.length)).toEqual([2, 1])
    expect(days[0].day).toBeGreaterThan(days[1].day)
  })
})

describe('normalize', () => {
  const now = T0 + 30 * DAY
  const old = {
    plant: {
      flower: 'lotus',
      pot: 'sage',
      name: 'Lotus',
      goalMl: 1500,
      plantedAt: T0,
      drinks: [
        { at: T0 + 2000, ml: 500 },
        { at: T0 + 1000, ml: 250 }
      ],
      bloomedAt: null,
      diedAt: null,
      thirstFrom: null
    },
    library: [
      { id: 'a', flower: 'lotus', pot: 'clay', name: 'Margot', goalMl: 2000, plantedAt: T0 - DAY, bloomedAt: T0 - 1000, drinks: 4 },
      { id: 'b', flower: 'tulip', pot: 'sage', name: 'Daisy', goalMl: 2000, plantedAt: T0 - DAY, bloomedAt: T0 - 500, drinks: 3 }
    ],
    lost: 2,
    sipMl: 250,
    drainMs: 5_400_000,
    dayStart: 8,
    dayEnd: 22,
    lastFlower: 'lotus',
    lastPot: 'ochre',
    lastGoalMl: 2000,
    pos: { x: 10, y: 20 },
    debug: false,
    override: null,
    growthOverride: null
  }

  it('starts fresh from nothing, and from junk', () => {
    expect(normalize(null, now).garden).toEqual([])
    expect(normalize(3, now).plant.entries).toEqual([])
    expect(normalize({ plant: 'x', garden: 7, pos: 'y' }, now).plant.goal).toBe(GOAL)
  })

  it('knows an old save from a new one', () => {
    expect(isOldSave(old)).toBe(true)
    expect(isOldSave(normalize(old, now))).toBe(false)
  })

  it('turns each drink into an entry, in order', () => {
    const s = normalize(old, now)
    expect(s.plant.entries).toEqual([
      { at: T0 + 1000, text: DRINK_TEXT },
      { at: T0 + 2000, text: DRINK_TEXT }
    ])
    expect(s.plant.pot).toBe('sage')
    expect(s.plant.goal).toBe(GOAL)
    expect(growth(s)).toBeCloseTo(2 / GOAL)
  })

  it('turns the library into the garden, keeping how many drinks grew each flower', () => {
    const s = normalize(old, now)
    expect(s.garden.map((f) => f.id)).toEqual(['a', 'b'])
    expect(s.garden[0].entries).toHaveLength(4)
    expect(s.garden[0].entries.at(-1)?.at).toBe(T0 - 1000)
    expect(s.garden[0].name).toBe('Margot')
    expect(s.garden[1].flower).toBe('lotus')
    expect(s.garden[1].name).toBe('Lotus')
  })

  it('plants the old bloomed lotus in the garden', () => {
    const s = normalize({ ...old, plant: { ...old.plant, bloomedAt: T0 + 2000 } }, now)
    expect(s.garden).toHaveLength(3)
    const f = s.garden[2]
    expect(f.pot).toBe('sage')
    expect(f.bloomedAt).toBe(T0 + 2000)
    expect(f.entries).toHaveLength(2)
    expect(s.plant.entries).toEqual([])
  })

  it('brings a dead plant back', () => {
    const s = normalize({ ...old, plant: { ...old.plant, diedAt: T0 + 3000 } }, now)
    expect(phaseAt(s)).toBe('growing')
    expect(s.plant.entries).toHaveLength(2)
  })

  it('puts a seed in an empty pot, in the last glaze', () => {
    const s = normalize({ ...old, plant: null }, now)
    expect(s.plant.pot).toBe('ochre')
    expect(s.plant.entries).toEqual([])
  })

  it('leaves the old desktop window\'s position and switch behind', () => {
    const s = normalize({ ...old, desktop: true }, now)
    expect(s).not.toHaveProperty('pos')
    expect(s).not.toHaveProperty('desktop')
  })

  it('round-trips a new file unchanged', () => {
    const s = plantToGarden(fill(initialState(T0), GOAL), T0 + 60_000)
    const again = normalize(JSON.parse(JSON.stringify(addEntry(s, T0 + 70_000, 'hello'))), now)
    expect(again.garden).toEqual(s.garden)
    expect(again.plant.entries[0].text).toBe('hello')
    // Migrating twice can't duplicate anything.
    expect(normalize(JSON.parse(JSON.stringify(normalize(old, now))), now).garden).toHaveLength(2)
  })

  it('plants a plant that was saved full grown (quit during the hold)', () => {
    const s = normalize(JSON.parse(JSON.stringify(fill(initialState(T0), GOAL))), now)
    expect(s.garden).toHaveLength(1)
    expect(s.plant.entries).toEqual([])
  })

  it('keeps a voice note\'s peaks, clamped, and drops a broken list', () => {
    const voice = { file: 'a.webm', ms: 3000 }
    const raw = {
      plant: {
        flower: 'lotus',
        pot: 'clay',
        entries: [
          { at: T0, text: '', audio: { ...voice, peaks: [0, 0.5, 1.4, -0.2, 0.12345] } },
          { at: T0 + 1, text: '', audio: { ...voice, peaks: [0.2, 'loud'] } },
          { at: T0 + 2, text: '', audio: { ...voice, peaks: Array(300).fill(0.5) } }
        ]
      }
    }
    const s = normalize(raw, now)
    expect(s.plant.entries.map((e) => e.audio)).toEqual([{ ...voice, peaks: [0, 0.5, 1, 0, 0.123] }, voice, voice])
    // And it survives a save.
    expect(normalize(JSON.parse(JSON.stringify(s)), now)).toEqual(s)
  })

  it('keeps a voice note, and drops a malformed one', () => {
    const voice = { file: '1762300000000.webm', ms: 7000 }
    const raw = {
      plant: {
        flower: 'lotus',
        pot: 'clay',
        entries: [
          { at: T0, text: '', audio: voice },
          { at: T0 + 1, text: 'with caption', audio: { ...voice, extra: 1 } },
          { at: T0 + 2, text: '', audio: { file: '../x.webm', ms: 7000 } },
          { at: T0 + 3, text: 'text stays', audio: { file: 'a.webm', ms: 'long' } }
        ]
      },
      garden: [{ id: 'g', flower: 'lotus', pot: 'clay', plantedAt: T0 - DAY, bloomedAt: T0 - 1000, entries: [{ at: T0 - 2000, text: '', audio: voice }] }]
    }
    const s = normalize(raw, now)
    expect(s.plant.entries).toEqual([
      { at: T0, text: '', audio: voice },
      { at: T0 + 1, text: 'with caption', audio: voice },
      { at: T0 + 3, text: 'text stays' }
    ])
    expect(s.garden[0].entries).toEqual([{ at: T0 - 2000, text: '', audio: voice }])
  })

  it('drops broken entries and future times', () => {
    const raw = { plant: { flower: 'lotus', pot: 'clay', entries: [{ at: T0, text: 'ok' }, { at: now + DAY, text: 'future' }, { at: T0, text: 5 }, null] } }
    expect(normalize(raw, now).plant.entries).toEqual([{ at: T0, text: 'ok' }])
  })
})

describe('rarity', () => {
  it('draws seeds by RARITY: the lotus rarest, the ground flowers commonest', () => {
    const n = 20000
    const counts = Object.fromEntries(FLOWER_IDS.map((k) => [k, 0])) as Record<FlowerId, number>
    for (let i = 0; i < n; i++) counts[seedKind(plantId(T0 + i * 977))]++
    const sum = FLOWER_IDS.reduce((t, k) => t + RARITY[k], 0)
    for (const k of FLOWER_IDS) expect(Math.abs(counts[k] / n - RARITY[k] / sum)).toBeLessThan(0.012)
    expect(counts.lotus).toBeLessThan(counts.chrysanthemum)
    expect(counts.chrysanthemum).toBeLessThan(counts.iris)
    expect(counts.iris).toBeLessThan(counts.lily)
    expect(counts.lily).toBeLessThan(counts.daisy)
  })

  it('starts every diary with a lotus, then draws each new seed by rarity', () => {
    const s = initialState(T0)
    expect(s.plant).toMatchObject({ flower: 'lotus', name: 'Lotus' })
    const next = submitDay(setToday(s, T0, [{ id: 'a', kind: 'text', x: 13, y: 21, text: 'day one' }]), T0 + 1000)
    expect(next.garden[0].flower).toBe('lotus')
    expect(next.plant.flower).toBe(seedKind(next.plant.id))
    expect(next.plant.name).toBe(FLOWER_LABELS[next.plant.flower])
  })
})
