import type { DiaryState, FlowerId, GardenFlower, Item, PotId, Visit } from './diary'

// The window.sip API the preload exposes to the pad, the garden and the
// capture studio. The renderer falls back to a localStorage mock with the
// same shape when it runs in a plain browser.

export type CapturePose = {
  flower?: FlowerId
  /** Growth 0..1 for this pose (default 1, full bloom). */
  growth?: number
  /** Plant phase for this pose (default growing). */
  phase?: 'growing' | 'bloomed'
  /** Pot glaze for this pose (default the plant's own). */
  pot?: PotId
  /** Jump springs straight to the pose instead of animating. */
  snap?: boolean
  /** Freeze idle sway so frames are deterministic. */
  still?: boolean
}

export type SipBridge = {
  /** The diary: what the pad runs on. */
  getDiary(): Promise<{ state: DiaryState; now: number }>
  onDiary(cb: (state: DiaryState, now: number) => void): () => void
  /** Write a line straight into the plant: waters it once (scripts, tests). */
  addEntry(text: string): void
  /** Today's board as it is now (autosave; ignored once submitted). */
  saveToday(items: Item[]): void
  /** Submit for today: locks the board, each thing on it waters the plant once. */
  submitToday(): void
  /** Keep a picture or video under userData/media, served back as
   * sip-media://<file>. Resolves to the file's name, or null. */
  addMedia(bytes: ArrayBuffer, ext: string): Promise<string | null>
  /** Keep a voice note (webm/opus) under userData/audio, served back as
   * sip-audio://<file>. Resolves to the file's name, or null. */
  addAudio(bytes: ArrayBuffer): Promise<string | null>
  /** Ask macOS for the microphone (once); false when it's off in System Settings. */
  askMic(): Promise<boolean>
  /** Open System Settings at Privacy → Microphone. */
  openMicSettings(): void
  closePad(): void
  /** Pad only: fired each time the pad is shown. */
  onPadShown(cb: () => void): () => void
  onPadHidden(cb: () => void): () => void
  openGarden(): void
  /** Check out the garden: open it on the flower today watered, and bloom it. */
  visitGarden(): void
  /** Keep the pad open beside the garden (tuning the glass), or let it go. */
  pinPad(on: boolean): void
  /** Garden only: a visit to play (on load, ask for one waiting). */
  takeVisit(): Promise<Visit | null>
  onVisit(cb: (v: Visit) => void): () => void
  /** The flowers planted so far, and a call each time one is added. */
  getGarden(): Promise<GardenFlower[]>
  onGarden(cb: (garden: GardenFlower[]) => void): () => void
  /** Pad only: the tray's Write or record, which starts a text block. */
  onOpenSheet(cb: () => void): () => void
  /** Capture mode: main asks for a pose, renderer replies when it is on screen. */
  onCapturePose(cb: (pose: CapturePose) => void): () => void
  capturePosed(): void
  /** A line was written or said: the rain falls on the flower. */
  onWatered(cb: () => void): () => void
  /** The GLB for a flower type, or null to use the placeholder. */
  getModel(id: FlowerId): Promise<ArrayBuffer | null>
  /** Export mode: main asks for each placeholder as a GLB. */
  onExportRequest(cb: (id: FlowerId) => void): () => void
  exportDone(id: FlowerId, glb: ArrayBuffer): void
  /** Tell main where a flower's model came from, so the tray can show it. */
  reportModel(id: FlowerId, source: 'glb' | 'placeholder', problem?: string): void
}

declare global {
  interface Window {
    sip?: SipBridge
  }
}
