import { useEffect, useState } from 'react'
import type { CapturePose, SipBridge } from '../../shared/bridge'
import {
  addEntry,
  gardenView,
  normalize,
  phaseAt,
  PLANT_HOLD_MS,
  plantToGarden,
  setToday,
  submitDay,
  visitFor,
  type DiaryState,
  type GardenFlower,
  type Item
} from '../../shared/diary'

/** Files kept this session in the browser preview (it has no disk): name → blob URL. */
const mockFiles = new Map<string, string>()

/** Where a board's file is: the app's protocols, or the preview's own. */
export function fileSrc(it: Pick<Item, 'kind' | 'file'>): string | null {
  if (!it.file) return null
  if (window.sip) return `${it.kind === 'voice' ? 'sip-audio' : 'sip-media'}://${it.file}`
  return mockFiles.get(it.file) ?? `/${it.file}`
}

// Browser mock of the Electron bridge, so the pad and the garden run in any
// browser tab (handy for the browser pane and for tweaking without Electron).
function mockBridge(): SipBridge {
  const KEY = 'sip-flower-diary'
  const read = () => {
    try {
      return normalize(JSON.parse(localStorage.getItem(KEY) ?? 'null'), Date.now())
    } catch {
      return normalize(null, Date.now())
    }
  }
  let diary = read()
  const diaryListeners = new Set<(s: DiaryState, now: number) => void>()
  const gardenListeners = new Set<(g: GardenFlower[]) => void>()
  const wateredListeners = new Set<() => void>()
  const commit = (s: DiaryState) => {
    const planted = s.garden !== diary.garden || s.plant !== diary.plant
    diary = s
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      /* private mode: in-memory only */
    }
    diaryListeners.forEach((l) => l(s, Date.now()))
    if (planted) gardenListeners.forEach((l) => l(gardenView(s)))
  }
  const water = (next: DiaryState) => {
    if (next === diary) return
    commit(next)
    wateredListeners.forEach((l) => l())
    if (phaseAt(next) === 'bloomed') setTimeout(() => commit(plantToGarden(diary, Date.now())), PLANT_HOLD_MS)
  }
  const noop = () => {}
  const keep = (bytes: ArrayBuffer, ext: string) => {
    const name = `${Date.now()}-${mockFiles.size}.${ext}`
    mockFiles.set(name, URL.createObjectURL(new Blob([bytes])))
    return name
  }

  return {
    getDiary: async () => ({ state: diary, now: Date.now() }),
    onDiary: (cb) => (diaryListeners.add(cb), () => diaryListeners.delete(cb)),
    addEntry: (text) => water(addEntry(diary, Date.now(), text)),
    saveToday: (items) => {
      const next = setToday(diary, Date.now(), items)
      if (next !== diary) commit(next)
    },
    submitToday: () => water(submitDay(diary, Date.now())),
    addMedia: async (bytes, ext) => keep(bytes, ext),
    addAudio: async (bytes) => keep(bytes, 'webm'),
    // `?mic=off` tries the pad's microphone-off state.
    askMic: async () => new URLSearchParams(location.search).get('mic') !== 'off',
    openMicSettings: noop,
    closePad: noop,
    onPadShown: () => noop,
    onPadHidden: () => noop,
    openGarden: () => window.open('/garden.html', 'sip-garden', 'width=900,height=650'),
    pinPad: noop,
    visitGarden: () => {
      const v = visitFor(diary)
      window.open(`/garden.html${v ? `?visit=${v.id},${v.from},${v.to}` : ''}`, 'sip-garden', 'width=900,height=650')
    },
    takeVisit: async () => {
      const v = new URLSearchParams(location.search).get('visit')?.split(',')
      return v && v.length === 3 ? { id: v[0], from: Number(v[1]), to: Number(v[2]) } : null
    },
    onVisit: () => noop,
    getGarden: async () => gardenView(diary),
    onGarden: (cb) => (gardenListeners.add(cb), () => gardenListeners.delete(cb)),
    onOpenSheet: () => noop,
    onCapturePose: () => noop,
    capturePosed: noop,
    onWatered: (cb) => (wateredListeners.add(cb), () => wateredListeners.delete(cb)),
    getModel: async (id) => {
      const res = await fetch(`/flowers/${id}.glb`).catch(() => null)
      return res?.ok ? res.arrayBuffer() : null
    },
    onExportRequest: () => noop,
    exportDone: noop,
    reportModel: noop
  }
}

export const bridge: SipBridge = window.sip ?? mockBridge()
/** Running in a plain browser (the web preview), not in the app. */
export const isWebPreview = !window.sip

/** Live diary, and when it was last heard from. */
export function useDiary() {
  const [state, setState] = useState<DiaryState | null>(null)
  useEffect(() => {
    let alive = true
    bridge.getDiary().then(({ state }) => alive && setState(state))
    const off = bridge.onDiary((s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

export function useCapturePose() {
  const [pose, setPose] = useState<CapturePose | null>(null)
  useEffect(() => bridge.onCapturePose(setPose), [])
  return pose
}
