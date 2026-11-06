import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Item } from '../../../shared/diary'
import { Player } from '../pad/Player'
import { Close } from '../pad/icons'
import { fileSrc } from '../store'
import { boxOf, fit, newId, PEN_UP, strokePath, strokes, thin, type View } from './geometry'

// A day's board, like a Figma page: text blocks, ink, pictures and voice
// notes laid out anywhere. Pan with a drag on empty space, space-drag or two
// fingers; pinch (or ⌘/ctrl-scroll) to zoom. Fits its content when it opens.
// Without onChange it's read-only (a past or submitted day): you can still
// look round it and play its voice notes.

export type Tool = 'select' | 'text' | 'draw'

export type BoardHandle = {
  /** The board point at the middle of the frame. */
  centre(): { x: number; y: number }
  /** The board point under a client (screen) point. */
  at(cx: number, cy: number): { x: number; y: number }
  fit(): void
  /** Start a text block in the middle and type into it. */
  write(): void
}

type Props = {
  items: Item[]
  onChange?: (items: Item[]) => void
  tool?: Tool
  onTool?: (t: Tool) => void
  /** Refit whenever this changes (another day, the pad shown again). */
  fitKey?: string
  /** Files dropped on the board, and where. */
  onDrop?: (files: File[], at: { x: number; y: number }) => void
  className?: string
  /** Read-only and still: no panning or zooming (a board inside a scrolling
   * panel, so the scroll stays the panel's). */
  fixed?: boolean
  /** A page: board points are the paper's own pixels, never panned, zoomed
   * or fitted. Only its items take the pointer; the paper under them (and the
   * day's words) gets the rest. */
  page?: boolean
}

const ZOOM: [number, number] = [0.2, 4]
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number) => Math.round(v * 10) / 10

type Gesture =
  | { kind: 'pan'; px: number; py: number; vx: number; vy: number }
  | { kind: 'move'; id: string; px: number; py: number; ix: number; iy: number; moved: boolean }
  | { kind: 'size'; id: string; cx: number; cy: number; d0: number; x: number; y: number; w: number; h: number }
  | { kind: 'turn'; id: string; cx: number; cy: number; a0: number; r0: number }
  | { kind: 'ink'; pts: [number, number][] }

