// The Electron half of `pnpm garden-shot`.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const { join } = require('node:path')

const W = 900
const H = 650
const DIR = process.env.SIP_GARDENSHOT_DIR
const ONLY = process.env.SIP_GARDENSHOT_ONLY?.split(',')
if (process.env.SIP_GARDENSHOT_DPR) app.commandLine.appendSwitch('force-device-scale-factor', process.env.SIP_GARDENSHOT_DPR)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const SHOTS = [
  ['home', {}],
  ['pond', { view: { dist: 9, at: [-4.1, 0.2, 6.2] } }],
  ['label', { focus: 0 }],
  ['one', { count: 1 }],
  ['thirty', { count: 30 }],
  // Nothing planted yet: the empty state (its card fades in after 400 ms).
  ['empty', { count: 0, settle: 1200 }]
]

app.whenReady().then(async () => {
  fs.mkdirSync(DIR, { recursive: true })
  const win = new BrowserWindow({
    width: W,
    height: H,
    useContentSize: true,
    show: false,
    webPreferences: { backgroundThrottling: false }
  })
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log(`[page] ${e.message}`)
  })
  // Shown before the page loads: a hidden window gets no WebGL context here.
  win.showInactive()
  await win.loadURL(process.env.SIP_GARDENSHOT_URL)
  const page = (js) => win.webContents.executeJavaScript(js)
  for (let i = 0; !(await page('window.__garden?.ready() ?? false')); i++) {
    if (i > 600) throw new Error('the garden never got ready')
    await wait(100)
  }
  await wait(600)
  const home = { dist: 14, at: [-1.6, 2.1, 1.5] }
  for (const [name, shot] of SHOTS) {
    if (ONLY && !ONLY.includes(name)) continue
    await page(`__garden.count(${shot.count ?? 6}); __garden.focus(${shot.focus ?? null}); __garden.view(${JSON.stringify({ ...home, ...shot.view })})`)
    // SIP_GARDENSHOT_SETTLE (ms): extra time for every kind to bake on a busy machine.
    await wait((shot.settle ?? (shot.focus !== undefined ? 700 : 500)) + (Number(process.env.SIP_GARDENSHOT_SETTLE) || 0))
    fs.writeFileSync(join(DIR, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    console.log(`${name}.png`)
  }
  if (!ONLY || ONLY.includes('fps')) {
    for (const n of [6, 30]) {
      await page(`__garden.count(${n}); __garden.focus(null); __garden.view(${JSON.stringify(home)})`)
      await wait(1000)
      const r = await page('__garden.fps(4000)')
      console.log(`${n} flowers: ${r.fps.toFixed(1)} fps, p95 ${r.p95ms.toFixed(1)} ms (${r.frames} frames, dpr ${await page('devicePixelRatio')})`)
    }
  }
  app.quit()
})
