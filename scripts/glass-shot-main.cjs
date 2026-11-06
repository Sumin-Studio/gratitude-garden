// The Electron half of `pnpm glass-shot`.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const { join } = require('node:path')

const W = 900
const H = 650
const DIR = process.env.SIP_GLASSSHOT_DIR
const URL = process.env.SIP_GLASSSHOT_URL
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const home = { dist: 16.5, at: [0, 2.1, 1.5] }

app.whenReady().then(async () => {
  fs.mkdirSync(DIR, { recursive: true })
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } })
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log(`[page] ${e.message}`)
  })
  win.showInactive()
  const page = (js) => win.webContents.executeJavaScript(js)
  const open = async (q) => {
    await win.loadURL(URL + q)
    for (let i = 0; !(await page('window.__garden?.ready() ?? false')); i++) {
      if (i > 600) throw new Error('the garden never got ready')
      await wait(100)
    }
    await page(`__garden.count(6); __garden.view(${JSON.stringify(home)})`)
    await wait(800)
  }
  // A window in the back may get no frames at all: give up rather than hang.
  const fps = async (name) => {
    const r = await Promise.race([page('__garden.fps(4000)'), wait(9000).then(() => null)])
    if (!r) return console.log(`${name}: no frames (window in the back)`)
    console.log(`${name}: ${r.fps.toFixed(1)} fps, p95 ${r.p95ms.toFixed(1)} ms (${r.frames} frames)`)
  }
  const shot = async (name, crop) => {
    const img = await win.webContents.capturePage(crop)
    fs.writeFileSync(join(DIR, `${name}.png`), img.toPNG())
    console.log(`${name}.png`)
  }

  await open('')
  await fps('bare garden')
  await open('&tune')
  await shot('tune-pill', { x: W / 2 - 80, y: H - 90, width: 160, height: 90 })
  await fps('pill')
  await open('&tune=open')
  await shot('tune-panel')
  await fps('tune panel open')
  await open('')
  await page('__garden.focus(0)')
  await wait(1200)
  await shot('callout')
  await fps('callout open')
  await page('__garden.focus(null); __garden.count(0)')
  await wait(1200)
  await shot('garden-empty')

  // What the glass costs: the tune panel and the callout up, the old single
  // blur vs the recipe, interleaved.
  if (process.env.SIP_GLASSSHOT_AB) {
    const variants = {
      old: '.glass { backdrop-filter: blur(22px) saturate(1.4) !important }',
      glass: ''
    }
    await open('&tune=open')
    await page('__garden.focus(0)')
    await wait(1500)
    const runs = {}
    for (let round = 0; round < 3; round++)
      for (const [name, css] of Object.entries(variants)) {
        await page(`(document.getElementById('ab') ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: 'ab' }))).textContent = ${JSON.stringify(css)}`)
        await wait(500)
        const r = await page('__garden.fps(3000)')
        ;(runs[name] ??= []).push(r.fps)
      }
    for (const [name, f] of Object.entries(runs)) console.log(`${name}: ${f.map((x) => x.toFixed(1)).join(' / ')} fps`)
  }
  app.quit()
})
