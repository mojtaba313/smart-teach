import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { cn, normalizeFa } from '../../lib/utils'
import { popOverlay, pushOverlay } from '../../lib/hotkeys'

export type Command = {
  id: string
  label: string
  group?: string
  hint?: string
  icon?: ReactNode
  /** extra words that should also match this command */
  keywords?: string
  run: () => void
  disabled?: boolean
}

function score(query: string, command: Command): number {
  const q = normalizeFa(query)
  if (!q) return 0
  const hay = normalizeFa(`${command.label} ${command.group ?? ''} ${command.keywords ?? ''}`)
  const idx = hay.indexOf(q)
  if (idx === 0) return 1000
  if (idx > 0) return 700 - Math.min(idx, 200)
  // subsequence fallback so partial words still hit
  let i = 0
  for (const ch of q) {
    i = hay.indexOf(ch, i)
    if (i === -1) return -1
    i += 1
  }
  return 200
}

/** Mounts only while open, so the query and cursor always start empty. */
export function CommandPalette({
  open,
  commands,
  onClose,
  placeholder = 'دستور یا جست‌وجو…',
}: {
  open: boolean
  commands: Command[]
  onClose: () => void
  placeholder?: string
}) {
  if (!open) return null
  return <PaletteBody commands={commands} onClose={onClose} placeholder={placeholder} />
}

function PaletteBody({
  commands,
  onClose,
  placeholder,
}: {
  commands: Command[]
  onClose: () => void
  placeholder: string
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    pushOverlay()
    return () => popOverlay()
  }, [])

  const results = useMemo(() => {
    const scored = commands
      .filter((c) => !c.disabled)
      .map((c) => ({ c, s: score(query, c) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)
    return scored
  }, [commands, query])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-cmd="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor, results.length])

  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>()
    for (const c of results) {
      const g = c.group ?? 'دیگر'
      map.set(g, [...(map.get(g) ?? []), c])
    }
    return [...map.entries()]
  }, [results])

  const flatIndex = useMemo(() => grouped.flatMap(([, items]) => items), [grouped])

  const commit = (cmd: Command | undefined) => {
    if (!cmd) return
    onClose()
    // Let the dialog unmount before the command navigates or opens a modal.
    requestAnimationFrame(() => cmd.run())
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => (c + 1) % Math.max(1, flatIndex.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (c - 1 + flatIndex.length) % Math.max(1, flatIndex.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(flatIndex[cursor])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Home') {
      e.preventDefault()
      setCursor(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setCursor(Math.max(0, flatIndex.length - 1))
    }
  }

  let running = -1

  return createPortal(
    <div className="fixed inset-0 z-[94] flex items-start justify-center p-3 pt-[12vh] sm:p-6 sm:pt-[14vh]">
      <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="جعبه‌فرمان"
        className="relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-pop"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-hairline bg-surface px-4 py-3">
          <Search className="size-4 shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            placeholder={placeholder}
            aria-label="جست‌وجوی دستور"
            className="min-w-0 flex-1 bg-transparent text-[15px] font-bold outline-none placeholder:font-normal placeholder:text-ink-3/70"
          />
          <kbd className="kbd shrink-0">Esc</kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto scroll-thin p-2">
          {flatIndex.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-ink-3">دستوری با این عبارت پیدا نشد.</p>
          )}
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-1.5 last:mb-0">
              <p className="px-2.5 pb-1 pt-2 text-2xs font-black uppercase tracking-wide text-ink-3">{group}</p>
              {items.map((c) => {
                running += 1
                const active = running === cursor
                return (
                  <button
                    key={c.id}
                    type="button"
                    data-cmd={running}
                    onMouseEnter={() => setCursor(running)}
                    onClick={() => commit(c)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start text-sm font-bold transition',
                      active ? 'bg-brand-soft text-ink' : 'text-ink-2 hover:bg-sunken',
                    )}
                  >
                    {c.icon && <span className="shrink-0 text-ink-3 [&>svg]:size-4">{c.icon}</span>}
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {c.hint && <kbd className="kbd shrink-0">{c.hint}</kbd>}
                    {active && <CornerDownLeft className="size-3.5 shrink-0 text-ink-3" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
