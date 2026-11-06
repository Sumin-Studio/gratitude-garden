import { contextBridge, ipcRenderer } from 'electron'
import type { SipBridge } from '../shared/bridge'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const on = (channel: string, cb: (...args: any[]) => void) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = (_e: unknown, ...args: any[]) => cb(...args)
  ipcRenderer.on(channel, h)
  return () => {
    ipcRenderer.removeListener(channel, h)
  }
}

const api: SipBridge = {
  getDiary: () => ipcRenderer.invoke('sip:diary-get'),
  onDiary: (cb) => on('sip:diary', cb),
  addEntry: (text) => ipcRenderer.send('sip:entry-add', text),
  saveToday: (items) => ipcRenderer.send('sip:today-save', items),
  submitToday: () => ipcRenderer.send('sip:today-submit'),
  addMedia: (bytes, ext) => ipcRenderer.invoke('sip:media-add', new Uint8Array(bytes), ext),
  addAudio: (bytes) => ipcRenderer.invoke('sip:audio-add', new Uint8Array(bytes)),
  askMic: () => ipcRenderer.invoke('sip:mic-ask'),
  openMicSettings: () => ipcRenderer.send('sip:mic-settings'),
  closePad: () => ipcRenderer.send('sip:pad-close'),
  onPadShown: (cb) => on('sip:pad-shown', cb),
  onPadHidden: (cb) => on('sip:pad-hidden', cb),
  openGarden: () => ipcRenderer.send('sip:open-garden'),
  visitGarden: () => ipcRenderer.send('sip:visit-garden'),
  pinPad: (on) => ipcRenderer.send('sip:pad-pin', on === true),
  getDemo: () => ipcRenderer.invoke('sip:demo-get'),
  setDemo: (d) => ipcRenderer.send('sip:demo-set', d),
  resetToday: () => ipcRenderer.send('sip:demo-reset'),
  demoScene: (scene) => ipcRenderer.send('sip:demo-scene', scene),
  takeVisit: () => ipcRenderer.invoke('sip:visit-take'),
  onVisit: (cb) => on('sip:visit', cb),
  getGarden: () => ipcRenderer.invoke('sip:garden-get'),
  onGarden: (cb) => on('sip:garden', cb),
  onOpenSheet: (cb) => on('sip:open-sheet', cb),
  onCapturePose: (cb) => on('sip:capture-pose', cb),
  capturePosed: () => ipcRenderer.send('sip:capture-posed'),
  onWatered: (cb) => on('sip:watered', cb),
  getModel: async (id) => {
    const bytes: Uint8Array | null = await ipcRenderer.invoke('sip:model', id)
    return bytes ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : null
  },
  onExportRequest: (cb) => on('sip:export-request', cb),
  exportDone: (id, glb) => ipcRenderer.send('sip:export-done', id, new Uint8Array(glb)),
  reportModel: (id, source, problem) => ipcRenderer.send('sip:model-report', id, source, problem)
}

contextBridge.exposeInMainWorld('sip', api)
