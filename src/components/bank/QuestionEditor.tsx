import { useMemo, useState } from 'react'
import { Check, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { BankQuestion, Difficulty } from '../../types'
import { DIFFICULTY_LABEL, emptyQuestion } from '../../types'
import { cn, parseNum, toFaDigits } from '../../lib/utils'
import { Badge, Button, Field, IconButton, Input, Segmented, Textarea } from '../ui/primitives'
import { TagInput } from './TagInput'

const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']
const faNum = (n: number) => FA[n] ?? String(n)

export const MAX_OPTIONS = 8

export function QuestionEditor({
  initial,
  allQuestions,
  onSave,
  onCancel,
  compact,
}: {
  initial?: BankQuestion
  /** existing questions, used for tag-path autocomplete */
  allQuestions: BankQuestion[]
  onSave: (q: BankQuestion) => void
  onCancel: () => void
  compact?: boolean
}) {
  const [draft, setDraft] = useState<BankQuestion>(() => (initial ? structuredClone(initial) : emptyQuestion()))
  const [touched, setTouched] = useState(false)

  const suggestions = useMemo(
    () => [...new Set(allQuestions.flatMap((q) => q.tags.map((_, i) => q.tags.slice(0, i + 1).join(':'))))],
    [allQuestions],
  )

  const set = <K extends keyof BankQuestion>(key: K, value: BankQuestion[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const setOption = (i: number, text: string) =>
    setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? text : o)) }))

  const addOption = () =>
    setDraft((d) => (d.options.length >= MAX_OPTIONS ? d : { ...d, options: [...d.options, ''] }))

  const removeOption = (i: number) =>
    setDraft((d) => {
      const options = d.options.filter((_, j) => j !== i)
      const answerIndex = d.answerIndex === i ? 0 : d.answerIndex >= i ? d.answerIndex - 1 : d.answerIndex
      return { ...d, options, answerIndex: Math.max(0, Math.min(answerIndex, options.length - 1)) }
    })

  const filled = draft.options.filter((o) => o.trim())
  const stemError = touched && !draft.stem.trim() ? 'صورت سؤال لازم است' : undefined
  const canSave = draft.stem.trim().length > 0 && filled.length >= 2 && draft.answerIndex < draft.options.length

  const submit = () => {
    setTouched(true)
    if (!canSave) return
    const trimmed = trimOptions(draft.options, draft.answerIndex)
    onSave({
      ...draft,
      stem: draft.stem.trim(),
      // Drop blank options and keep the answer pointing at the right one.
      options: trimmed.options,
      answerIndex: trimmed.answerIndex,
      explanation: draft.explanation?.trim(),
      source: draft.source?.trim(),
      tags: draft.tags,
    })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Field
        label="صورت سؤال"
        htmlFor="q-stem"
        error={stemError}
        hint="از **پررنگ**، *مورب*، ==هایلایت== و $x = vt$ استفاده کنید."
        className={compact ? '' : 'max-w-none'}
      >
        <Textarea
          id="q-stem"
          data-autofocus
          rows={compact ? 3 : 4}
          value={draft.stem}
          onChange={(e) => set('stem', e.target.value)}
          placeholder="سیاره‌ای به شعاع $R$ دور خورشید با سرعت $v$ می‌چرخد. نیروی گرانشی وارد بر آن چیست؟"
          className="font-medium"
        />
      </Field>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-ink-2">گزینه‌ها</span>
          <span className="inline-flex items-center gap-1 text-2xs text-ink-3">
            <span className="size-2 rounded-full bg-ok" />
            جواب درست
          </span>
          {draft.options.length < MAX_OPTIONS && (
            <Button type="button" size="xs" variant="subtle" icon={Plus} onClick={addOption} className="ms-auto">
              گزینه
            </Button>
          )}
        </div>

        {draft.options.map((opt, i) => {
          const isAnswer = draft.answerIndex === i
          return (
            <div key={i} className={cn('flex items-center gap-1.5')}>
              <button
                type="button"
                role="radio"
                aria-checked={isAnswer}
                aria-label={`گزینهٔ ${i + 1} به‌عنوان جواب درست`}
                onClick={() => set('answerIndex', i)}
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-lg border-2 text-xs font-black transition',
                  isAnswer ? 'border-ok bg-ok/12 text-ok' : 'border-hairline text-ink-3 hover:border-ok/50',
                )}
              >
                {isAnswer ? <Check className="size-4" /> : faNum(i + 1)}
              </button>
              <Input
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`گزینهٔ ${toFaDigits(i + 1)}`}
                className={cn(isAnswer && 'border-ok/50 bg-ok/[0.04]')}
              />
              {draft.options.length > 2 && (
                <IconButton
                  icon={Trash2}
                  label={`حذف گزینهٔ ${toFaDigits(i + 1)}`}
                  size="sm"
                  variant="danger"
                  onClick={() => removeOption(i)}
                  className="shrink-0"
                />
              )}
            </div>
          )
        })}
        {filled.length < 2 && touched && (
          <p className="text-xs font-bold text-danger">دست‌کم دو گزینهٔ پرشده لازم است.</p>
        )}
      </div>

      <Field label="پاسخ تشریحی" htmlFor="q-expl" hint="پس از انتخاب کاربر نمایش داده می‌شود.">
        <Textarea
          id="q-expl"
          rows={2}
          value={draft.explanation ?? ''}
          onChange={(e) => set('explanation', e.target.value)}
          placeholder="چون نیروی گرانشی همیشه به سمت مرکز است، پیوسته جهت سرعت را تغییر می‌دهد ولی کار انجام نمی‌دهد."
        />
      </Field>

      <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'sm:grid-cols-2')}>
        <Field
          label="مسیر برچسب"
          hint="هویت سؤال: هر سطح را با «:» جدا کنید."
          className={compact ? '' : 'sm:col-span-2'}
        >
          <TagInput value={draft.tags} onChange={(tags) => set('tags', tags)} suggestions={suggestions} />
        </Field>

        <Field label="منبع" htmlFor="q-src">
          <Input
            id="q-src"
            value={draft.source ?? ''}
            onChange={(e) => set('source', e.target.value)}
            placeholder="کنکور ریاضی فیزیک ۱۴۰۲ — حرکت‌شناسی"
          />
        </Field>

        <Field label="سال" htmlFor="q-year">
          <Input
            id="q-year"
            inputMode="numeric"
            value={draft.year ? toFaDigits(draft.year) : ''}
            onChange={(e) => {
              const v = parseNum(e.target.value)
              set('year', Number.isFinite(v) && v > 0 ? Math.round(v) : undefined)
            }}
            placeholder="۱۴۰۲"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="سختی">
          <Segmented
            label="سختی"
            value={String(draft.difficulty ?? 2)}
            onChange={(v) => set('difficulty', Number(v) as Difficulty)}
            options={[
              { value: '1', label: DIFFICULTY_LABEL[1] },
              { value: '2', label: DIFFICULTY_LABEL[2] },
              { value: '3', label: DIFFICULTY_LABEL[3] },
            ]}
          />
        </Field>
        <Button
          type="button"
          variant={draft.starred ? 'primary' : 'outline'}
          icon={Sparkles}
          onClick={() => set('starred', !draft.starred)}
          size="md"
        >
          {draft.starred ? 'ستاره‌دار' : 'بدون ستاره'}
        </Button>
      </div>

      <div className="flex items-center gap-2 border-t border-hairline pt-3">
        {draft.tags.length === 0 && <Badge tone="brand">بدون برچسب — پیدا کردنش سخت می‌شود</Badge>}
        <Button type="button" variant="ghost" onClick={onCancel} className="ms-auto">
          انصراف
        </Button>
        <Button type="submit" variant="primary" icon={Check}>
          {initial ? 'ذخیرهٔ تغییرات' : 'افزودن به بانک'}
        </Button>
      </div>
    </form>
  )
}

/**
 * Removes blank options and reports where the correct answer ended up.
 * Also dedupes repeated option text so a duplicated choice can't shadow it.
 */
function trimOptions(options: string[], answerIndex: number): { options: string[]; answerIndex: number } {
  const answer = options[answerIndex]
  const seen = new Set<string>()
  const out: string[] = []
  let next = 0
  for (const raw of options) {
    const text = raw.trim()
    if (!text) continue
    const key = text.replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    if (out.length === answerIndex) next = out.length
    out.push(text)
  }
  if (!seen.has(answer.trim().replace(/\s+/g, ' '))) next = 0
  return { options: out.length >= 2 ? out : options, answerIndex: out.length >= 2 ? next : answerIndex }
}
