import { useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Plus, Tag as TagIcon, X } from 'lucide-react'
import { TAG_SEP, splitTags, tagPath } from '../../types'
import { cn, normalizeFa } from '../../lib/utils'


/**
 * Hierarchical tag entry.
 *
 * The path is the question's identity — `کنکور:حرکت شناسی:حرکت شتابدار:نمودار سرعت-زمان` —
 * so the editor mirrors that shape: chips for committed segments, and `:` (or
 * Enter) to descend a level. Backspace walks back up.
 */
export function TagInput({
  value,
  onChange,
  suggestions,
  placeholder = 'کنکور:حرکت شناسی:…',
  id,
  compact,
}: {
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  placeholder?: string
  id?: string
  compact?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const list = suggestions ?? []
    if (!draft.trim()) {
      // Show the next level down for each existing branch.
      return list.filter((p) => {
        const segs = splitTags(p)
        return segs.length === value.length + 1 && segs.slice(0, value.length).every((s, i) => s === value[i])
      })
    }
    return list
      .map(splitTags)
      .filter((segs) => segs.length > value.length && segs.slice(0, value.length).every((s, i) => s === value[i]))
      .filter((segs) => normalizeFa(segs[value.length] ?? '').includes(normalizeFa(draft)))
      .slice(0, 12)
      .map((segs) => segs.join(TAG_SEP))
  }, [draft, suggestions, value])

  const commit = (seg: string) => {
    const clean = seg.trim().replace(/\s+/g, ' ')
    if (!clean) return
    if (value.includes(clean)) {
      setDraft('')
      return
    }
    onChange([...value, clean])
    setDraft('')
    setCursor(0)
  }

  const commitFromSuggestion = (path: string) => {
    onChange(splitTags(path))
    setDraft('')
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === TAG_SEP) {
      e.preventDefault()
      if (open && matches[cursor] && draft.trim()) commitFromSuggestion(matches[cursor])
      else commit(draft)
      return
    }
    if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault()
      onChange(value.slice(0, -1))
      return
    }
    if (e.key === 'ArrowDown' && open && matches.length > 0) {
      e.preventDefault()
      setCursor((c) => (c + 1) % matches.length)
    } else if (e.key === 'ArrowUp' && open && matches.length > 0) {
      e.preventDefault()
      setCursor((c) => (c - 1 + matches.length) % matches.length)
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <div
        ref={boxRef}
        onClick={() => boxRef.current?.querySelector('input')?.focus()}
        className={cn(
          'flex flex-wrap items-center gap-1 rounded-xl border border-hairline bg-surface px-2 py-1.5 transition focus-within:border-brand/70 focus-within:ring-2 focus-within:ring-brand/20',
          compact ? 'min-h-9' : 'min-h-10',
        )}
      >
        <TagIcon className="ms-1 size-3.5 shrink-0 text-ink-3" />
        {value.map((seg, i) => (
          <span
            key={`${seg}-${i}`}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-soft py-0.5 pe-1 ps-2 text-2xs font-bold text-brand"
          >
            {i > 0 && <span className="text-brand/45">{TAG_SEP}</span>}
            {seg}
            <button
              type="button"
              aria-label={`حذف برچسب ${seg}`}
              onClick={(e) => {
                e.stopPropagation()
                onChange(value.filter((_, j) => j !== i))
              }}
              className="rounded p-0.5 transition hover:bg-brand/20"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setOpen(true)
            setCursor(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 140)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : `${TAG_SEP} سطح بعدی…`}
          aria-label="مسیر برچسب"
          className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-ink-3/70"
        />
        {value.length > 0 && (
          <span className="hidden shrink-0 text-2xs text-ink-3 sm:inline" dir="ltr">
            {tagPath(value)}
          </span>
        )}
      </div>

      {open && matches.length > 0 && (
        <div className="absolute z-40 mt-1 max-h-56 w-full min-w-64 overflow-y-auto scroll-thin rounded-xl border border-hairline bg-surface p-1 shadow-pop">
          {matches.map((m, i) => {
            const segs = splitTags(m)
            return (
              <button
                key={m}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  commitFromSuggestion(m)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-xs font-bold transition',
                  i === cursor ? 'bg-sunken text-ink' : 'text-ink-2',
                )}
              >
                <Plus className={cn('size-3.5 shrink-0', i === cursor ? 'text-brand' : 'text-ink-3')} />
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  <span className="opacity-55">{segs.slice(0, value.length).join(TAG_SEP) + (value.length ? TAG_SEP : '')}</span>
                  <span className="font-black">{segs[value.length]}</span>
                </span>
                <CornerDownLeft className="size-3 shrink-0 opacity-0 group-hover:opacity-40" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Read-only breadcrumb of a tag path. */
export function TagBreadcrumb({ tags, className, max = 4 }: { tags: string[]; className?: string; max?: number }) {
  if (tags.length === 0) return <span className={cn('text-2xs text-ink-3', className)}>بدون برچسب</span>
  const shown = tags.length > max ? [tags[0], '…', ...tags.slice(-(max - 1))] : tags
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-0.5 text-2xs', className)} dir="auto">
      {shown.map((s, i) => (
        <span key={`${s}-${i}`} className="contents">
          {i > 0 && <span className="text-ink-3/50">{TAG_SEP}</span>}
          <span className={cn('font-bold', i === tags.length - 1 ? 'text-ink-2' : 'text-ink-3')}>{s}</span>
        </span>
      ))}
    </span>
  )
}
