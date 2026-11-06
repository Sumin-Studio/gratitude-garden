import { app, BrowserWindow, ipcMain, Menu, net, protocol, screen, shell, systemPreferences } from 'electron'
import fs from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CapturePose } from '../shared/bridge'
import {
  addEntry,
  DRINK_TEXT,
  FLOWER_IDS,
  gardenView,
  initialState,
  isOldSave,
  normalize,
  phaseAt,
  PLANT_HOLD_MS,
  plantToGarden,
  rollDay,
  reopenToday,
  seedAs,
  setDayWindow,
  setToday,
  submitDay,
  visitFor,
  type DiaryState,
  type FlowerId,
  type Item,
  type Visit
} from '../shared/diary'
import { getGardenWindow, openGardenWindow } from './garden'
import { createPad, expectBlur, getPad, hidePad, showPad } from './pad'
import { padShotState, runPadShot } from './padshot'
import { snapGarden } from './snap'
import { readDemo, writeDemo, type Demo } from './demo'
import { runSelfTest } from './selftest'
import { createTray, refreshTray, resourcePath, trayBounds, trayTest } from './tray'

// Sip Flower main process: the tray icon, the pad under it, the garden window
// and the diary on disk. The capture, perf and export modes open a studio
// window instead (the flower alone, studio.html), never the pad.

// The studio's flower square, in screen px (the pad's flower is the same
// framing at 300 × 399).
const W = 351
const H = 467

if (process.env.SIP_USER_DATA) app.setPath('userData', process.env.SIP_USER_DATA)
const CAPTURE_DIR = process.env.SIP_CAPTURE
const SELFTEST = process.env.SIP_SELFTEST === '1'
// SIP_PERF=1: measure the studio flower's frame times (idle, bloomed, brushed), print JSON, quit.
const PERF = process.env.SIP_PERF === '1'
const EXPORT_DIR = process.env.SIP_EXPORT
const PADSHOT_DIR = process.env.SIP_PADSHOT
const HEADLESS = Boolean(CAPTURE_DIR || SELFTEST || EXPORT_DIR || PADSHOT_DIR || PERF)

/** The capture studio (headless modes only). */
let win: BrowserWindow | null = null
let state: DiaryState

const stateFile = () => join(app.getPath('userData'), 'state.json')
/** Voice notes, one webm each, named by when they were said. */
const audioDir = () => join(app.getPath('userData'), 'audio')
/** Pictures and videos put on a board. */
const mediaDir = () => join(app.getPath('userData'), 'media')
const AUDIO_NAME = /^[\w.-]+$/
const MEDIA_EXT = /^(png|jpe?g|gif|webp|heic|avif|mp4|mov|webm)$/

// Voice notes play back from sip-audio://<file>, pictures from
// sip-media://<file>; each serves only its folder. Registered before the app
// is ready, as a scheme must be.
protocol.registerSchemesAsPrivileged([
  { scheme: 'sip-audio', privileges: { secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'sip-media', privileges: { secure: true, stream: true, supportFetchAPI: true } }
])
// The test modes record from Chromium's fake microphone (a tone) and never
// touch the real one, so no permission dialog can block them.
if (SELFTEST || PADSHOT_DIR) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}

function serveFiles() {
  for (const [scheme, dir] of [
    ['sip-audio', audioDir],
    ['sip-media', mediaDir]
  ] as const)
    protocol.handle(scheme, (req) => {
      const name = decodeURIComponent(req.url.replace(/^[\w-]+:\/\//, '').split(/[?#]/)[0].replace(/\/$/, ''))
      if (!AUDIO_NAME.test(name) || name.includes('..')) return new Response(null, { status: 403 })
      const file = join(dir(), name)
      if (!fs.existsSync(file)) return new Response(null, { status: 404 })
      return net.fetch(pathToFileURL(file).href, { headers: req.headers })
    })
}

/** A new file in `dir`, named by when it came: its name. */
function keepFile(dir: string, bytes: Uint8Array, ext: string) {
  fs.mkdirSync(dir, { recursive: true })
  const now = Date.now()
  let file = `${now}.${ext}`
  for (let k = 1; fs.existsSync(join(dir, file)); k++) file = `${now}-${k}.${ext}`
  fs.writeFileSync(join(dir, file), bytes)
  return file
}

/** The files a board refers to. */
const filesOf = (items: Item[]) => new Set(items.flatMap((it) => (it.file ? [`${it.kind === 'voice' ? 'a' : 'm'}:${it.file}`] : [])))

function load() {
  if (PADSHOT_DIR && process.env.SIP_PADSHOT_SCENE !== 'real') {
    state = padShotState(Date.now())
    return
  }
  if (SELFTEST) {
    state = initialState(Date.now())
    return
  }
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    // The water tracker's file, once, before it's replaced.
    if (isOldSave(raw)) fs.copyFileSync(stateFile(), stateFile() + '.water-tracker')
    state = normalize(raw, Date.now())
  } catch {
    state = initialState(Date.now())
  }
}

function save() {
  const file = stateFile()
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 2))
  fs.renameSync(file + '.tmp', file)
}

