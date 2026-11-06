import { useCallback, useEffect, useRef, useState } from 'react'
import { keeps, type Item } from '../../../shared/diary'
import { Board, type BoardHandle } from '../board/Board'
import { newId } from '../board/geometry'
import { bridge, fileSrc, useDiary } from '../store'
import brushMask from '../ui/brush-mask.svg'
import { wordsOf } from '../ui/words'
import { ImageTool } from './icons'

// The pad: the day as a page, laid out as Simon's Figma sheet (ui/sheet.css)
// without its header (Simon: no date, no space above the paper). The paper: the day's words from its top, pictures
// stuck on anywhere (moved, turned and resized like prints in a scrapbook).
// The pill in the paper's corner adds a picture; Visit the garden and Submit
// below. Everything saves as you go; submitting locks the day and waters the
// plant once for the words and once per picture. Earlier days live in the
// garden, in each flower's scrapbook.

/** Video is a Nice: on with `?video` or localStorage `sip-video=1`. */
const VIDEO = new URLSearchParams(location.search).has('video') || safeGet('sip-video') === '1'
const SAVE_MS = 250
/** A new print, at most (the Figma's are about 170 × 145). */
const IMAGE_MAX: [number, number] = [176, 148]
/** Where the words sit on the paper (Figma: 13, 21). */
const TEXT_AT = { x: 13, y: 21 }

