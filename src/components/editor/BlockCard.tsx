import { useState } from 'react'
import {
  BookMarked,
  ChevronDown,
  Columns2,
  Columns3,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  MoreHorizontal,
  RectangleHorizontal,
  Trash2,
} from 'lucide-react'
import type { BlockSpan, SlideStep, StepKind } from '../../types'
import { KIND_HINT, KIND_LABEL, SPAN_LABEL, SPAN_ORDER } from '../../types'
import { cn, toFaDigits } from '../../lib/utils'
import { BLOCK_KINDS, BLOCK_META, StepView } from '../blocks'
import { StepEditor } from './StepEditors'
import { Button, IconButton } from '../ui/primitives'
import { Menu, type MenuItem } from '../ui/overlay'
import { DragHandle, type SortableShell } from '../dnd/Sortable'

const SPAN_ICON = { full: RectangleHorizontal, half: Columns2, third: Columns3 } as const

/** How a block sits in the 6-column slide grid. */
export function spanClass(span: BlockSpan, layout: 'flow' | 'stack'): string {
  if (layout === 'stack') return 'col-span-6'
  if (span === 'half') return 'col-span-6 md:col-span-3'
  if (span === 'third') return 'col-span-3 md:col-span-2'
  return 'col-span-6'
}

export function BlockCard({
  step,
  index,
  total,
  drag,
  quizMeta,
  onChange,
  onDuplicate,
  onRemove,
  onMove,
  onSpan,
  onKind,
  onInsertQuestion,
  onReviewQuestion,
  onOpenStudio,
}: {
  step: SlideStep
  index: number
  total: number
  drag: SortableShell
  quizMeta?: { source?: string; tags?: string[] }
  onChange: (next: SlideStep) => void
  onDuplicate: () => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  onSpan: (span: BlockSpan) => void
  onKind: (kind: StepKind) => void
  onInsertQuestion: () => void
  onReviewQuestion?: () => void
  onOpenStudio?: () => void
}) {
  const [open, setOpen] = useState(true)
  const [showPreview, setShowPreview] = useState(false)
  const meta = BLOCK_META[step.kind]
  const Icon = meta.icon
  const isAnimation = step.kind === 'animation'

  const menu: MenuItem[] = [
    { type: 'label', key: 'l1', label: 'تبدیل به' },
    ...BLOCK_KINDS.map((k) => {
      const I = BLOCK_META[k].icon
      return {
        type: 'item' as const,
        key: k,
        label: KIND_LABEL[k],
        icon: <I className="size-4" />,
        onSelect: () => onKind(k),
      }
    }),
    { type: 'sep', key: 's1' },
    { type: 'item', key: 'dup', label: 'تکثیر کادر', icon: <Copy className="size-4" />, onSelect: onDuplicate },
    { type: 'item', key: 'up', label: 'یک پله بالا', hint: '⌥↑', disabled: index === 0, onSelect: () => onMove(-1) },
    { type: 'item', key: 'down', label: 'یک پله پایین', hint: '⌥↓', disabled: index === total - 1, onSelect: () => onMove(1) },
    { type: 'sep', key: 's2' },
    { type: 'item', key: 'del', label: 'حذف کادر', icon: <Trash2 className="size-4" />, danger: true, onSelect: onRemove },
  ]

  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border bg-surface transition-all duration-150',
        drag.isDragging ? 'border-brand shadow-lift' : 'border-hairline shadow-card hover:border-hairline-strong',
      )}
    >
      <header className="flex items-center gap-1.5 border-b border-hairline bg-sunken/50 px-2 py-1.5">
        <DragHandle
          listeners={drag.listeners}
          attributes={drag.attributes}
          setActivatorNodeRef={drag.setActivatorNodeRef}
          label={`کشیدن کادر ${KIND_LABEL[step.kind]}`}
          compact
        />

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 py-0.5 text-start transition hover:bg-surface"
        >
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-white"
            style={{ background: meta.accent }}
            aria-hidden
          >
            <Icon className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-black text-ink">{KIND_LABEL[step.kind]}</span>
          {step.kind === 'quiz' && step.bankId && (
            <BookMarked className="size-3 shrink-0 text-brand" aria-label="پیوند به بانک سؤال" />
          )}
          <span className="shrink-0 text-2xs tabular-nums text-ink-3">{toFaDigits(index + 1)}</span>
          <ChevronDown className={cn('size-3.5 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
        </button>

        <div
          className="hidden items-center gap-0.5 rounded-lg border border-hairline bg-surface p-0.5 sm:flex"
          role="group"
          aria-label="عرض کادر"
        >
          {SPAN_ORDER.map((s) => {
            const I = SPAN_ICON[s]
            return (
              <button
                key={s}
                type="button"
                aria-pressed={step.span === s}
                aria-label={`عرض: ${SPAN_LABEL[s]}`}
                title={SPAN_LABEL[s]}
                onClick={() => onSpan(s)}
                className={cn(
                  'rounded-md p-0.5 transition',
                  step.span === s ? 'bg-brand text-on-brand' : 'text-ink-3 hover:bg-sunken hover:text-ink',
                )}
              >
                <I className="size-3.5" />
              </button>
            )
          })}
        </div>

        <IconButton
          icon={showPreview ? EyeOff : Eye}
          label={showPreview ? 'بستن پیش‌نمایش' : 'پیش‌نمایش کادر'}
          size="sm"
          active={showPreview}
          onClick={() => setShowPreview((v) => !v)}
        />

        {isAnimation && onOpenStudio && (
          <IconButton icon={Gauge} label="باز کردن استودیوی انیمیشن" size="sm" onClick={onOpenStudio} />
        )}

        <Menu
          align="end"
          label={`گزینه‌های کادر ${toFaDigits(index + 1)}`}
          icon={MoreHorizontal}
          triggerSize="sm"
          items={menu}
        />
      </header>

      {open && (
        <div className="min-w-0 flex-1 space-y-2.5 p-3">
          {isAnimation ? (
            <AnimationStub title={step.anim.title} onOpen={onOpenStudio} />
          ) : (
            <StepEditor
              step={step}
              onChange={onChange}
              onInsertQuestion={onInsertQuestion}
              onReviewQuestion={onReviewQuestion}
            />
          )}

          {showPreview && !isAnimation && (
            <div className="rounded-xl border border-dashed border-hairline bg-sunken/40 p-3">
              <p className="mb-2 text-2xs font-black uppercase tracking-wide text-ink-3">پیش‌نمایش</p>
              <StepView step={step} quizMeta={quizMeta} />
            </div>
          )}
        </div>
      )}

      <footer className="flex items-center gap-1.5 border-t border-hairline px-2.5 py-1 text-2xs text-ink-3">
        <span className="truncate">{KIND_HINT[step.kind]}</span>
        <span className="ms-auto shrink-0 font-bold tabular-nums">{SPAN_LABEL[step.span]}</span>
      </footer>
    </article>
  )
}

function AnimationStub({ title, onOpen }: { title: string; onOpen?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-hairline bg-sunken/40 px-3 py-3">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
        <Gauge className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-black text-ink">{title}</p>
        <p className="text-2xs text-ink-3">کی‌فریم‌ها، نمودارها و بردارها در استودیو تنظیم می‌شوند</p>
      </div>
      <Button size="sm" variant="primary" icon={Gauge} onClick={onOpen}>
        باز کردن استودیو
      </Button>
    </div>
  )
}