export function getState() {
  return state
}

/** Demo mode (demo.ts), read at launch; null in normal use and the test modes. */
let demo: Demo | null = null

export function commit(next: DiaryState) {
  if (demo?.seed) next = seedAs(next, demo.seed)
  // The garden draws the growing plant too, so it hears of every watering.
  const grew = next.garden !== state.garden || next.plant !== state.plant
  state = next
  save()
  const now = Date.now()
  getPad()?.webContents.send('sip:diary', state, now)
  win?.webContents.send('sip:diary', state, now)
  if (grew) getGardenWindow()?.webContents.send('sip:garden', gardenView(state))
  refreshTray()
}

/** Past midnight: yesterday's board is put away, today's starts clean. */
export function rollOver() {
  const next = rollDay(state, Date.now())
  if (next === state) return
  commit(next)
  plantWhenFull()
}

/** A line went in: the plant grows, and the rain falls on it. The line that
 * fills it holds the bloom a moment before planting it in the garden. */
let planting: NodeJS.Timeout | undefined
function watered(next: DiaryState) {
  commit(next)
  getPad()?.webContents.send('sip:watered')
  win?.webContents.send('sip:watered')
  plantWhenFull()
}

function plantWhenFull() {
  clearTimeout(planting)
  if (phaseAt(state) === 'bloomed') planting = setTimeout(() => commit(plantToGarden(state, Date.now())), PLANT_HOLD_MS)
}

/** Write a line. */
function writeLine(text: string) {
  const next = addEntry(state, Date.now(), text)
  if (next !== state) watered(next)
}

/** Autosave today's board. A picture or note taken off it goes from disk too
 * (nothing else can refer to it: only a submitted board is kept). */
function saveToday(items: unknown) {
  const was = state.today
  const next = setToday(state, Date.now(), items)
  if (next === state) return
  if (next.today.date === was.date && !was.submittedAt) {
    const keep = filesOf(next.today.items)
    for (const f of filesOf(was.items))
      if (!keep.has(f)) fs.rmSync(join(f.startsWith('a:') ? audioDir() : mediaDir(), f.slice(2)), { force: true })
  }
  commit(next)
}

/** Submit for today: each thing on the board waters the plant once, the
 * garden opens on it blooming, and a picture of the garden round it goes on
 * the page (snap.ts). */
function submitToday() {
  rollOver()
  const next = submitDay(state, Date.now())
  if (next === state) return
  watered(next)
  // Straight into the garden to watch it bloom (Simon). The page's picture
  // of it is drawn once the visit has played, so the two don't load at once.
  visitGarden()
  setTimeout(() => void snapToday(), SNAP_AFTER_MS)
}

/** How long after a Submit the page's garden picture is drawn: past the
 * garden's loader, the bloom and the way back out. */
const SNAP_AFTER_MS = 9000

async function snapToday() {
  const d = state.today
  if (!d.submittedAt || !d.flower || d.window) return
  const name = `garden-${d.date.toString(36)}-${Date.now().toString(36)}.png`
  fs.mkdirSync(mediaDir(), { recursive: true })
  const ok = await snapGarden(d.flower, join(mediaDir(), name)).catch((e) => {
    console.warn('snap: the garden picture failed', e)
    return false
  })
  if (ok) commit(setDayWindow(state, d.date, name))
}

export function openGarden() {
  hidePad(true)
  openGardenWindow()
}

/** Check out the garden: the garden window, on the flower today watered,
 * blooming from where it stood this morning. A window just opening asks for
 * the visit once it has loaded (takeVisit); one already open is told now. */
