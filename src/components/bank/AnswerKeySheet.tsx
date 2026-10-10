import { useState } from 'react'
import { X } from 'lucide-react'
import type { AnswerKey } from '../../types'
import { cn, toFaDigits } from '../../lib/utils'
import { StepView } from '../blocks'
import { IconButton } from '../ui/primitives'


/**
 * The descriptive answer key, shown beside a question after the student has
 * answered.
 *
 * It is a slide, not a paragraph: prose, formulas, callouts, a diagram and a
 * live animation all render here, because the way a solution is *shown* is
 * most of what makes it teach.
 */
export function AnswerKeySheet({
  answerKey,
  question,
  onClose,
}: {
  answerKey: AnswerKey
  question?: string
  onClose: () => void
}) {
  const [open, setOpen] = useState(true)
  const steps = answerKey.steps ?? []

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/[0.04]">
      <div className="flex items-center gap-2 border-b border-fuchsia-500/15 px-3 py-2">
        <span className="text-2xs font-black text-fuchsia-700 dark:text-fuchsia-300">
          {answerKey.title ?? 'پاسخ‌نامهٔ تشریحی'}
        </span>
        {question && <span className="min-w-0 flex-1 truncate text-2xs text-ink-3">{question}</span>}
        <span className="shrink-0 text-2xs text-ink-3">{toFaDigits(steps.length)} کادر</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 rounded-lg px-2 py-1 text-2xs font-bold text-ink-3 transition hover:bg-sunken hover:text-ink"
        >
          {open ? 'بستن' : 'باز کردن'}
        </button>
        <IconButton icon={X} label="بستن" size="sm" onClick={onClose} />
      </div>
      {open && (
        <div className={cn('block-grid p-3')}>
          {steps.map((s) => (
            <div
              key={s.id}
              className={cn('min-w-0', s.span === 'full' ? 'col-span-6' : s.span === 'half' ? 'col-span-6 md:col-span-3' : 'col-span-3 md:col-span-2')}
            >
              <StepView step={s} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}