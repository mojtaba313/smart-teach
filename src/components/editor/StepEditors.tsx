import { BookMarked, Link2, Plus, X } from 'lucide-react'
import type { CalloutTone, ListStep, QuizStep, SlideStep } from '../../types'
import { CALLOUT_TONE_LABEL } from '../../types'
import { cn, toFaDigits } from '../../lib/utils'
import { Button, IconButton, Input, Segmented, Textarea } from '../ui/primitives'
import { StepView } from '../blocks'
import { RichText } from '../blocks/RichText'

const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']

export type EditorProps = {
  step: SlideStep
  onChange: (next: SlideStep) => void
  onInsertQuestion: () => void
  onReviewQuestion?: () => void
}

/* ------------------------------------------------------------------ *
 *  Text / callout / trap
 * ------------------------------------------------------------------ */

function TextLike({
  value,
  onChange,
  rows = 4,
  placeholder,
  focusKey,
  preview = true,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
  focusKey?: string
  preview?: boolean
}) {
  return (
    <div className="space-y-2">
      <Textarea
        key={focusKey}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        dir="auto"
        className="resize-y"
      />
      {preview && value.trim() && (
        <div className="rounded-xl border border-hairline bg-sunken/50 px-3 py-2 text-sm leading-7 text-ink-2">
          <RichText value={value} />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  List
 * ------------------------------------------------------------------ */

function ListEditor({ step, onChange }: { step: ListStep; onChange: (n: ListStep) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Segmented
          size="sm"
          label="نوع فهرست"
          value={step.ordered ? 'ol' : 'ul'}
          onChange={(v) => onChange({ ...step, ordered: v === 'ol' })}
          options={[
            { value: 'ul', label: 'نقطه‌ای' },
            { value: 'ol', label: 'شماره‌دار' },
          ]}
        />
        <Button
          size="xs"
          variant="subtle"
          icon={Plus}
          className="ms-auto"
          onClick={() => onChange({ ...step, items: [...step.items, ''] })}
        >
          آیتم
        </Button>
      </div>
      {step.items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center text-2xs font-black',
              step.ordered ? 'rounded-md bg-brand-soft text-brand' : 'rounded-full bg-sunken text-ink-3',
            )}
          >
            {step.ordered ? FA[i + 1] : '•'}
          </span>
          <Input
            value={item}
            onChange={(e) => onChange({ ...step, items: step.items.map((x, j) => (j === i ? e.target.value : x)) })}
            placeholder={`آیتم ${toFaDigits(i + 1)}`}
            dir="auto"
          />
          <IconButton
            icon={X}
            label={`حذف آیتم ${toFaDigits(i + 1)}`}
            size="sm"
            variant="danger"
            disabled={step.items.length <= 1}
            onClick={() => onChange({ ...step, items: step.items.filter((_, j) => j !== i) })}
          />
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Quiz — hand-written or mirrored from the bank
 * ------------------------------------------------------------------ */

function QuizEditor({
  step,
  onChange,
  onInsertQuestion,
  onReviewQuestion,
}: {
  step: QuizStep
  onChange: (n: QuizStep) => void
  onInsertQuestion: () => void
  onReviewQuestion?: () => void
}) {
  const setOption = (i: number, text: string) =>
    onChange({ ...step, options: step.options.map((o, j) => (j === i ? text : o)) })

  return (
    <div className="space-y-2.5">
      {step.bankId && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand-soft/50 px-3 py-2">
          <Link2 className="size-3.5 text-brand" />
          <span className="text-2xs font-black text-brand">پیوند به بانک سؤال</span>
          <Button size="xs" variant="subtle" className="ms-auto" onClick={onReviewQuestion}>
            نمایش در بانک
          </Button>
          <Button
            size="xs"
            variant="ghost"
            icon={X}
            onClick={() => onChange({ ...step, bankId: undefined })}
          >
            حذف پیوند
          </Button>
        </div>
      )}

      <Textarea
        rows={3}
        value={step.question}
        onChange={(e) => onChange({ ...step, question: e.target.value })}
        placeholder="صورت سؤال…  (پررنگ **مهم**، فرمول $v = a t$)"
        dir="auto"
      />

      <div className="space-y-1.5">
        {step.options.map((opt, i) => {
          const isAnswer = step.answerIndex === i
          return (
            <div key={i} className="flex items-center gap-1.5">
              <button
                type="button"
                role="radio"
                aria-checked={isAnswer}
                aria-label={`گزینهٔ ${toFaDigits(i + 1)} به‌عنوان جواب درست`}
                onClick={() => onChange({ ...step, answerIndex: i })}
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-lg border-2 text-2xs font-black transition',
                  isAnswer ? 'border-ok bg-ok/12 text-ok' : 'border-hairline text-ink-3 hover:border-ok/50',
                )}
              >
                {FA[i + 1] ?? i + 1}
              </button>
              <Input
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`گزینهٔ ${toFaDigits(i + 1)}`}
                dir="auto"
                className={cn(isAnswer && 'border-ok/50 bg-ok/[0.04]')}
              />
              {step.options.length > 2 && (
                <IconButton
                  icon={X}
                  label={`حذف گزینهٔ ${toFaDigits(i + 1)}`}
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    onChange({
                      ...step,
                      options: step.options.filter((_, j) => j !== i),
                      answerIndex: step.answerIndex === i ? 0 : step.answerIndex > i ? step.answerIndex - 1 : step.answerIndex,
                    })
                  }
                />
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {step.options.length < 8 && (
          <Button size="xs" variant="subtle" icon={Plus} onClick={() => onChange({ ...step, options: [...step.options, ''] })}>
            گزینه
          </Button>
        )}
        <Button size="xs" variant="outline" icon={BookMarked} onClick={onInsertQuestion}>
          از بانک سؤال
        </Button>
        <span className="ms-auto text-2xs text-ink-3">دایرهٔ سبز = جواب درست</span>
      </div>

      <Textarea
        rows={2}
        value={step.explanation ?? ''}
        onChange={(e) => onChange({ ...step, explanation: e.target.value })}
        placeholder="پاسخ تشریحی (اختیاری) — پس از انتخاب کاربر نشان داده می‌شود."
        dir="auto"
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Dispatcher
 * ------------------------------------------------------------------ */

export function StepEditor(props: EditorProps) {
  const { onChange } = props
  const step = props.step

  switch (step.kind) {
    case 'list':
      return <ListEditor step={step} onChange={onChange} />

    case 'quiz':
      return (
        <QuizEditor
          step={step}
          onChange={onChange}
          onInsertQuestion={props.onInsertQuestion}
          onReviewQuestion={props.onReviewQuestion}
        />
      )

    case 'text':
      return (
        <TextLike
          value={step.value}
          onChange={(v) => onChange({ ...step, value: v })}
          placeholder="متن بنویسید…  **پررنگ** · *مورب* · ==هایلایت== · $x = vt$"
          rows={4}
        />
      )

    case 'trap':
      return (
        <TextLike
          value={step.value}
          onChange={(v) => onChange({ ...step, value: v })}
          placeholder="دام رایج: مثلاً «شتاب را با سرعت اشتباه نگیرید»."
          rows={3}
        />
      )

    case 'callout':
      return (
        <div className="space-y-2">
          <Segmented
            size="sm"
            label="لحن کادر"
            value={step.tone}
            onChange={(v) => onChange({ ...step, tone: v as CalloutTone })}
            options={(Object.keys(CALLOUT_TONE_LABEL) as CalloutTone[]).map((t) => ({
              value: t,
              label: CALLOUT_TONE_LABEL[t],
            }))}
          />
          <TextLike
            value={step.value}
            onChange={(v) => onChange({ ...step, value: v })}
            placeholder="محتوای کادر…"
            rows={3}
          />
        </div>
      )

    case 'formula':
      return (
        <div className="grid gap-2 md:grid-cols-2">
          <Textarea
            dir="ltr"
            rows={2}
            spellCheck={false}
            value={step.value}
            onChange={(e) => onChange({ ...step, value: e.target.value })}
            placeholder={'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}'}
            className="resize-y font-mono text-xs"
          />
          <div className="min-w-0 overflow-hidden rounded-xl border border-hairline bg-accent-soft/50 px-3 py-2">
            {step.value.trim() ? (
              <StepView step={step} />
            ) : (
              <p className="text-center text-2xs text-ink-3">پیش‌نمایش زندهٔ فرمول</p>
            )}
          </div>
        </div>
      )

    case 'image':
      return (
        <div className="space-y-2">
          <Input
            dir="ltr"
            value={step.value}
            onChange={(e) => onChange({ ...step, value: e.target.value })}
            placeholder="https://… آدرس تصویر"
            className="text-start"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={step.alt ?? ''} onChange={(e) => onChange({ ...step, alt: e.target.value })} placeholder="متن جایگزین (برای صفحه‌خوان)" />
            <Input
              value={step.caption ?? ''}
              onChange={(e) => onChange({ ...step, caption: e.target.value })}
              placeholder="زیرنویس تصویر (اختیاری)"
              dir="auto"
            />
          </div>
          {step.value.trim() && (
            <div className="overflow-hidden rounded-xl border border-hairline">
              <StepView step={step} />
            </div>
          )}
        </div>
      )

    case 'video':
      return (
        <div className="space-y-2">
          <Input
            dir="ltr"
            value={step.value}
            onChange={(e) => onChange({ ...step, value: e.target.value })}
            placeholder="لینک یوتیوب، آپارات یا فایل mp4"
            className="text-start"
          />
          <Input
            value={step.caption ?? ''}
            onChange={(e) => onChange({ ...step, caption: e.target.value })}
            placeholder="توضیح زیر ویدیو (اختیاری)"
            dir="auto"
          />
          {step.value.trim() && (
            <div className="overflow-hidden rounded-xl border border-hairline">
              <StepView step={step} />
            </div>
          )}
        </div>
      )

    case 'code':
      return (
        <Textarea
          dir="ltr"
          rows={5}
          spellCheck={false}
          value={step.value}
          onChange={(e) => onChange({ ...step, value: e.target.value })}
          placeholder={'v = a * t\nprint(v)'}
          className="resize-y border-slate-800 bg-slate-950 font-mono text-xs text-emerald-100 focus:border-emerald-500"
        />
      )

    case 'animation':
      return null // handled entirely by the studio route
  }
}
