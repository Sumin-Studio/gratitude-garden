import { useEffect, useRef, useState } from 'react'
import { Waveform } from '../ui/Waveform'
import { Pause, Play } from './icons'
import { clock } from './recorder'

// A voice note's player: play/pause, its dithered wave (which is the
// scrubber), and `0:03 / 0:12`. One plays at a time. The length comes from
// the diary, since a webm straight from MediaRecorder doesn't know its own.

let current: HTMLAudioElement | null = null

type Props = {
  src: string | null
  ms: number
  peaks?: number[]
  label?: string
  compact?: boolean
}

export function Player({ src, ms, peaks, label = 'Voice note', compact = false }: Props) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)

  useEffect(() => {
    const a = audio.current
    if (!a) return
    const stop = () => {
      setPlaying(false)
      setAt(0)
    }
    const pause = () => {
      setPlaying(false)
      setAt(a.currentTime * 1000)
    }
    const play = () => setPlaying(true)
    a.addEventListener('ended', stop)
    a.addEventListener('pause', pause)
    a.addEventListener('play', play)
    return () => {
      a.removeEventListener('ended', stop)
      a.removeEventListener('pause', pause)
      a.removeEventListener('play', play)
      if (current === a) current = null
      a.pause()
    }
  }, [src])

  // Every frame while it plays, so the head sweeps smoothly.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      if (audio.current) setAt(audio.current.currentTime * 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const toggle = () => {
    const a = audio.current
    if (!a || !src) return
    if (playing) return a.pause()
    if (current && current !== a) current.pause()
    current = a
    void a.play().catch(() => setPlaying(false))
  }

  const seek = (f: number) => {
    const a = audio.current
    if (!a || !src) return
    const t = (f * ms) / 1000
    a.currentTime = t
    setAt(t * 1000)
  }

  const total = clock(ms)
  const progress = playing || at > 0 ? Math.min(1, at / Math.max(1, ms)) : undefined
  return (
    <span className={`player${compact ? ' is-compact' : ''}${playing ? ' is-playing' : ''}`}>
      {src && <audio ref={audio} src={src} preload="metadata" />}
      <button type="button" className="player-toggle" aria-label={playing ? `Pause ${label}` : `Play ${label}`} disabled={!src} onClick={toggle}>
        {playing ? <Pause size={compact ? 8 : 10} /> : <Play size={compact ? 8 : 10} />}
      </button>
      <span className="player-wave">
        <Waveform peaks={peaks} src={src} progress={progress} onSeek={src ? seek : undefined} height={compact ? 22 : 24} label={label} />
      </span>
      <span className="player-time" data-test="player-time">
        {progress !== undefined ? `${clock(Math.min(at, ms))} / ${total}` : total}
      </span>
    </span>
  )
}
