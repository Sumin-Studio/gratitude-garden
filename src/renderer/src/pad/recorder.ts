import { useCallback, useEffect, useRef, useState } from 'react'
import { bridge } from '../store'
import { toPeaks } from '../ui/Waveform'

// A voice note from the microphone: MediaRecorder (webm/opus) with an
// analyser alongside for the level meter. At most two minutes.

export const MAX_MS = 120_000
const MIME = 'audio/webm;codecs=opus'

export type RecStatus = 'idle' | 'asking' | 'off' | 'recording' | 'done'

export type Recording = {
  status: RecStatus
  /** Running while recording, the length afterwards. */
  ms: number
  /** 0..1, while recording. */
  level: number
  blob: Blob | null
  /** The levels so far, oldest first (one a frame), for the live wave. */
  history(): number[]
  /** The take's loudness across it, ~96 values, once it's done. */
  peaks: number[]
  start(): void
  stop(): void
  /** Throw the take away and start over. */
  reset(): void
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function useRecorder(): Recording {
  const [status, setStatus] = useState<RecStatus>('idle')
  const [ms, setMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [peaks, setPeaks] = useState<number[]>([])
  const levels = useRef<number[]>([])
  const live = useRef<{ stream: MediaStream; rec: MediaRecorder; ctx: AudioContext; raf: number; t0: number } | null>(null)

  const release = useCallback(() => {
    const l = live.current
    if (!l) return
    live.current = null
    cancelAnimationFrame(l.raf)
    l.stream.getTracks().forEach((t) => t.stop())
    void l.ctx.close().catch(() => {})
  }, [])

  const stop = useCallback(() => {
    const l = live.current
    if (!l) return
    const took = Math.min(MAX_MS, performance.now() - l.t0)
    setMs(took)
    setLevel(0)
    setPeaks(toPeaks(levels.current))
    // onstop hands the chunks over; `inactive` means nothing was ever started.
    if (l.rec.state !== 'inactive') l.rec.stop()
    else setStatus('idle')
    release()
  }, [release])

  const start = useCallback(async () => {
    if (live.current) return
    setStatus('asking')
    setBlob(null)
    setMs(0)
    setPeaks([])
    levels.current = []
    let stream: MediaStream
    try {
      if (!(await bridge.askMic())) throw new Error('mic off')
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setStatus('off')
      return
    }
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    ctx.createMediaStreamSource(stream).connect(analyser)
    const rec = new MediaRecorder(stream, MediaRecorder.isTypeSupported(MIME) ? { mimeType: MIME } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      setBlob(new Blob(chunks, { type: rec.mimeType || MIME }))
      setStatus('done')
    }
    const samples = new Uint8Array(analyser.fftSize)
    const t0 = performance.now()
    let held = 0
    const tick = () => {
      const l = live.current
      if (!l) return
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const v of samples) sum += ((v - 128) / 128) ** 2
      // RMS, lifted so a quiet voice still moves the ticks; jumps up, falls
      // back over a few frames so the ticks don't flicker.
      const rms = Math.min(1, Math.sqrt(sum / samples.length) * 4)
      held = Math.max(rms, held * 0.88)
      setLevel(held)
      levels.current.push(held)
      const t = performance.now() - t0
      setMs(t)
      if (t >= MAX_MS) stop()
      else l.raf = requestAnimationFrame(tick)
    }
    live.current = { stream, rec, ctx, raf: 0, t0 }
    rec.start(250)
    setStatus('recording')
    live.current.raf = requestAnimationFrame(tick)
  }, [stop])

  const reset = useCallback(() => {
    release()
    setBlob(null)
    setMs(0)
    setLevel(0)
    setPeaks([])
    levels.current = []
    setStatus('idle')
  }, [release])

  useEffect(() => release, [release])

  const history = useCallback(() => levels.current, [])
  return { status, ms, level, blob, history, peaks, start: () => void start(), stop, reset }
}
