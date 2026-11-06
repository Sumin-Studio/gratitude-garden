import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

// The garden: a normal window to look round in, its title bar hidden so the
// garden runs to the top edge under the traffic lights (the page's top strip
// drags it). One at a time; opening it again brings it forward.

let garden: BrowserWindow | null = null

export function getGardenWindow() {
  return garden && !garden.isDestroyed() ? garden : null
}

export function openGardenWindow() {
  const open = getGardenWindow()
  if (open) {
    open.show()
    open.focus()
    app.focus({ steal: true })
    return open
  }
  garden = new BrowserWindow({
    width: 900,
    height: 650,
    title: 'Garden',
    titleBarStyle: 'hiddenInset',
    minWidth: 560,
    minHeight: 420,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  garden.once('ready-to-show', () => {
    garden?.show()
    app.focus({ steal: true })
  })
  garden.on('page-title-updated', (e) => e.preventDefault())
  garden.on('closed', () => (garden = null))
  if (process.env.ELECTRON_RENDERER_URL) garden.loadURL(`${process.env.ELECTRON_RENDERER_URL}/garden.html`)
  else garden.loadFile(join(__dirname, '../renderer/garden.html'))
  return garden
}
