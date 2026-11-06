import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import { join } from 'node:path'

// A submitted page's window into the garden: the garden drawn off screen
// (garden.html?snap: your sky and weather, no callout), the flower the day
// grew framed, and a landscape piece round it saved as a picture. The pad
// shows it on the page with brushed, faded edges.

const W = 900
const H = 650
/** The piece kept: wider than tall, round the flower. */
const CROP_W = 440
const CROP_H = 300

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
type Box = { l: number; t: number; r: number; b: number }

/** Draws the garden on `flowerId` and writes the piece to `out`. False if it
 * couldn't (no such flower, the garden never got ready). */
export async function snapGarden(flowerId: string, out: string): Promise<boolean> {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      offscreen: true,
      backgroundThrottling: false
    }
  })
  try {
    win.webContents.setFrameRate(30)
    if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/garden.html?snap`)
    else await win.loadFile(join(__dirname, '../renderer/garden.html'), { query: { snap: '' } })
    const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code)
    for (let i = 0; !(await js<boolean>('window.__garden?.ready() ?? false')); i++) {
      if (i > 300) return false
      await wait(100)
    }
    if ((await js<number>(`window.__garden.focusId(${JSON.stringify(flowerId)})`)) < 0) return false
    // The camera walks up to it, then holds.
    await wait(1500)
    const a = await js<{ x: number; y: number; box?: Box } | null>('window.__gardenAnchor ?? null')
    if (!a) return false
    const cx = a.box ? (a.box.l + a.box.r) / 2 : a.x
    const cy = a.box ? (a.box.t + a.box.b) / 2 : a.y
    const clamp = (v: number, hi: number) => Math.round(Math.min(Math.max(v, 0), hi))
    const img = await win.webContents.capturePage({ x: clamp(cx - CROP_W / 2, W - CROP_W), y: clamp(cy - CROP_H / 2, H - CROP_H), width: CROP_W, height: CROP_H })
    if (img.isEmpty()) return false
    fs.writeFileSync(out, img.toPNG())
    return true
  } finally {
    win.destroy()
  }
}
