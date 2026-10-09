import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-aware class joiner. Later utilities beat earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/** Round to a step, keeping values on a human-friendly grid. */
export function snap(n: number, step: number): number {
  if (step <= 0) return n
  return Math.round(n / step) * step
}

/* ------------------------------------------------------------------ *
 *  Numbers — the UI is Persian, so digits should follow suit.
 * ------------------------------------------------------------------ */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']

/** 1402 → «۱۴۰۲» */
export function toFaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)])
}

export function toEnDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}

/** Grouped Persian number with up to `digits` decimals. */
export function faNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—'
  const fixed = Number(n.toFixed(digits))
  const [int, dec] = String(fixed).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '٬')
  return toFaDigits(dec ? `${grouped}٫${dec}` : grouped)
}

/** Lenient numeric parser: accepts Persian/Arabic digits and `٫`/`,` decimals. */
export function parseNum(raw: string): number {
  const cleaned = toEnDigits(raw).replace(/[٬,\s]/g, '')
  const n = Number.parseFloat(cleaned)
  return Number.isFinite(n) ? n : NaN
}

export function fmtClock(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60)
  const s = Math.floor(Math.max(0, sec) % 60)
  return toFaDigits(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
}

/* ------------------------------------------------------------------ *
 *  Arrays
 * ------------------------------------------------------------------ */

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length) return next
  const target = clamp(to, 0, next.length - 1)
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}

/* ------------------------------------------------------------------ *
 *  Text
 * ------------------------------------------------------------------ */

/** Loose Persian-aware comparison: unifies ی/ي, ک/ك, removes ZWNJ & diacritics. */
export function normalizeFa(s: string): string {
  return s
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/‌/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ordered subsequence match — good enough for tag-path + stem search. */
export function fuzzyMatch(needle: string, haystack: string): boolean {
  const n = normalizeFa(needle)
  if (!n) return true
  const h = normalizeFa(haystack)
  let i = 0
  for (const ch of n) {
    if (ch === ' ') continue
    const found = h.indexOf(ch, i)
    if (found === -1) return false
    i = found + 1
  }
  return true
}

/* ------------------------------------------------------------------ *
 *  Events & focus
 * ------------------------------------------------------------------ */

const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** True when the user is typing somewhere and global shortcuts must stand down. */
export function isEditableTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  if (!node) return false
  if (node.isContentEditable) return true
  if (!EDITABLE.has(node.tagName)) return false
  const t = node as HTMLInputElement
  // radio/checkbox/button-like inputs never swallow single-letter shortcuts
  return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(t.type)
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
}

/** Human-readable combo for the current platform. */
export function prettyCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => {
      if (part === 'mod') return isMac() ? '⌘' : 'Ctrl'
      if (part === 'shift') return isMac() ? '⇧' : 'Shift'
      if (part === 'alt') return isMac() ? '⌥' : 'Alt'
      if (part === 'space') return 'Space'
      if (part === 'enter') return isMac() ? '↩' : 'Enter'
      if (part === 'esc') return 'Esc'
      if (part === 'arrowleft') return '←'
      if (part === 'arrowright') return '→'
      if (part === 'arrowup') return '↑'
      if (part === 'arrowdown') return '↓'
      if (part === 'backspace') return '⌫'
      if (part === 'delete') return 'Del'
      if (part.length === 1) return part.toUpperCase()
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(isMac() ? '' : ' + ')
}

/** Normalised combo string for a keyboard event, e.g. `mod+k` / `shift+?`. */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('mod')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  let key = e.key.toLowerCase()
  if (key === ' ') key = 'space'
  else if (key === 'escape') key = 'esc'
  else if (key === 'arrowleft') key = 'arrowleft'
  else if (key === 'arrowright') key = 'arrowright'
  else if (key === 'arrowup') key = 'arrowup'
  else if (key === 'arrowdown') key = 'arrowdown'
  else if (key === 'backspace') key = 'backspace'
  else if (key === 'delete') key = 'delete'
  else if (key === 'enter') key = 'enter'
  parts.push(key)
  return parts.join('+')
}

/* ------------------------------------------------------------------ *
 *  Misc
 * ------------------------------------------------------------------ */
