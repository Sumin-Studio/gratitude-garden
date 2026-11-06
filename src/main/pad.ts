import { app, BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'node:path'

// The pad, the app itself: a popover under the menu-bar icon holding the
// day's board. An NSPanel (`type: 'panel'`) that
// makes us the active app while it's open: left non-activating, the app in
// front takes the key window back within a second or two and the pad closes
// itself. It closes on Esc and when you click anywhere else, and the app you
// were in gets the keyboard back.

/** The panel; the window is MARGIN bigger all round, clear, so the panel's
 * own shadow has room to fall. */
/** The sheet in Simon's Figma (ui/sheet.css), without its 23 px header: 331 × 355. */
const PANEL_W = 331
const PANEL_H = 355
const MARGIN = 18
const PW = PANEL_W + MARGIN * 2
const PH = PANEL_H + MARGIN * 2
const GAP = 4
const EDGE = 8

let pad: BrowserWindow | null = null
let shownAt = 0
let hiddenAt = 0
let quitting = false
/** The test modes leave whatever you're doing in front. */
const takesFocus = !process.env.SIP_SELFTEST && !process.env.SIP_PADSHOT
/** The selftest shares the desktop with whatever else is running (another
 * build's selftest, say), so a real blur mid-run would hide the pad under
 * it. It ignores them, and says when it means one. */
let blurWanted = !process.env.SIP_SELFTEST
export function expectBlur(on: boolean) {
  blurWanted = on
}
app.on('before-quit', () => (quitting = true))

export function createPad(headless: boolean) {
  pad = new BrowserWindow({
    width: PW,
    height: PH,
    useContentSize: true,
    show: false,
    frame: false,
    type: 'panel',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // A see-through window holding one CSS glass panel: its own corner
    // radius, edge light and shadow. No system corners or vibrancy (they gave
    // the panel a second corner), and nothing captured from the desktop.
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Kept running in the test modes, which time things.
      backgroundThrottling: !headless
    }
  })
  pad.setContentSize(PW, PH)
  // macOS grows the panel by a title bar's height as it's first shown: put it back.
  pad.on('resize', () => {
    const [w, h] = pad!.getContentSize()
    if (w !== PW || h !== PH) pad!.setContentSize(PW, PH)
  })
  pad.setAlwaysOnTop(true, 'floating')
  pad.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  pad.on('blur', () => {
    if (!blurWanted) return
    // Opening from the tray can blur us as the click ends. Take focus back
    // rather than ignoring it, so Esc and click-away keep working.
    if (Date.now() - shownAt < 300) pad?.focus()
    else hidePad()
  })
  // ⌘W only hides it: the app lives in this one window.
  pad.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    hidePad()
  })
  // The panel doesn't make us the active app, so the menu's editing shortcuts
  // can't be relied on to reach it.
  pad.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.meta || input.alt || input.control) return
    const wc = pad!.webContents
    const edit = { a: wc.selectAll, c: wc.copy, v: wc.paste, x: wc.cut, z: input.shift ? wc.redo : wc.undo }[input.key.toLowerCase()]
    if (!edit) return
    edit.call(wc)
    e.preventDefault()
  })

  if (headless) pad.webContents.on('console-message', (e) => console.log(`[pad] ${e.message}`))
  if (process.env.ELECTRON_RENDERER_URL) pad.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pad.html${headless ? '?headless' : ''}`)
  else pad.loadFile(join(__dirname, '../renderer/pad.html'), headless ? { search: 'headless' } : undefined)
  return pad
}

export function getPad() {
  return pad
}


/** Hanging from the icon, kept on its screen. */
function place(anchor: Rectangle) {
  const { workArea: a } = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y })
  const x = Math.min(Math.max(anchor.x + anchor.width / 2 - PANEL_W / 2, a.x + EDGE), a.x + a.width - PANEL_W - EDGE)
  const y = Math.max(anchor.y + anchor.height + GAP, a.y + GAP)
  // The panel lands there; the clear margin round it hangs outside.
  pad!.setPosition(Math.round(x - MARGIN), Math.round(y - MARGIN))
}

export async function showPad(anchor: Rectangle) {
  if (!pad || pad.isVisible()) return
  pad.setContentSize(PW, PH)
  place(anchor)
  shownAt = Date.now()
  if (takesFocus) app.focus({ steal: true })
  // The padshot runs while you use the screen: it never takes the keyboard.
  if (process.env.SIP_PADSHOT) {
    pad.showInactive()
  } else {
    pad.show()
    pad.focus()
    pad.webContents.focus()
  }
  pad.webContents.send('sip:pad-shown')
}

export function hidePad(keepActive = false) {
  if (!pad?.isVisible()) return
  hiddenAt = Date.now()
  pad.hide()
  pad.webContents.send('sip:pad-hidden')
  // Back to the app you were in, unless something of ours is still up.
  if (takesFocus && !keepActive && !BrowserWindow.getAllWindows().some((w) => w !== pad && w.isVisible())) app.hide()
}

export function togglePad(anchor: Rectangle) {
  // Clicking the icon with the pad open blurs it first, which hides it; that
  // same click mustn't open it again.
  if (pad?.isVisible()) hidePad()
  else if (Date.now() - hiddenAt > 250) void showPad(anchor)
}
