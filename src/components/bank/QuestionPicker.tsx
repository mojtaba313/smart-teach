import { useEffect, useMemo, useRef, useState } from 'react'
import { BookMarked, Check, Filter, Plus, Search, Star, X } from 'lucide-react'
import type { BankQuestion, Difficulty } from '../../types'
import { DIFFICULTY_LABEL, TAG_SEP, splitTags, tagPath } from '../../types'
import { cn, fuzzyMatch, normalizeFa, toFaDigits } from '../../lib/utils'
import { Badge, Button, Empty, IconButton, Segmented } from '../ui/primitives'
import { TagBreadcrumb } from './TagInput'
import { renderRich } from '../blocks/RichText'

const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']
const faNum = (n: number) => FA[n] ?? String(n)

/* ------------------------------------------------------------------ *
 *  Card — the same shape used in the bank list and the picker
 * ------------------------------------------------------------------ */

export function QuestionCard({
  question,
  selected,
  onSelect,
  onToggleStar,
  actions,
  compact,
}: {
  question: BankQuestion
  selected?: boolean
  onSelect?: () => void
  onToggleStar?: () => void
  actions?: React.ReactNode
  compact?: boolean
}) {
  const body = (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div dir="auto" className={cn('font-bold leading-8 text-ink', compact ? 'text-sm' : 'text-[15px]')}>
            {renderRich(question.stem)}
          </div>
          {!compact && (
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {question.options.slice(0, 6).map((o, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-start gap-1.5 rounded-lg px-2 py-1 text-xs leading-6',
                    i === question.answerIndex ? 'bg-ok/10 font-bold text-ok' : 'bg-sunken/70 text-ink-2',
                  )}
                >
                  <span className="shrink-0 font-black opacity-70">{faNum(i + 1)}</span>
                  <span dir="auto" className="min-w-0 flex-1">
                    {o || <span className="italic opacity-50">—</span>}
                  </span>
                  {i === question.answerIndex && <Check className="mt-1 size-3 shrink-0" />}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onToggleStar && (
            <IconButton
              icon={Star}
              label={question.starred ? 'حذف ستاره' : 'ستاره‌دار کردن'}
              size="sm"
              active={question.starred}
              className={cn(!question.starred && 'text-ink-3')}
              onClick={onToggleStar}
            />
          )}
          {actions}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <TagBreadcrumb tags={question.tags} max={compact ? 3 : 6} />
        {question.source && <span className="text-2xs text-ink-3">{question.source}</span>}
        {question.year && <span className="text-2xs text-ink-3">سال {toFaDigits(question.year)}</span>}
        {question.difficulty && <Badge tone={question.difficulty === 3 ? 'danger' : question.difficulty === 1 ? 'ok' : 'neutral'}>{DIFFICULTY_LABEL[question.difficulty]}</Badge>}
      </div>
    </>
  )

  if (!onSelect) {
    return <div className="rounded-2xl border border-hairline bg-surface p-3.5 shadow-card">{body}</div>
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-2xl border p-3.5 text-start transition',
        selected ? 'border-brand bg-brand-soft/60 shadow-card' : 'border-hairline bg-surface hover:border-brand/50 hover:bg-soft',
      )}
    >
      {body}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 *  Matching
 * ------------------------------------------------------------------ */

export function matchesQuery(q: BankQuestion, query: string, pathFilter: string[]): boolean {
  if (pathFilter.length > 0 && !pathFilter.every((seg, i) => q.tags[i] === seg)) return false
  const s = query.trim()
  if (!s) return true
  // A query containing ':' is a path lookup; otherwise search everything.
  if (s.includes(TAG_SEP)) {
    const wanted = splitTags(s)
    if (wanted.length > q.tags.length) return false
    return wanted.every((seg, i) => normalizeFa(seg) === normalizeFa(q.tags[i] ?? ''))
  }
  return (
    fuzzyMatch(s, q.stem) ||
    fuzzyMatch(s, tagPath(q.tags)) ||
    fuzzyMatch(s, q.source ?? '') ||
    (q.year !== undefined && s.includes(String(q.year)))
  )
}

/* ------------------------------------------------------------------ *
 *  Picker — the "insert anywhere" surface
 * ------------------------------------------------------------------ */

/**
 * Mounts only while open, so every keystroke of state starts fresh — no reset
 * effect, no stale filters from the last time it was used.
 */
export function QuestionPicker({
  open,
  ...rest
}: {
  open: boolean
  questions: BankQuestion[]
  onClose: () => void
  onInsert: (q: BankQuestion) => void
  onCreate: (seed: string) => void
}) {
  if (!open) return null
  return <PickerBody {...rest} />
}

function PickerBody({
  questions,
  onClose,
  onInsert,
  onCreate,
}: {
  questions: BankQuestion[]
  onClose: () => void
  onInsert: (q: BankQuestion) => void
  onCreate: (seed: string) => void
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [pathFilter, setPathFilter] = useState<string[]>([])
  const [diff, setDiff] = useState<number>(0)
  const [onlyStarred, setOnlyStarred] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Autofocus without an effect: focus once, on mount.
  const [ready] = useState(() => {
    requestAnimationFrame(() => document.getElementById('qp-search')?.focus())
    return true
  })
  void ready

  const results = useMemo(
    () =>
      questions.filter(
        (q) => matchesQuery(q, query, pathFilter) && (diff === 0 || q.difficulty === diff) && (!onlyStarred || q.starred),
      ),
    [questions, query, pathFilter, diff, onlyStarred],
  )

  // Keep the cursor inside the list as filters shrink it.
  const clamped = Math.min(cursor, Math.max(0, results.length - 1))
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${clamped}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [clamped, results.length])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(clamped + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(Math.max(0, clamped - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const q = results[clamped]
      if (q) onInsert(q)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[88] flex items-start justify-center p-3 sm:p-8"
      onKeyDown={onKeyDown}
    >
      <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-hairline bg-canvas shadow-pop">
        <div className="border-b border-hairline bg-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <Search className="size-4 shrink-0 text-ink-3" />
            <input
              id="qp-search"
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setCursor(0)
              }}
              placeholder="جست‌وجو در صورت سؤال، برچسب، منبع یا سال…   (مثال: کنکور:حرکت شناسی)"
              aria-label="جست‌وجوی سؤال"
              className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:font-normal placeholder:text-ink-3/70"
            />
            {query && (
              <IconButton icon={X} label="پاک کردن" size="sm" onClick={() => setQuery('')} />
            )}
            <kbd className="kbd shrink-0">Esc</kbd>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {pathFilter.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-2xs font-black text-brand" dir="auto">
                {pathFilter.join(TAG_SEP)}
                <button type="button" onClick={() => setPathFilter([])} aria-label="پاک کردن فیلتر مسیر">
                  <X className="size-3" />
                </button>
              </span>
            )}
            <Segmented
              size="sm"
              label="سختی"
              value={String(diff)}
              onChange={(v) => setDiff(Number(v) as Difficulty | 0)}
              options={[
                { value: '0', label: 'همه' },
                { value: '1', label: DIFFICULTY_LABEL[1] },
                { value: '2', label: DIFFICULTY_LABEL[2] },
                { value: '3', label: DIFFICULTY_LABEL[3] },
              ]}
            />
            <button
              type="button"
              onClick={() => setOnlyStarred((v) => !v)}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-2xs font-bold transition',
                onlyStarred ? 'border-brand bg-brand-soft text-brand' : 'border-hairline text-ink-3 hover:text-ink',
              )}
            >
              <Star className={cn('size-3', onlyStarred && 'fill-current')} />
              ستاره‌دار
            </button>
            <span className="ms-auto text-2xs font-bold text-ink-3">
              {toFaDigits(results.length)} نتیجه از {toFaDigits(questions.length)} سؤال
            </span>
          </div>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto scroll-thin p-3">
          {results.length === 0 && (
            <Empty
              icon={BookMarked}
              title="سؤالی با این نشانه پیدا نشد"
              body={
                query
                  ? 'شاید برچسب تازه‌ای لازم باشد. می‌توانید سؤال را همین‌جا بسازید و برچسب‌هایش را وارد کنید.'
                  : 'ابتدا چند سؤال به بانک اضافه کنید.'
              }
              action={
                <Button icon={Plus} variant="primary" size="sm" onClick={() => onCreate(query)}>
                  ساخت سؤال با «{query || 'بدون جست‌وجو'}»
                </Button>
              }
            />
          )}

          {results.map((q, i) => (
            <div key={q.id} data-idx={i}>
              <QuestionCard
                question={q}
                selected={i === clamped}
                onSelect={() => onInsert(q)}
                actions={
                  <span className="me-1 flex items-center gap-1 text-2xs font-black text-ink-3">
                    {i === clamped && <kbd className="kbd">↵</kbd>}
                  </span>
                }
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-hairline bg-surface px-4 py-2.5 text-2xs text-ink-3">
          <Filter className="size-3.5" />
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd>
            انتخاب
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">↵</kbd>
            درج در یادداشت
          </span>
          <Button icon={Plus} size="xs" variant="subtle" className="ms-auto" onClick={() => onCreate(query)}>
            سؤال تازه
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Tag tree
 * ------------------------------------------------------------------ */

export type TagNode = {
  name: string
  path: string[]
  count: number
  children: TagNode[]
}

export function buildTagTree(questions: BankQuestion[]): TagNode[] {
  const root: TagNode = { name: '', path: [], count: 0, children: [] }
  for (const q of questions) {
    root.count += 1
    let node = root
    q.tags.forEach((seg) => {
      let next = node.children.find((c) => c.name === seg)
      if (!next) {
        next = { name: seg, path: [...node.path, seg], count: 0, children: [] }
        node.children.push(next)
      }
      next.count += 1
      node = next
    })
  }
  const sort = (n: TagNode) => {
    n.children.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fa'))
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}

export function TagTree({
  questions,
  selected,
  onSelect,
}: {
  questions: BankQuestion[]
  selected: string[]
  onSelect: (path: string[]) => void
}) {
  const tree = useMemo(() => buildTagTree(questions), [questions])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const currentKey = selected.join(TAG_SEP)

  const render = (nodes: TagNode[], depth: number) =>
    nodes.map((n) => {
      const key = n.path.join(TAG_SEP)
      const isOpen = !collapsed.has(key)
      const isActive = currentKey === key
      return (
        <li key={key}>
          <div
            className={cn(
              'group flex items-center gap-1 rounded-lg py-1 pe-1 transition',
              isActive ? 'bg-brand-soft' : 'hover:bg-sunken',
            )}
            style={{ paddingInlineStart: `${depth * 12 + 4}px` }}
          >
            {n.children.length > 0 ? (
              <button
                type="button"
                aria-label={isOpen ? 'بستن شاخه' : 'باز کردن شاخه'}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })
                }
                className="flex size-4 shrink-0 items-center justify-center text-ink-3"
              >
                <span className={cn('transition-transform duration-150', isOpen && 'rotate-90')}>‹</span>
              </button>
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <button
              type="button"
              onClick={() => onSelect(isActive ? n.path.slice(0, -1) : n.path)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
            >
              <span className={cn('min-w-0 flex-1 truncate text-xs', isActive ? 'font-black text-brand' : 'font-bold text-ink-2')}>
                {n.name}
              </span>
              <span className={cn('shrink-0 rounded-full px-1.5 text-2xs font-bold tabular-nums', isActive ? 'bg-brand text-white' : 'bg-sunken text-ink-3')}>
                {toFaDigits(n.count)}
              </span>
            </button>
          </div>
          {isOpen && n.children.length > 0 && <ul>{render(n.children, depth + 1)}</ul>}
        </li>
      )
    })

  if (tree.length === 0) {
    return <p className="px-2 py-4 text-center text-2xs text-ink-3">هنوز برچسبی ثبت نشده</p>
  }

  return (
    <ul className="space-y-px">
      <li>
        <button
          type="button"
          onClick={() => onSelect([])}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-start text-xs transition',
            selected.length === 0 ? 'bg-brand-soft font-black text-brand' : 'font-bold text-ink-2 hover:bg-sunken',
          )}
        >
          <BookMarked className="size-3.5 shrink-0" />
          همهٔ سؤالات
          <span className="ms-auto rounded-full bg-sunken px-1.5 text-2xs font-bold tabular-nums text-ink-3">
            {toFaDigits(questions.length)}
          </span>
        </button>
      </li>
      {render(tree, 0)}
    </ul>
  )
}

export { faNum }