function safeGet(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const extOf = (f: File) => (f.name.split('.').pop() ?? f.type.split('/')[1] ?? '').toLowerCase()
export function Pad() {
  const state = useDiary()
  const board = useRef<BoardHandle>(null)
  const words = useRef<HTMLTextAreaElement>(null)
  const files = useRef<HTMLInputElement>(null)

  // Today's board, kept here while you work on it and saved behind you.
  const today = state?.today
  const dayKey = today ? `${today.date}:${today.submittedAt ?? ''}` : ''
  const [items, setItems] = useState<Item[]>([])
  const dirty = useRef(false)
  useEffect(() => {
    if (!today) return
    setItems(today.items)
    dirty.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey])
  // Changed from outside (a script, or the save coming back): taken in
  // unless there's typing here not yet saved.
  useEffect(() => {
    if (today && !dirty.current) setItems(today.items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today?.items])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const flush = useCallback(() => {
    if (!dirty.current) return
    dirty.current = false
    bridge.saveToday(itemsRef.current)
  }, [])
  useEffect(() => {
    if (!dirty.current) return
    const t = window.setTimeout(flush, SAVE_MS)
    return () => window.clearTimeout(t)
  }, [items, flush])
  const edit = useCallback((next: Item[]) => {
    dirty.current = true
    setItems(next)
  }, [])

  // Hidden: anything unsaved saved.
  useEffect(() => bridge.onPadHidden(flush), [flush])
  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [flush])
  // The tray's Write or record: start typing, at the end of the words.
  useEffect(
    () =>
      bridge.onOpenSheet(() => {
        requestAnimationFrame(() => {
          const t = words.current
          if (!t || t.readOnly) return
          t.focus()
          t.setSelectionRange(t.value.length, t.value.length)
        })
      }),
    []
  )

  const locked = !!today?.submittedAt
  const editable = !locked

  // Pictures: from the picker, pasted, or dropped from Finder.
  const addFiles = useCallback(
    async (list: File[], at?: { x: number; y: number }) => {
      // Dropped where it lands; picked or pasted, a little below the middle.
      const centre = at ?? { x: 158, y: 170 }
      let offset = 0
      for (const f of list) {
        const video = f.type.startsWith('video/')
        if (!f.type.startsWith('image/') && !(video && VIDEO)) continue
        const name = await bridge.addMedia(await f.arrayBuffer(), extOf(f))
        if (!name) continue
        let [w, h] = IMAGE_MAX
        try {
          if (video) [w, h] = [176, 99]
          else {
            const bmp = await createImageBitmap(f)
            const k = Math.min(1, IMAGE_MAX[0] / bmp.width, IMAGE_MAX[1] / bmp.height)
            ;[w, h] = [Math.round(bmp.width * k), Math.round(bmp.height * k)]
            bmp.close()
          }
        } catch {
          /* a picture Chromium can't read still gets its card */
        }
        // Stuck on crooked, like a print in a scrapbook.
        const rot = Math.round((Math.random() * 20 - 10) * 10) / 10
        const it: Item = { id: newId(), kind: video ? 'video' : 'image', x: Math.round(centre.x - w / 2 + offset), y: Math.round(centre.y - h / 2 + offset), w, h, rot, file: name }
        offset += 18
        edit([...itemsRef.current, it])
      }
    },
    [edit]
  )
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (!editable || (document.activeElement as HTMLElement | null)?.matches('textarea, input')) return
      const pics = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (!pics.length) return
      e.preventDefault()
      void addFiles(pics)
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [editable, addFiles])

  // Esc closes the pad once the board has nothing left to step back from.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = document.activeElement as HTMLElement | null
      if (t === words.current) t?.blur()
      else bridge.closePad()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  if (!state || !today) return null
  const kept = items.filter(keeps).length
  const counts = kept > 0
  const text = wordsOf(items)
  const pictures = items.filter((i) => i.kind !== 'text')

  /** The words are one text item at the top of the paper (none while empty). */
  const write = (next: string) => {
    const old = items.find((i) => i.kind === 'text')
    const rest = items.filter((i) => i.kind !== 'text')
    edit(next ? [{ id: old?.id ?? newId(), kind: 'text', ...TEXT_AT, text: next }, ...rest] : rest)
  }

  const submit = () => {
    if (!counts) return
    words.current?.blur()
    dirty.current = true
    flush()
    bridge.submitToday()
  }

  return (
    <main className="pad sheet" data-locked={locked || undefined}>

      <section
        className="pad-card sheet-paper"
        data-test="card"
        data-state={locked ? 'locked' : 'open'}
        onMouseDown={(e) => {
          // A press on bare paper types: the words, from the end.
          const t = words.current
          if (e.target !== e.currentTarget || !t || !editable) return
          e.preventDefault()
          t.focus()
          t.setSelectionRange(t.value.length, t.value.length)
        }}
      >
        {locked && today.window && (
          // Submitted: a window into the garden round the flower the day grew,
          // under the words and prints, its edges brushed into the paper.
          <div className="pad-window" data-test="page-window" style={{ '--brush': `url("${brushMask}")` } as React.CSSProperties}>
            <img src={fileSrc({ kind: 'image', file: today.window }) ?? undefined} alt="Your flower in the garden" draggable={false} />
          </div>
        )}
        <textarea
          ref={words}
          className="sheet-words pad-words"
          data-test="words"
          value={text}
          readOnly={!editable}
          maxLength={4000}
          spellCheck={false}
          placeholder={editable ? 'What was good today?' : undefined}
          aria-label="What was good today"
          onChange={(e) => write(e.target.value)}
        />
        <Board
          ref={board}
          page
          items={pictures}
          onChange={editable ? (next) => edit([...items.filter((i) => i.kind === 'text'), ...next]) : undefined}
          fitKey={dayKey}
          onDrop={editable ? (list, at) => void addFiles(list, at) : undefined}
        />
      </section>

      <button
        type="button"
        className="sheet-pill sheet-button sheet-count pad-add"
        data-test="tool-image"
        title={VIDEO ? 'Add a picture or video' : 'Add a picture'}
        aria-label={VIDEO ? 'Add a picture or video' : 'Add a picture'}
        disabled={!editable}
        onClick={() => files.current?.click()}
      >
        <ImageTool />
      </button>
      <input
        ref={files}
        type="file"
        hidden
        multiple
        accept={VIDEO ? 'image/*,video/*' : 'image/*'}
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />

      <footer className="sheet-foot">
        <button type="button" className="sheet-pill sheet-button is-ghost" data-test="visit" onClick={() => bridge.visitGarden()}>
          Visit the garden
        </button>
        <button type="button" className="sheet-pill sheet-button is-primary" data-test="action" disabled={locked || !counts} onClick={submit}>
          {locked ? 'Submitted' : 'Submit'}
        </button>
      </footer>
    </main>
  )
}
