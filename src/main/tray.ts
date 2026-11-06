import { app, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { openGarden, writeOrRecord } from './index'
import { togglePad } from './pad'

let tray: Tray | null = null
let menu: Menu | null = null
const models = new Map<string, { source: 'glb' | 'placeholder'; problem?: string }>()

ipcMain.on('sip:model-report', (_e, id: string, source: 'glb' | 'placeholder', problem?: string) => {
  models.set(id, { source, problem })
  refreshTray()
})

/** For the self-test: the menu as last built, a click on the icon, and a way
 * to pop the menu open. */
export const trayTest = {
  menu: () => menu,
  click: () => tray?.emit('click'),
  bounds: () => tray?.getBounds() ?? null,
  popUp: () => tray?.popUpContextMenu(menu ?? undefined),
  close: () => tray?.closeContextMenu()
}

export function resourcePath(...parts: string[]) {
  return app.isPackaged
    ? join(process.resourcesPath, ...parts)
    : join(app.getAppPath(), 'resources', ...parts)
}

/** Where the pad hangs from: the menu-bar icon. */
export function trayBounds() {
  return tray?.getBounds() ?? null
}

export function createTray() {
  const img = nativeImage.createFromPath(resourcePath('trayTemplate.png'))
  img.setTemplateImage(true)
  tray = new Tray(img)
  tray.setToolTip('Sip Flower')
  // No setContextMenu: on macOS it would take the left click too.
  tray.on('click', () => togglePad(tray!.getBounds()))
  tray.on('right-click', () => tray?.popUpContextMenu(menu ?? undefined))
  refreshTray()
}

// A model that failed to load is listed, so a bad export isn't a silent placeholder.
function modelProblems(): Electron.MenuItemConstructorOptions[] {
  const bad = [...models.entries()].filter(([, m]) => m.problem)
  if (!bad.length) return []
  return [...bad.map(([id, m]) => ({ label: `${id}.glb ${m.problem}`, enabled: false })), { type: 'separator' }]
}

// The same words, case and order as the pad: open, write, quit.
export function refreshTray() {
  if (!tray) return
  menu = Menu.buildFromTemplate([
    ...modelProblems(),
    { label: 'Open garden', click: () => openGarden() },
    { label: 'Write or record', click: () => void writeOrRecord(tray!.getBounds()) },
    { type: 'separator' },
    { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() }
  ])
}
