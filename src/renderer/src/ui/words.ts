import type { Item } from '../../../shared/diary'

/** A day's words: its text items one after the other (older boards had
 * several, anywhere; the page has one, at the top). */
export const wordsOf = (items: Item[]) =>
  items
    .filter((i) => i.kind === 'text')
    .map((i) => i.text ?? '')
    .filter(Boolean)
    .join('\n')
