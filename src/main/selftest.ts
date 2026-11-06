import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, net, type MenuItem } from 'electron'
import { daySize, growth, type DiaryState } from '../shared/diary'
import { getGardenWindow } from './garden'
import { expectBlur } from './pad'
import type { trayTest } from './tray'

// SIP_SELFTEST=1: drive the real pad with synthetic keys, clicks and drags
// through the whole loop: open it from the tray, put text, ink, a voice note
// and a picture on today's board, submit it, check out the garden (it frames
// the plant and blooms it), fill the plant, see it planted, and the tray menu. Touches neither
// the user's mouse nor their data (own userData). Prints one JSON line and
// quits; `failed` lists every check that didn't hold.

export type TestCtx = {
  pad: BrowserWindow
  getState: () => DiaryState
  tray: typeof trayTest
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runSelfTest({ pad, getState, tray }: TestCtx) {
  const step = (m: string) => process.env.SIP_SELFTEST_TRACE && console.log(`[selftest] ${m}`)
  const wc = pad.webContents
  const js = <T = unknown>(code: string): Promise<T> => wc.executeJavaScript(code)
  const text = (name: string) => js<string>(`document.querySelector('[data-test="${name}"]')?.textContent ?? ''`)
  const tap = (name: string) => js(`document.querySelector('[data-test="${name}"]').click(), true`)
  const type = async (line: string) => {
    for (const keyCode of line) {
      wc.sendInputEvent({ type: 'keyDown', keyCode })
      wc.sendInputEvent({ type: 'char', keyCode })
      wc.sendInputEvent({ type: 'keyUp', keyCode })
    }
    await wait(120)
  }
  const press = async (keyCode: string) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
    await wait(150)
  }
  const openPad = async () => {
    tray.click()
    await wait(500)
  }
  const entries = () => getState().plant.entries
  const shots = process.env.SIP_SELFTEST_TRAY ?? '.'
  const shoot = async (name: string) => writeFileSync(`${shots}/${name}.png`, (await wc.capturePage()).toPNG())
  const audioFile = (name: string) => join(app.getPath('userData'), 'audio', name)
  const mediaFile = (name: string) => join(app.getPath('userData'), 'media', name)
  const today = () => getState().today
  const items = () => today().items
  /** The middle of an element, in the page's px. */
  const where = (sel: string) => js<{ x: number; y: number } | null>(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null })()`)
  const mouse = (type: 'mouseDown' | 'mouseUp' | 'mouseMove', x: number, y: number) =>
    wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
  const click = async (x: number, y: number) => {
    mouse('mouseMove', x, y)
    mouse('mouseDown', x, y)
    mouse('mouseUp', x, y)
    await wait(150)
  }
  /** Drag the pen (or the hand) along a path. */
  const drag = async (path: [number, number][]) => {
    mouse('mouseMove', ...path[0])
    mouse('mouseDown', ...path[0])
    for (const p of path.slice(1)) {
      mouse('mouseMove', ...p)
      await wait(8)
    }
    mouse('mouseUp', ...path[path.length - 1])
    await wait(150)
  }
  /** Autosave runs a moment behind the board. */
  const saved = () => wait(450)

  const results: Record<string, unknown> = {}
  if (process.env.SIP_SELFTEST_TRAY) mkdirSync(process.env.SIP_SELFTEST_TRAY, { recursive: true })
  // Whatever happens, what was checked so far is printed.
  try {
    await checks()
  } finally {
    const failed = Object.entries(results).filter(([, v]) => v === false).map(([k]) => k)
    console.log('SELFTEST ' + JSON.stringify({ ...results, failed }))
  }

  async function checks() {
  // 1. Hidden at launch; a click on the icon drops it under the icon, on an
  // empty board for today.
  step('1')
  results.hiddenAtLaunch = !pad.isVisible()
  results.onlyThePad = BrowserWindow.getAllWindows().length === 1
  results.seedInPot = growth(getState()) === 0 && entries().length === 0
  await openPad()
  results.iconOpensPad = pad.isVisible()
  const icon = tray.bounds()!
  const b = pad.getBounds()
  results.padSize = [b.width, b.height]
  // The panel; the window round it is a clear margin for its shadow.
  results.padIs331x355 = (await js<string>(`(() => { const r = document.querySelector('.pad').getBoundingClientRect(); return r.width + ',' + r.height })()`)) === '331,355'
  // Simon's Figma sheet: 32 px panel corners, the paper card's 26 px inside.
  results.sheetCorners = await js(`getComputedStyle(document.querySelector('.pad')).borderRadius === '32px' && getComputedStyle(document.querySelector('.pad-card')).borderRadius === '26px'`)
  results.noDayStrip = await js(`!document.querySelector('.pad-days, .pad-day')`)
  results.noScreenAsk = await js(`!document.querySelector('[data-test="screen-ask"], .pad-lens')`)
  // The Figma sheet: frosted grey, the board on white paper.
  results.padIsGreySheet = await js(`document.querySelector('.pad').matches('.sheet') && getComputedStyle(document.querySelector('.pad')).backgroundColor === 'rgba(175, 175, 175, 0.62)'`)
  results.boardIsPaper = await js(`getComputedStyle(document.querySelector('.pad-card')).backgroundColor === 'rgba(255, 255, 255, 0.86)'`)
  results.visitThere = (await text('visit')) === 'Visit the garden'
  results.padUnderIcon = b.y >= icon.y + icon.height && b.x <= icon.x + icon.width && b.x + b.width >= icon.x
  results.boardShows = await js(`!!document.querySelector('[data-test="board"]')`)
  results.emptyHint = (await js<string>(`document.querySelector('[data-test="words"]').placeholder`)).length > 0
  results.submitWaitsForSomething = await js(`document.querySelector('[data-test="action"]').disabled`)
  results.actionSays = await text('action')
  results.noOldFlowerColumn = await js(`!document.querySelector('.pad-plant, .pad-write')`)

  // 2. Words: typed from the paper's top, wherever on the paper you click.
  // Saved as you go; nothing waters the plant yet. Only words and pictures:
  // no draw or voice tools.
  step('2')
  const card = (await js<{ x: number; y: number; w: number; h: number }>(`(() => { const r = document.querySelector('[data-test="card"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`))!
  results.onlyWordsAndPictures = await js(`!document.querySelector('[data-test="tool-text"], [data-test="tool-draw"], [data-test="tool-voice"], [data-test="tools"]') && !!document.querySelector('[data-test="tool-image"]')`)
  await click(card.x + 150, card.y + 200)
  results.paperClickTypes = await js(`document.activeElement === document.querySelector('[data-test="words"]')`)
  await type('wrote the pad')
  await press('Escape')
  await saved()
  const t = items().find((i) => i.kind === 'text')
  results.textSaved = t?.text === 'wrote the pad'
  results.textAtTop = t?.x === 13 && t?.y === 21
  results.textShowsAtTop = await js(`(() => { const w = document.querySelector('[data-test="words"]').getBoundingClientRect(); return Math.round(w.left - ${card.x}) === 13 && Math.round(w.top - ${card.y}) === 21 })()`)
  results.nothingWateredYet = entries().length === 0 && growth(getState()) === 0
  // Words emptied: no text item left (so an empty day can't be submitted).
  await js(`(() => { const t = document.querySelector('[data-test="words"]'); t.focus(); t.select(); return true })()`)
  await press('Backspace')
  await saved()
  results.emptyWordsGo = !items().some((i) => i.kind === 'text')
  // Back the way a script would (the page takes outside changes when idle).
  await press('Escape')
  await js(`window.sip.saveToday([{ id: 'back1', kind: 'text', x: 13, y: 21, text: 'wrote the pad' }, ...${JSON.stringify(items())}]), true`)
  await saved()
  results.outsideChangeShows = (await js<string>(`document.querySelector('[data-test="words"]').value`)) === 'wrote the pad'

  // 3. Voice notes are gone from the pad, but an older day's note file still
  // goes from disk when it leaves its board.
  step('3')
  const extra = await js<string | null>(`window.sip.addAudio(new Uint8Array([1, 2, 3, 4]).buffer)`)
  results.protocolServesNote = !!extra && (await net.fetch(`sip-audio://${extra}`)).status === 200
  await js(`window.sip.saveToday([...${JSON.stringify(items())}, { id: 'gone1', kind: 'voice', x: 0, y: 300, file: ${JSON.stringify(extra)}, ms: 1000 }]), true`)
  await saved()
  results.addAudioKeeps = !!extra && existsSync(audioFile(extra))
  await js(`window.sip.saveToday(${JSON.stringify(items().filter((i) => i.id !== 'gone1'))}), true`)
  await saved()
  results.removedNoteFileGoes = !!extra && !existsSync(audioFile(extra))

  // 6. A picture: kept under media, served by its protocol, nothing else is.
  step('6')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4AWP4z8DwHwiZGBgYGBgYAAA9GgQBUCU8hgAAAABJRU5ErkJggg==', 'base64')
  const pic = await js<string | null>(`window.sip.addMedia(Uint8Array.from(atob('${png.toString('base64')}'), (c) => c.charCodeAt(0)).buffer, 'png')`)
  results.mediaKept = !!pic && existsSync(mediaFile(pic))
  results.mediaRefusesOddTypes = (await js(`window.sip.addMedia(new Uint8Array([1]).buffer, 'exe')`)) === null
  if (pic) await js(`window.sip.saveToday([...${JSON.stringify(items())}, { id: 'pic1', kind: 'image', x: 180, y: 100, w: 110, h: 110, file: ${JSON.stringify(pic)} }]), true`)
  await saved()
  results.pictureShows = await js(`new Promise((done) => {
    const t0 = Date.now()
    const look = () => { const i = document.querySelector('[data-kind="image"] img'); i?.complete && i.naturalWidth > 0 ? done(true) : Date.now() - t0 > 2000 ? done(false) : setTimeout(look, 50) }
    look()
  })`)
  // Turn it by its handle, like a photo in a scrapbook.
  const ph = await where('[data-kind="image"]')
  if (ph) {
    await click(ph.x, ph.y)
    const th = await where('[data-turn]')
    if (th) await drag([[th.x, th.y], [th.x + 40, th.y + 10], [th.x + 90, th.y + 40]])
    await saved()
  }
  // And make it bigger from a corner: it keeps its shape and its middle.
  const before = items().find((i) => i.id === 'pic1')
  // The top-left corner, outward: the paper is narrow, so its right edge is near the window's.
  const hp = await where('[data-kind="image"] .board-handle.is-nw')
  if (hp) await drag([[hp.x, hp.y], [hp.x - 30, hp.y - 30], [hp.x - 60, hp.y - 60]])
  await saved()
  const after = items().find((i) => i.id === 'pic1')
  results.pictureResizes = !!before && !!after && (after.w ?? 0) > (before.w ?? 0) + 20 && Math.abs((after.w ?? 0) / (after.h ?? 1) - (before.w ?? 1) / (before.h ?? 1)) < 0.05
  results.pictureTurns = Math.abs(items().find((i) => i.id === 'pic1')?.rot ?? 0) > 10
  results.turnShows = await js(`/rotate/.test(document.querySelector('[data-kind="image"]')?.style.transform ?? '')`)
  results.protocolServesMedia = !!pic && (await net.fetch(`sip-media://${pic}`)).status === 200
  results.protocolRejectsPaths = (
    await Promise.all(['sip-audio://../state.json', 'sip-media://../state.json', 'sip-media://media/../state.json', 'sip-audio://nope.webm'].map((u) => net.fetch(u).then((r) => r.status)))
  ).every((c) => c === 403 || c === 404)
  await shoot('pad-canvas-items')

  // 7. Submit for today: locked, each thing waters once, the action flips.
  step('7')
  const n = items().length
  // The words aren't a board item; the pictures are.
  const pics = items().filter((i) => i.kind !== 'text').length
  results.itemsBeforeSubmit = n
  const grownId = getState().plant.id
  const firstPot = getState().plant.pot
  await tap('action')
  await wait(500)
  results.submitLocks = !!today().submittedAt
  // Straight into the garden to watch it bloom.
  for (let i = 0; i < 40 && !getGardenWindow()?.isVisible(); i++) await wait(100)
  results.submitOpensGarden = Boolean(getGardenWindow()?.isVisible())
  // One day, one flower: planted at full bloom with its board, sized by how
  // much it held; a new seed waits for tomorrow.
  const planted = getState().garden.find((f) => f.id === grownId)
  results.dayPlantsItsFlower = !!planted && today().flower === grownId && today().grew?.[1] === 1
  results.eachItemWatersOnce = planted?.entries.length === n
  results.flowerSized = Math.abs((planted?.size ?? 1) - daySize(n)) < 1e-9
  results.plantedKeepsBoards = planted?.days.length === 1 && planted.days[0].items.length === n
  results.newSeed = getState().plant.id !== grownId && entries().length === 0 && growth(getState()) === 0 && getState().plant.pot !== firstPot
  results.actionFlips = (await text('action')) === 'Submitted' && (await js<boolean>(`document.querySelector('[data-test="action"]').disabled`))
  results.toolbarGone = await js(`!document.querySelector('[data-test="tools"]')`)
  results.boardLocked = await js(`document.querySelector('[data-test="card"]').dataset.state === 'locked'`)
  results.boardReadOnly = await js(`document.querySelector('[data-test="board"]').dataset.tool === 'view'`)
  results.wordsReadOnly = await js(`document.querySelector('[data-test="words"]').readOnly`)
  await js(`window.sip.saveToday([]), true`)
  await saved()
  results.lockedIgnoresSaves = items().length === n
  results.submittedSays = await text('stage')
  await shoot('pad-canvas-submitted')

  // 8. Closes on Esc and on a click away; a second click on the icon closes it.
  step('8')
  await press('Escape')
  await wait(150)
  results.escCloses = !pad.isVisible()
  await wait(300)
  await openPad()
  await wait(400) // Past the grace for the blur that opening can cause.
  expectBlur(true)
  pad.emit('blur')
  expectBlur(false)
  await wait(150)
  results.clickAwayCloses = !pad.isVisible()
  await wait(300)
  await openPad()
  tray.click()
  await wait(200)
  results.iconCloses = !pad.isVisible()
  await wait(300)
  await openPad()
  results.reopenKeepsDay = (await js<number>(`document.querySelectorAll('[data-item]').length`)) === pics && (await js<string>(`document.querySelector('[data-test="words"]').value`)) === 'wrote the pad'

  // 9. Visit the garden: the garden opens on the plant today watered,
  // blooms it from this morning to now, then opens its scrapbook.
  step('9')
  const plantId = grownId
  await tap('visit')
  await wait(1500)
  const g = getGardenWindow()
  results.gardenOpens = Boolean(g?.isVisible())
  results.padClosesForGarden = !pad.isVisible()
  if (g) {
    const ask = <T>(code: string): Promise<T> => g.webContents.executeJavaScript(code)
    // It opens close on the flower, blooms it, then eases out to the whole
    // garden with nothing selected (no callout).
    const seen = await ask<{ focus: string | null; phases: string[] }>(`new Promise((done) => {
      const t0 = Date.now()
      const phases = []
      let focus = null
      const look = () => {
        const p = window.__gardenVisit?.phase
        if (p && phases[phases.length - 1] !== p) phases.push(p)
        if (p === 'blooming') focus = window.__gardenFocus ?? focus
        if (p === 'done' || Date.now() - t0 > 30000) done({ focus, phases })
        else setTimeout(look, 30)
      }
      look()
    })`)
    results.gardenFramesPlant = seen.focus === plantId
    results.visitBlooms = seen.phases.includes('blooming') && seen.phases.includes('done')
    await wait(600)
    results.visitEndsOnWholeGarden = await ask(`window.__gardenFocus === null && !document.querySelector('.label, .leader')`)
    results.gardenHasTheFlower = (await ask<{ id: string; growth?: number }[]>(`window.sip.getGarden()`)).some((f) => f.id === plantId && f.growth === undefined)
    if (process.env.SIP_SELFTEST_TRAY) writeFileSync(`${process.env.SIP_SELFTEST_TRAY}/garden-visit.png`, (await g.webContents.capturePage()).toPNG())
    results.gardenTitle = g.getTitle()
    results.gardenResizable = g.isResizable()
  }

  // 10. The page's window into the garden: drawn off screen round the
  // flower after the submit, saved under media, on the day.
  step('10')
  for (let i = 0; i < 100 && !today().window; i++) await wait(200)
  const shot = today().window
  results.pageWindowSaved = !!shot && existsSync(mediaFile(shot)) && readFileSync(mediaFile(shot)).length > 2000
  results.pageWindowOnFlower = getState().garden.find((f) => f.id === grownId)?.days[0]?.window === shot
  results.pageWindowShows = await js(`new Promise((done) => {
    const t0 = Date.now()
    const look = () => { const i = document.querySelector('[data-test="page-window"] img'); i?.complete && i.naturalWidth > 0 ? done(true) : Date.now() - t0 > 3000 ? done(false) : setTimeout(look, 50) }
    look()
  })`)
  if (g) await g.webContents.executeJavaScript(`(window.__heard = 0, window.sip.onGarden((f) => (window.__heard = f.length)), true)`)
  if (g) {
    menu(tray, 'Open garden').click()
    await wait(300)
    results.gardenOnlyOnce = getGardenWindow() === g
    g.close()
    await wait(300)
    results.gardenCloses = !getGardenWindow()
    results.appSurvivesGardenClose = !pad.isDestroyed()
  }

  // 11. The tray's menu; Write or record opens the pad typing (a locked day
  // stays locked).
  step('11')
  results.menuItems = tray.menu()?.items.filter((i) => i.type !== 'separator').map((i) => i.label)
  results.menuMatchesPad = JSON.stringify(results.menuItems) === JSON.stringify(['Open garden', 'Write or record', 'Quit'])
  if (pad.isVisible()) {
    await press('Escape')
    await wait(300)
  }
  menu(tray, 'Write or record').click()
  await wait(700)
  results.writeOrRecordOpensPad = pad.isVisible()
  results.lockedDayStaysLocked = await js(`!document.querySelector('[data-test="text-edit"]')`)
  await press('Escape')
  await wait(350)

  // 11b. The garden's Demo controls: reset today reopens the page; Day 1 is a
  // brand-new garden with a lotus seed.
  step('11b')
  await js(`window.sip.resetToday(), true`)
  await wait(300)
  results.demoResetReopens = !today().submittedAt && today().items.length > 0
  await js(`window.sip.demoScene('day1'), true`)
  await wait(300)
  results.demoDayOne = getState().garden.length === 0 && getState().plant.flower === 'lotus' && today().items.length === 0

  // 12. Pop the menu open and photograph the screen.
  step('12')
  if (process.env.SIP_SELFTEST_TRAY) {
    setTimeout(() => {
      execFileSync('screencapture', ['-x', `${process.env.SIP_SELFTEST_TRAY}/tray-menu.png`])
      tray.close()
    }, 900)
    tray.popUp()
    await wait(1400)
  }
  }
}

function menu(tray: TestCtx['tray'], label: string): MenuItem {
  const item = tray.menu()?.items.find((i) => i.label === label)
  if (!item) throw new Error(`no menu item ${label}`)
  return item
}