export const Board = forwardRef<BoardHandle, Props>(function Board({ items, onChange, tool = 'select', onTool, fitKey = '', onDrop, className, fixed = false, page = false }, ref) {
  const frame = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(page ? { x: 0, y: 0, k: 1 } : { x: 28, y: 28, k: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const itemsRef = useRef(items)
  itemsRef.current = items
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [live, setLive] = useState<[number, number][] | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const space = useRef(false)
  const [panning, setPanning] = useState(false)
  /** The ink item this run of strokes goes into: one per stretch of Draw. */
  const run = useRef<string | null>(null)
  const editable = !!onChange
  const toolRef = useRef(tool)
  toolRef.current = tool

  useEffect(() => {
    run.current = null
    if (tool !== 'select') setSelected(null)
  }, [tool])

  const toBoard = useCallback((cx: number, cy: number) => {
    const r = frame.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k }
  }, [])

  const refit = useCallback(() => {
    const f = frame.current
    if (page || !f || !f.clientWidth) return
    setView(fit(itemsRef.current, f.clientWidth, f.clientHeight))
  }, [page])

  // Fit when it opens on a day.
  useLayoutEffect(() => {
    refit()
    setSelected(null)
    setEditing(null)
    run.current = null
  }, [fitKey, refit])

  useImperativeHandle(ref, () => ({
    centre() {
      const r = frame.current!.getBoundingClientRect()
      return toBoard(r.left + r.width / 2, r.top + r.height / 2)
    },
    at: toBoard,
    fit: refit,
    write() {
      if (!editable) return
      const r = frame.current!.getBoundingClientRect()
      const p = toBoard(r.left + r.width / 2 - 120, r.top + r.height / 2)
      const it: Item = { id: newId(), kind: 'text', x: Math.round(p.x), y: Math.round(p.y - 14), text: '' }
      change([...itemsRef.current, it])
      setSelected(it.id)
      setEditing(it.id)
    }
  }))

  const change = useCallback((next: Item[]) => onChange?.(next), [onChange])
  const update = useCallback(
    (id: string, patch: Partial<Item>) => change(itemsRef.current.map((it) => (it.id === id ? { ...it, ...patch } : it))),
    [change]
  )
  const remove = useCallback(
    (id: string) => {
      change(itemsRef.current.filter((it) => it.id !== id))
      setSelected(null)
      setEditing(null)
    },
    [change]
  )

  /** Done typing: an empty block goes. */
  const editingRef = useRef(editing)
  editingRef.current = editing
  const finishText = useCallback(() => {
    const id = editingRef.current
    if (!id) return
    editingRef.current = null
    setEditing(null)
    const it = itemsRef.current.find((i) => i.id === id)
    if (it && !it.text?.trim()) remove(id)
  }, [remove])

  // A page: a press anywhere but on a picture lets go of the selection.
  useEffect(() => {
    if (!page) return
    const down = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.('[data-item], .board-sel')) setSelected(null)
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [page])

  // Pinch and two-finger scroll (needs a non-passive listener).
  useEffect(() => {
    if (fixed || page) return
    const f = frame.current!
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      if (e.ctrlKey || e.metaKey) {
        const r = f.getBoundingClientRect()
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.01), ZOOM[0], ZOOM[1])
        const mx = e.clientX - r.left
        const my = e.clientY - r.top
        setView({ k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k })
      } else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
    }
    f.addEventListener('wheel', wheel, { passive: false })
    return () => f.removeEventListener('wheel', wheel)
  }, [fixed, page])

  // Keys: space pans, Delete removes, Esc steps back (typing → tool → selection).
  useEffect(() => {
    const typing = () => !!(document.activeElement as HTMLElement | null)?.matches('textarea, input')
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' && !typing()) {
        space.current = true
        setPanning(true)
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        if (editingRef.current) finishText()
        else if (toolRef.current !== 'select') onTool?.('select')
        else if (selected) setSelected(null)
        else return
        e.stopImmediatePropagation()
        e.preventDefault()
        return
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selected && !typing() && editable) {
        remove(selected)
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        space.current = false
        setPanning(false)
      }
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  }, [selected, editable, finishText, onTool, remove])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2 || fixed) return
    const target = e.target as HTMLElement
    // Controls inside an item (play, scrub, delete, the text being typed) are their own.
    if (target.closest('button, .player, textarea, video')) return
    const id = target.closest<HTMLElement>('[data-item]')?.dataset.item ?? null
    const p = toBoard(e.clientX, e.clientY)
    // No mouse-down focus change after this: it would blur the text block a
    // press is about to open (and an empty block blurred goes).
    e.preventDefault()
    const v = viewRef.current
    frame.current!.setPointerCapture(e.pointerId)
    if (page && !id) return
    if (space.current || e.button === 1 || !editable) {
      if (page) return
      gesture.current = { kind: 'pan', px: e.clientX, py: e.clientY, vx: v.x, vy: v.y }
      setPanning(true)
      return
    }
    // A click away from the text being typed finishes it (and lands below).
    if (editingRef.current) finishText()
    if (tool === 'draw') {
      gesture.current = { kind: 'ink', pts: [[p.x, p.y]] }
      setLive([[p.x, p.y]])
      return
    }
    if (id && target.closest('[data-turn]')) {
      // Turn a picture about its middle.
      const it = itemsRef.current.find((i) => i.id === id)!
      const r = target.closest<HTMLElement>('[data-item]')!.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      gesture.current = { kind: 'turn', id, cx, cy, a0: (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI, r0: it.rot ?? 0 }
      return
    }
    if (id && target.closest('[data-handle]')) {
      // Any corner scales the picture about its middle, turned or not.
      const it = itemsRef.current.find((i) => i.id === id)!
      const b = boxOf(it)
      const r = target.closest<HTMLElement>('[data-item]')!.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      gesture.current = { kind: 'size', id, cx, cy, d0: Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy)), x: it.x, y: it.y, w: b.w, h: b.h }
      return
    }
    if (id) {
      const it = itemsRef.current.find((i) => i.id === id)!
      setSelected(id)
      if (tool === 'text' && it.kind === 'text') {
        setEditing(id)
        return
      }
      gesture.current = { kind: 'move', id, px: e.clientX, py: e.clientY, ix: it.x, iy: it.y, moved: false }
      return
    }
    setSelected(null)
    if (tool === 'text') {
      const it: Item = { id: newId(), kind: 'text', x: Math.round(p.x), y: Math.round(p.y - 14), text: '' }
      change([...itemsRef.current, it])
      setSelected(it.id)
      setEditing(it.id)
      return
    }
    gesture.current = { kind: 'pan', px: e.clientX, py: e.clientY, vx: v.x, vy: v.y }
    setPanning(true)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const k = viewRef.current.k
    if (g.kind === 'pan') setView({ ...viewRef.current, x: g.vx + e.clientX - g.px, y: g.vy + e.clientY - g.py })
    else if (g.kind === 'move') {
      const dx = (e.clientX - g.px) / k
      const dy = (e.clientY - g.py) / k
      if (!g.moved && Math.hypot(dx, dy) * k < 3) return
      g.moved = true
      update(g.id, { x: Math.round(g.ix + dx), y: Math.round(g.iy + dy) })
    } else if (g.kind === 'turn') {
      let rot = g.r0 + (Math.atan2(e.clientY - g.cy, e.clientX - g.cx) * 180) / Math.PI - g.a0
      rot = ((rot + 540) % 360) - 180
      // Shift steps by 15°; near straight snaps straight.
      if (e.shiftKey) rot = Math.round(rot / 15) * 15
      else if (Math.abs(rot) < 2) rot = 0
      update(g.id, { rot: Math.round(rot * 10) / 10 })
    } else if (g.kind === 'size') {
      // Pictures keep their shape and their middle.
      const s = Math.hypot(e.clientX - g.cx, e.clientY - g.cy) / g.d0
      const w = clamp(g.w * s, 40, 1600)
      const h = (w * g.h) / g.w
      update(g.id, { w: Math.round(w), h: Math.round(h), x: Math.round(g.x + (g.w - w) / 2), y: Math.round(g.y + (g.h - h) / 2) })
    } else {
      // Coalesced events: every point the pen passed, not one a frame.
      const evs = e.nativeEvent.getCoalescedEvents?.() ?? []
      for (const ev of evs.length ? evs : [e.nativeEvent]) {
        const p = toBoard(ev.clientX, ev.clientY)
        g.pts.push([p.x, p.y])
      }
      setLive([...g.pts])
    }
  }

  const onPointerUp = () => {
    const g = gesture.current
    gesture.current = null
    if (!space.current) setPanning(false)
    if (!g || g.kind !== 'ink') return
    setLive(null)
    const pts = thin(g.pts)
    if (pts.length === 1) pts.push([pts[0][0] + 0.1, pts[0][1]])
    const runIt = run.current ? itemsRef.current.find((i) => i.id === run.current) : undefined
    if (runIt?.points) {
      // Into this stretch's item, relative to its origin.
      const add = pts.flatMap(([x, y]) => [round(x - runIt.x), round(y - runIt.y)])
      update(runIt.id, { points: [...runIt.points, PEN_UP, PEN_UP, ...add] })
    } else {
      const x0 = Math.round(Math.min(...pts.map((p) => p[0])))
      const y0 = Math.round(Math.min(...pts.map((p) => p[1])))
      const it: Item = { id: newId(), kind: 'ink', x: x0, y: y0, points: pts.flatMap(([x, y]) => [round(x - x0), round(y - y0)]) }
      run.current = it.id
      change([...itemsRef.current, it])
    }
  }

  const sel = selected ? items.find((i) => i.id === selected) : undefined
  const selBox = sel && editable && selected !== editing ? boxOf(sel) : null

  return (
    <div
      ref={frame}
      className={`board${className ? ` ${className}` : ''}`}
      data-tool={editable ? tool : fixed ? 'fixed' : 'view'}
      data-page={page || undefined}
      data-panning={panning || undefined}
      data-test="board"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>('[data-item]')?.dataset.item
        const it = id ? items.find((i) => i.id === id) : undefined
        if (editable && it?.kind === 'text') {
          setSelected(it.id)
          setEditing(it.id)
        }
      }}
      onDragOver={(e) => onDrop && e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        if (!onDrop || !e.dataTransfer.files.length) return
        e.preventDefault()
        onDrop([...e.dataTransfer.files], toBoard(e.clientX, e.clientY))
      }}
    >
      <div className="board-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        {items.map((it) => (
          <ItemView key={it.id} item={it} selected={it.id === selected} editing={it.id === editing} onText={(text) => update(it.id, { text })} onDone={finishText} />
        ))}
        {live && (
          <svg className="board-ink is-live">
            <path d={strokePath(live)} />
          </svg>
        )}
        {selBox && (
          <div
            className="board-sel"
            style={{ left: selBox.x - 6, top: selBox.y - 6, width: selBox.w + 12, height: selBox.h + 12, transform: sel?.rot ? `rotate(${sel.rot}deg)` : undefined, ['--k' as string]: view.k }}
          >
            <button type="button" className="board-del" data-test="delete" aria-label="Delete" onClick={() => remove(sel!.id)}>
              <Close />
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

function ItemView({ item: it, selected, editing, onText, onDone }: { item: Item; selected: boolean; editing: boolean; onText: (t: string) => void; onDone: () => void }) {
  const style: React.CSSProperties = { left: it.x, top: it.y }
  const common = { 'data-item': it.id, 'data-kind': it.kind, 'data-selected': selected || undefined }
  if (it.kind === 'text')
    return editing ? (
      <textarea
        {...common}
        autoFocus
        className="board-text is-editing"
        data-test="text-edit"
        style={style}
        value={it.text ?? ''}
        maxLength={2000}
        spellCheck={false}
        placeholder="Something good today"
        onChange={(e) => onText(e.target.value)}
        onBlur={onDone}
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
      />
    ) : (
      <div {...common} className="board-text" style={style}>
        {it.text}
      </div>
    )
  if (it.kind === 'ink')
    return (
      <svg {...common} className="board-ink" style={style}>
        {strokes(it.points ?? []).map((s, i) => (
          <path key={i} d={strokePath(s)} />
        ))}
      </svg>
    )
  if (it.kind === 'voice')
    return (
      <div {...common} className="board-voice" style={style}>
        <Player src={fileSrc(it)} ms={it.ms ?? 0} peaks={it.peaks} label="Voice note" compact />
      </div>
    )
  const box = boxOf(it)
  return (
    <div {...common} className="board-media" style={{ ...style, width: box.w, height: box.h, transform: it.rot ? `rotate(${it.rot}deg)` : undefined }}>
      {it.kind === 'image' ? (
        <img src={fileSrc(it) ?? undefined} alt="" draggable={false} />
      ) : (
        <video src={fileSrc(it) ?? undefined} controls muted playsInline preload="metadata" />
      )}
      {selected && (
        <>
          {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
            <span key={c} className={`board-handle is-${c}`} data-handle aria-hidden="true" />
          ))}
          <span className="board-turn" data-turn aria-hidden="true" />
        </>
      )}
    </div>
  )
}
