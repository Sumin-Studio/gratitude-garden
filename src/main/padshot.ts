import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { emptyDay, initialState, plantToGarden, setToday, submitDay, type DiaryState, type Item } from '../shared/diary'
import { getGardenWindow } from './garden'
import { expectBlur } from './pad'
import type { TestCtx } from './selftest'

// SIP_PADSHOT=<dir>: seed a believable diary, click the tray icon and
// photograph the pad's states: the empty board, a board with things on it,
// submitted. With SIP_PADSHOT_BACKDROP=<image> each is also laid over that
// picture as the wallpaper (composited, so the shots never show anyone's
// real desktop).
// SIP_PADSHOT_SCENE=real reads the save file instead of the seed.
// SIP_PADSHOT_IDLE=1 measures the pad's idle CPU. Review only.

const HOUR = 3_600_000
const DAY = 24 * HOUR

const line = (id: string, text: string, x: number, y: number): Item => ({ id, kind: 'text', x, y, text })

/** A wavy underline, a sun, a little cloud: ink as a person would draw it. */
function doodle(): number[] {
  const pts: number[] = []
  for (let t = 0; t <= 36; t++) {
    const a = (t / 36) * Math.PI * 2
    pts.push(Math.round((30 + Math.cos(a) * 16) * 10) / 10, Math.round((30 + Math.sin(a) * 16) * 10) / 10)
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    pts.push(-99999, -99999, 30 + Math.cos(a) * 22, 30 + Math.sin(a) * 22, 30 + Math.cos(a) * 30, 30 + Math.sin(a) * 30)
  }
  return pts.map((v) => Math.round(v * 10) / 10)
}

/** Earlier days' boards, a flower in the garden, and today empty. */
export function padShotState(now: number): DiaryState {
  let s = initialState(now - 20 * DAY)
  for (let d = 0; d < 7; d++) {
    const at = now - (20 - d) * DAY
    const items = [line(`a${d}`, ['Long walk by the river', 'Finished the chapter', 'Coffee with Jo'][d % 3], 0, 0), line(`b${d}`, 'Called Mum back', 40, 60), line(`c${d}`, 'Slept well', 160, 120)]
    s = submitDay(setToday({ ...s, today: emptyDay(at) }, at, items), at)
  }
  s = plantToGarden(s, now - 13 * DAY)
  for (let d = 0; d < 4; d++) {
    const at = now - (4 - d) * DAY
    const items: Item[] = [line(`d${d}`, ['Shipped the pad', 'Lunch in the sun', 'Fixed the tray icon', 'Read in the park'][d], 10, 0), { id: `i${d}`, kind: 'ink', x: 220, y: -10, points: doodle() }]
    s = submitDay(setToday({ ...s, today: emptyDay(at) }, at, items), at)
  }
  return { ...s, today: emptyDay(now) }
}

/** Today's page for the shots: the words at the top, three prints stuck on
 * crooked (the Figma's layout). */