let visit: Visit | null = null
export function visitGarden() {
  const v = visitFor(state)
  const open = getGardenWindow()
  openGarden()
  if (!v) return
  if (open && !open.webContents.isLoading()) open.webContents.send('sip:visit', v)
  else visit = v
}

/** Tray → Write or record: the pad, with the sheet up. */
export async function writeOrRecord(anchor: Electron.Rectangle) {
  await showPad(anchor)
  getPad()?.webContents.send('sip:open-sheet')
}

/** The studio: the flower alone, for the capture, perf and export modes. */
function createStudio() {
  win = new BrowserWindow({
    width: W,
    height: H,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Kept running: these modes time things.
      backgroundThrottling: false
    }
  })
  win.once('ready-to-show', () => win?.showInactive())
  win.on('closed', () => (win = null))
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/studio.html`)
  else win.loadFile(join(__dirname, '../renderer/studio.html'))
  win.webContents.on('console-message', (e) => console.log(`[studio] ${e.message}`))
  // Chromium remembers a page's zoom per origin; the flower is always 1:1
  // (review captures zoom in, and must not leave the next run zoomed).
  win.webContents.on('did-finish-load', () => win?.webContents.setZoomFactor(1))
  if (CAPTURE_DIR) win.webContents.once('did-finish-load', () => setTimeout(runCapture, 900))
  if (PERF) win.webContents.once('did-finish-load', () => setTimeout(runPerf, 2500))
  if (EXPORT_DIR) win.webContents.once('did-finish-load', () => setTimeout(runExport, 500))
}

// ---- IPC ---------------------------------------------------------------

ipcMain.handle('sip:diary-get', () => {
  rollOver()
  return { state, now: Date.now() }
})
ipcMain.handle('sip:garden-get', () => gardenView(state))

ipcMain.on('sip:entry-add', (_e, text: unknown) => {
  if (typeof text === 'string') writeLine(text)
})
ipcMain.on('sip:today-save', (_e, items: unknown) => saveToday(items))
ipcMain.on('sip:today-submit', () => submitToday())
const okBytes = (b: unknown, max: number): b is Uint8Array => b instanceof Uint8Array && b.byteLength > 0 && b.byteLength < max
ipcMain.handle('sip:media-add', (_e, bytes: unknown, ext: unknown) => {
  const x = typeof ext === 'string' ? ext.toLowerCase().replace(/^jpeg$/, 'jpg') : ''
  return okBytes(bytes, 200_000_000) && MEDIA_EXT.test(x) ? keepFile(mediaDir(), bytes, x) : null
})
ipcMain.handle('sip:audio-add', (_e, bytes: unknown) => (okBytes(bytes, 50_000_000) ? keepFile(audioDir(), bytes, 'webm') : null))
ipcMain.on('sip:visit-garden', () => visitGarden())
// Demo mode from the garden's Fine tune: the same as demo.json.
ipcMain.handle('sip:demo-get', () => ({ replay: !!demo?.replay, lotus: demo?.seed === 'lotus' }))
ipcMain.on('sip:demo-set', (_e, d: unknown) => {
  const r = d as { replay?: unknown; lotus?: unknown } | null
  demo = { replay: r?.replay === true, seed: r?.lotus === true ? 'lotus' : null }
  writeDemo(demo)
  if (demo.seed) commit(seedAs(state, demo.seed))
})
ipcMain.on('sip:demo-reset', () => resetToday())
// Demo scenes: day 1 (a new garden, a lotus seed) or the 100-day diary.
ipcMain.on('sip:demo-scene', (_e, scene: unknown) => {
  const now = Date.now()
  let next: DiaryState | null = null
  if (scene === 'day1') next = initialState(now)
  if (scene === 'days100') {
    try {
      // One you built yourself (scripts/demo-diary.mts) wins; otherwise the
      // one that ships with the app, its photos copied into media.
      const own = join(app.getPath('userData'), 'demo-100.json')
      const dir = demoDir()
      const raw = JSON.parse(fs.readFileSync(fs.existsSync(own) ? own : join(dir, 'demo-100.json'), 'utf8'))
      if (!fs.existsSync(own)) {
        fs.mkdirSync(mediaDir(), { recursive: true })
        for (const f of fs.readdirSync(join(dir, 'media'))) fs.copyFileSync(join(dir, 'media', f), join(mediaDir(), f))
      }
      next = normalize(raw, now)
      next = { ...next, today: { date: next.today.date, items: [] } }
    } catch (e) {
      console.warn('demo: no 100-day diary to load', e)
    }
  }
  if (!next) return
  commit(demo?.seed ? seedAs(next, demo.seed) : next)
})

/** The 100-day demo that ships with the app (src/renderer/public/demo): in
 * the built renderer once packaged, in the source while developing. */
function demoDir() {
  const built = join(__dirname, '../renderer/demo')
  return fs.existsSync(built) ? built : join(app.getAppPath(), 'src/renderer/public/demo')
}

/** Today as it was before Submit (demo): the flower back to a seed, the page
 * open again, its garden picture gone. */
function resetToday() {
  if (!state.today.submittedAt) return
  const shot = state.today.window
  if (shot) fs.rmSync(join(mediaDir(), shot), { force: true })
  commit(reopenToday(state))
}
// Tuning the glass: the pad stays open under its icon while you work in the
// garden, and goes back to closing on a click away when you're done.
ipcMain.on('sip:pad-pin', (_e, on: unknown) => {
  const pin = on === true
  expectBlur(!pin)
  const at = trayBounds()
  if (pin && at) void showPad(at)
  else hidePad(true)
})
ipcMain.handle('sip:visit-take', () => {
  const v = visit
  visit = null
  return v
})
ipcMain.handle('sip:mic-ask', async () => {
  // SIP_MIC_OFF=1: the pad as if the microphone were off (padshot).
  if (process.env.SIP_MIC_OFF) return false
  if (process.platform !== 'darwin' || HEADLESS) return true
  try {
    return await systemPreferences.askForMediaAccess('microphone')
  } catch {
    return false
  }
})
ipcMain.on('sip:mic-settings', () => {
  void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
})
ipcMain.on('sip:pad-close', () => hidePad())
ipcMain.on('sip:open-garden', () => openGarden())

// Flower models: an explicit test dir, then the user's folder, then the app's.
ipcMain.handle('sip:model', (_e, id: string) => {
  if (!/^[a-z0-9-]+$/.test(id)) return null
  const dirs = [
    process.env.SIP_MODEL_DIR,
    join(app.getPath('userData'), 'flowers'),
    // The real app's folder, so headless runs (own userData) still find models.
    join(app.getPath('appData'), 'Sip Flower', 'flowers'),
    resourcePath('flowers')
  ].filter(Boolean) as string[]
  for (const dir of dirs) {
    const file = join(dir, `${id}.glb`)
    if (fs.existsSync(file)) {
      if (HEADLESS) console.log(`model: ${file}`)
      return fs.readFileSync(file)
    }
  }
  return null
})
// ---- Capture mode: render known poses to PNGs for review, then quit -------

let posed: (() => void) | null = null
ipcMain.on('sip:capture-posed', () => {
  posed?.()
  posed = null
})

function sendPose(pose: CapturePose) {
  return new Promise<void>((resolve) => {
    posed = resolve
    win!.webContents.send('sip:capture-pose', pose)
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function shot(name: string) {
  fs.writeFileSync(join(CAPTURE_DIR!, `${name}.png`), (await win!.webContents.capturePage()).toPNG())
}

/** Review captures at a true higher density (SIP_CAPTURE_SCALE, e.g. 3 for
 * close crops): the window grows and the page zooms to match, so it lays out
 * the same and renders k device pixels per pixel. */
const CAPTURE_SCALE = Number(process.env.SIP_CAPTURE_SCALE) || 1
const pct = (v: number) => String(Math.round(v * 100)).padStart(3, '0')

async function runCapture() {
  fs.mkdirSync(CAPTURE_DIR!, { recursive: true })
  if (CAPTURE_SCALE !== 1) {
    win!.setResizable(true)
    win!.setSize(W * CAPTURE_SCALE, H * CAPTURE_SCALE)
    win!.webContents.setZoomFactor(CAPTURE_SCALE)
    await wait(300)
  }
  // Review shots over a backdrop (a CSS background) instead of transparent.
  if (process.env.SIP_CAPTURE_BG)
    await win!.webContents.executeJavaScript(`document.body.style.background = ${JSON.stringify(process.env.SIP_CAPTURE_BG)}`)
  const flowers = (process.env.SIP_CAPTURE_FLOWERS ?? state.plant.flower).split(',') as FlowerId[]
  for (const flower of flowers) {
    // Growth stops, still: SIP_CAPTURE_GROWTH_STOPS picks them, e.g. "0,0.3,0.6,1".
    const stops = process.env.SIP_CAPTURE_GROWTH_STOPS?.split(',').map(Number) ?? [0.1, 0.3, 0.6, 1]
    for (const growth of stops) {
      await sendPose({ flower, growth, phase: growth >= 1 ? 'bloomed' : 'growing', snap: true, still: true })
      await wait(150)
      await shot(`${flower}-grow-${pct(growth)}`)
    }
    if (process.env.SIP_CAPTURE_LIVE) {
      // Live (swaying) frames in quick succession, to spot flicker:
      // consecutive frames should differ only by a gentle sway.
      await sendPose({ flower, growth: 0.6, snap: true })
      await wait(2500)
      for (let k = 0; k < 8; k++) {
        await shot(`${flower}-live-${k}`)
        await wait(40)
      }
    }
    if (process.env.SIP_CAPTURE_MATURE) {
      // Reaching the goal, live: in bloom → full grown.
      await sendPose({ flower, growth: 0.97, snap: true, still: true })
      await wait(150)
      const t0 = Date.now()
      await sendPose({ flower, growth: 1, phase: 'bloomed', still: true })
      for (const at of [400, 900, 1500, 2200, 3200, 5000]) {
        await wait(Math.max(0, at - (Date.now() - t0)))
        await shot(`${flower}-mature-${String(at).padStart(4, '0')}ms`)
      }
    }
    if (process.env.SIP_CAPTURE_RAIN !== '0') {
      // A watering: the rain and the spring back.
      await sendPose({ flower, growth: 0.6, snap: true, still: true })
      await wait(150)
      const t0 = Date.now()
      win!.webContents.send('sip:watered')
      for (const at of [120, 260, 420, 650, 1000, 2200]) {
        await wait(Math.max(0, at - (Date.now() - t0)))
        await shot(`${flower}-rain-${String(at).padStart(4, '0')}ms`)
      }
    }
  }
  win!.webContents.setZoomFactor(1)
  app.quit()
}

// ---- Perf probe: frame intervals from the renderer's own rAF --------------

async function runPerf() {
  const wc = win!.webContents
  const [w, h] = win!.getSize()
  const out: Record<string, unknown> = { window: [w, h] }
  // Whatever happens, report and quit.
  setTimeout(() => {
    console.log('PERF ' + JSON.stringify({ ...out, timedOut: true }))
    app.quit()
  }, 60_000)
  const mark = (m: string) => console.log(`[perf] ${m}`)
  const sample = (ms: number) =>
    wc.executeJavaScript(`new Promise((done) => {
      const gaps = []
      const r0 = window.__sipRendered || 0
      let prev = performance.now()
      const tick = (t) => { gaps.push(t - prev); prev = t; if (t - t0 < ${ms}) requestAnimationFrame(tick); else finish() }
      const t0 = performance.now()
      const finish = () => {
        gaps.sort((a, b) => a - b)
        const p = (q) => +gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))].toFixed(1)
        const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
        // rendered: frames the flower actually drew (paced), per second.
        done({ rendered: +(((window.__sipRendered || 0) - r0) / ((performance.now() - t0) / 1000)).toFixed(1), frames: gaps.length, fps: +(1000 / mean).toFixed(1), p50: p(0.5), p95: p(0.95), max: +gaps[gaps.length - 1].toFixed(1), over20ms: gaps.filter((g) => g > 20).length })
      }
      requestAnimationFrame(tick)
    })`)
  out.dpr = await wc.executeJavaScript('devicePixelRatio')
  // Let the plant finish growing in from the load.
  await wait(4000)
  out.idle = await sample(3000)
  mark('idle')
  // At rest again, full grown (not a capture pose, which runs at full
  // rate), once it has finished growing in.
  const was = state
  const full = Array.from({ length: state.plant.goal }, (_, i) => ({ at: i + 1, text: DRINK_TEXT }))
  commit({ ...state, plant: { ...state.plant, entries: full } })
  await wait(7000)
  out.idleBloom = await sample(4000)
  commit(was)
  mark('idle bloom')
  // A full-grown plant brushed with real mouse moves at ~120 Hz: every move
  // hit-tests the skinned plant.
  await Promise.race([sendPose({ growth: 1, phase: 'bloomed' }), wait(3000)])
  await wait(800)
  let brushing = true
  const moves = (async () => {
    for (let i = 0; brushing; i++) {
      const x = Math.round(w * (0.38 + 0.24 * (0.5 + 0.5 * Math.sin(i / 10))))
      const y = Math.round(h * (0.3 + 0.2 * (0.5 + 0.5 * Math.cos(i / 23))))
      wc.sendInputEvent({ type: 'mouseMove', x, y })
      await wait(8)
    }
  })()
  out.brushBloom = await sample(3000)
  brushing = false
  await moves
  console.log('PERF ' + JSON.stringify(out))
  app.quit()
}

// ---- Export mode: write each placeholder as a GLB example of the rig ------

async function runExport() {
  fs.mkdirSync(EXPORT_DIR!, { recursive: true })
  const waiting = new Map<string, (b: Uint8Array) => void>()
  ipcMain.on('sip:export-done', (_e, got: string, bytes: Uint8Array) => waiting.get(got)?.(bytes))
  for (const id of FLOWER_IDS) {
    const glb = await new Promise<Uint8Array>((resolve) => {
      // Re-ask until the renderer's listener is up and answers.
      const ask = () => win!.webContents.send('sip:export-request', id)
      ask()
      const timer = setInterval(ask, 1500)
      waiting.set(id, (b) => {
        clearInterval(timer)
        waiting.delete(id)
        resolve(b)
      })
    })
    fs.writeFileSync(join(EXPORT_DIR!, `${id}.glb`), glb)
    console.log(`exported ${id}.glb (${glb.byteLength} bytes)`)
  }
  app.quit()
}

// ---- App lifecycle -------------------------------------------------------

/** The pad, under the menu-bar icon: on launch and on a Dock click. Just
 * after launch the icon reports a made-up place (seen: mid-screen) before
 * it's in the menu bar, so wait until it sits in the top strip. */
async function padFromDock(tries = 30) {
  const at = trayBounds()
  const top = at && screen.getDisplayNearestPoint({ x: at.x, y: at.y }).bounds.y
  if (at && at.width > 0 && at.y - top! < 40) return showPad(at)
  if (tries > 0) setTimeout(() => void padFromDock(tries - 1), 100)
}

/** A normal Mac app's menus: ⌘Q quits, ⌘W closes the garden (the pad only
 * hides), and the edit shortcuts reach the pad's text. */
function appMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        role: 'appMenu',
        submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }]
      },
      { role: 'editMenu' },
      {
        role: 'windowMenu',
        submenu: [
          { label: 'Write or record', accelerator: 'Command+N', click: () => void padFromDock() },
          { label: 'Open garden', accelerator: 'Command+G', click: () => openGarden() },
          { type: 'separator' },
          { role: 'minimize' },
          { role: 'zoom' },
          { role: 'close' },
          { type: 'separator' },
          { role: 'front' }
        ]
      }
    ])
  )
}

if (!HEADLESS && !app.requestSingleInstanceLock()) {
  // Another Sip Flower is already in the menu bar.
  app.exit(0)
} else {
  app.whenReady().then(() => {
    load()
    if (!HEADLESS) demo = readDemo()
    if (demo?.seed) state = seedAs(state, demo.seed)
    serveFiles()
    // A Dock app, with the tray icon as well. The test modes stay out of the Dock.
    if (HEADLESS) app.dock?.hide()
    else appMenu()
    if (CAPTURE_DIR || PERF || EXPORT_DIR) return createStudio()
    const pad = createPad(HEADLESS)
    // Demo replay: opening the pad after a Submit puts today back as it was.
    pad.on('show', () => {
      if (demo?.replay && state.today.submittedAt) resetToday()
    })
    createTray()
    if (!HEADLESS) {
      // Opened from the Dock, Launchpad or Spotlight: the pad, so the app is
      // never running with nothing to show.
      void padFromDock()
      app.on('activate', () => void padFromDock())
      app.on('second-instance', () => void padFromDock())
    }
    const test = SELFTEST ? runSelfTest : PADSHOT_DIR ? runPadShot : null
    if (test)
      pad.webContents.once('did-finish-load', () =>
        setTimeout(async () => {
          try {
            await test({ pad, getState, tray: trayTest })
          } catch (e) {
            // A broken check should fail loudly, not leave the app running.
            console.log(`FAILED ${(e as Error).message}`)
          }
          app.quit()
        }, 1200)
      )
  })
}

app.on('window-all-closed', () => app.quit())