function todayItems(media: string | null): Item[] {
  const items: Item[] = [{ id: 't1', kind: 'text', x: 13, y: 21, text: 'Walked the long way round the pond. The light on the water this morning, then lunch with Jo, finally.' }]
  if (media)
    items.push(
      { id: 'p1', kind: 'image', x: -37, y: 106, w: 179, h: 150, rot: 30, file: media },
      { id: 'p2', kind: 'image', x: 156, y: 117, w: 169, h: 141, rot: -9.5, file: media },
      { id: 'p3', kind: 'image', x: 86, y: 214, w: 182, h: 152, rot: 0, file: media }
    )
  return items
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runPadShot({ pad, tray }: TestCtx) {
  const dir = process.env.SIP_PADSHOT!
  fs.mkdirSync(dir, { recursive: true })
  const wc = pad.webContents
  const js = <T = unknown>(code: string): Promise<T> => wc.executeJavaScript(code)
  const page = async (name: string) => fs.writeFileSync(join(dir, `${name}.png`), (await wc.capturePage()).toPNG())
  // Stays up while you use the screen; the shots are of its own page.
  expectBlur(false)
  const icon = tray.bounds()
  const backdrop = process.env.SIP_PADSHOT_BACKDROP
  // A picture and a voice note on disk for today's board.
  const userData = app.getPath('userData')
  const pic = join(app.getAppPath(), 'docs/garden/compose-pond.png')
  let media: string | null = null
  if (fs.existsSync(pic)) {
    fs.mkdirSync(join(userData, 'media'), { recursive: true })
    fs.copyFileSync(pic, join(userData, 'media', 'shot-pond.png'))
    media = 'shot-pond.png'
  }
  tray.click()
  await wait(2500)
  const b = pad.getBounds()
  /** The pad over a wallpaper: its own window picture (clear round the
   * panel) laid over SIP_PADSHOT_BACKDROP, in a hidden window. Never the real
   * screen, so no one's desktop ends up in the shots. */
  const screenShot = async (name: string) => {
    if (!backdrop) return
    const shot = (await wc.capturePage()).toDataURL()
    const k = new BrowserWindow({ show: false, width: b.width + 64, height: b.height + 64, webPreferences: { offscreen: true } })
    const html = join(app.getPath('temp'), 'sip-padshot-desktop.html')
    fs.writeFileSync(html, `<body style="margin:0;overflow:hidden;background:#888 url('${pathToFileURL(backdrop).href}') center/cover"><img src="${shot}" style="display:block;margin:32px;width:${b.width}px;height:${b.height}px">`)
    await k.loadFile(html)
    await wait(400)
    fs.writeFileSync(join(dir, `${name}.png`), (await k.webContents.capturePage()).toPNG())
    k.destroy()
  }
  await page('empty')
  await screenShot('empty-desktop')
  await js(`window.sip.saveToday(${JSON.stringify(todayItems(media))}), true`)
  await wait(900)
  await page('items')
  await screenShot('items-desktop')
  // Typing: the words focused, the caret at their end.
  await js(`(() => { const t = document.querySelector('[data-test=words]'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true })()`)
  await wait(200)
  await page('items-typing')
  await js(`document.activeElement.blur(), true`)
  await js(`document.querySelector('[data-test=action]').click(), true`)
  // The page's window into the garden is drawn off screen just after.
  for (let i = 0; i < 100 && !(await js<boolean>(`!!document.querySelector('[data-test=page-window] img')?.naturalWidth`)); i++) await wait(200)
  await wait(900)
  await page('submitted')
  await screenShot('submitted-desktop')
  // Check out the garden: mid-flight (the bloom playing), then the scrapbook.
  if (process.env.SIP_PADSHOT_VISIT) {
    await js(`document.querySelector('[data-test=visit]').click(), true`)
    for (let i = 0; i < 300 && !getGardenWindow(); i++) await wait(50)
    const g = getGardenWindow()!
    const phase = () => g.webContents.executeJavaScript('window.__gardenVisit?.phase ?? null').catch(() => null)
    // What you see first: the loader while the garden gets ready.
    for (let i = 0; i < 100 && !(await g.webContents.executeJavaScript('!!document.querySelector(".loader[data-shown]")').catch(() => false)); i++) await wait(50)
    fs.writeFileSync(join(dir, 'visit-loader.png'), (await g.webContents.capturePage()).toPNG())
    for (let i = 0; i < 600 && (await phase()) !== 'blooming'; i++) await wait(50)
    // A frame every 100 ms from the start of the bloom to its end, the
    // growth each was taken at, then laid out as one strip to check it grows
    // smoothly (no stall, no jump).
    const frames: { png: string; growth: number }[] = []
    const t0 = Date.now()
    while ((await phase()) !== 'done' && Date.now() - t0 < 12_000) {
      const at = Date.now()
      const growth = Number(await g.webContents.executeJavaScript('window.__gardenVisit?.growth ?? 0'))
      const img = await g.webContents.capturePage()
      frames.push({ png: img.resize({ width: 300 }).toDataURL(), growth })
      await wait(Math.max(0, 100 - (Date.now() - at)))
    }
    if (frames.length) {
      fs.writeFileSync(join(dir, 'visit-blooming.png'), Buffer.from(frames[Math.floor(frames.length / 2)].png.split(',')[1], 'base64'))
      const cols = 6
      const rows = Math.ceil(frames.length / cols)
      const k = new BrowserWindow({ show: false, width: cols * 306 + 6, height: rows * 236 + 6, webPreferences: { offscreen: true } })
      const html = join(app.getPath('temp'), 'sip-visit-strip.html')
      fs.writeFileSync(
        html,
        `<body style="margin:0;padding:3px;background:#111;display:grid;grid-template-columns:repeat(${cols},300px);gap:6px;font:11px -apple-system,sans-serif;color:#fff">` +
          frames.map((f, i) => `<figure style="margin:0;position:relative"><img src="${f.png}" style="display:block;width:300px"><figcaption style="position:absolute;left:6px;bottom:4px">${i * 100} ms · ${(f.growth * 100).toFixed(0)} %</figcaption></figure>`).join('') +
          `</body>`
      )
      await k.loadFile(html)
      await wait(500)
      fs.writeFileSync(join(dir, 'visit-strip.png'), (await k.webContents.capturePage()).toPNG())
      k.destroy()
      const steps = frames.slice(1).map((f, i) => f.growth - frames[i].growth)
      console.log(`PADSHOT visit: ${frames.length} frames, growth ${frames.map((f) => (f.growth * 100).toFixed(0)).join(' ')}, biggest step ${(Math.max(...steps) * 100).toFixed(1)} %`)
    }
    await wait(1200)
    fs.writeFileSync(join(dir, 'visit-zoom-out.png'), (await g.webContents.capturePage()).toPNG())
    await wait(3000)
    fs.writeFileSync(join(dir, 'visit-scrapbook.png'), (await g.webContents.capturePage()).toPNG())
    g.close()
    await wait(300)
    tray.click()
    await wait(1200)
  }
  // SIP_PADSHOT_IDLE: the pad's idle CPU, open and untouched, as ps sees it.
  if (process.env.SIP_PADSHOT_IDLE) {
    await wait(3000)
    const procs = app.getAppMetrics().filter((m) => m.type === 'GPU' || m.pid === wc.getOSProcessId() || m.type === 'Browser')
    const pids = procs.map((m) => m.pid).join(',')
    const samples: number[][] = []
    for (let i = 0; i < 10; i++) {
      await wait(1000)
      const out = execFileSync('ps', ['-o', '%cpu=', '-p', pids], { encoding: 'utf8' })
      samples.push(out.trim().split(/\s+/).map(Number))
    }
    const mean = procs.map((m, k) => `${m.type} ${(samples.reduce((s, x) => s + (x[k] ?? 0), 0) / samples.length).toFixed(1)}%`)
    console.log(`PADSHOT idle cpu: ${mean.join(', ')}`)
  }
  console.log(`PADSHOT ${JSON.stringify({ bounds: b, icon })}`)
}
