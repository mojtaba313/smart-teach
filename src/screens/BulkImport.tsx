import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useNav } from '../lib/nav'
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardPaste, Database, Pencil, Plus, XCircle } from 'lucide-react'
import type { AnswerKey, BankQuestion, SlideStep } from '../types'
import { DIFFICULTIES, DIFFICULTY_HINT, DIFFICULTY_LABEL, KIND_LABEL, emptyQuestion, uid } from '../types'
import { migrateQuestion } from '../storage'
import { useQuestions } from '../lib/store'
import { api, useSyncState } from '../lib/sync'
import { cn, toFaDigits } from '../lib/utils'
import { StepView } from '../components/blocks'
import { Badge, Button, Empty, Input, Textarea } from '../components/ui/primitives'
import { Modal, toast } from '../components/ui/overlay'
import { QuestionEditor } from '../components/bank/QuestionEditor'
import { BlockEditor } from '../components/editor/BlockEditor'

/**
 * Bulk JSON entry for the question bank.
 *
 * The point is to never type a question twice: paste what you already have —
 * from a chatbot, a Word table, an older app, an export of this very bank —
 * and fix it here. Nothing is saved until you press save, so a bad paste costs
 * nothing.
 */

type Draft = {
  /** line index in the pasted text, for error reporting */
  index: number
  question: BankQuestion | null
  error: string | null
  /** the raw object as written, so saving keeps fields we do not model */
  raw: string
}

const SAMPLE = `[
  {
    "stem": "در لحظه‌ای که $\\\\Delta t = ۰٫۲$ ثانیه است، شیب قاطع نمودار مکان-زمان $۳$ متر بر ثانیه و شیب مماس $۳٫۱$ متر بر ثانیه است. سرعت متوسط روی این بازه کدام است؟",
    "options": ["$۳$", "$۳٫۱$", "$۰٫۱$", "$۶$"],
    "answerIndex": 0,
    "difficulty": 3,
    "tags": ["کنکور", "حرکت‌شناسی", "سرعت متوسط"],
    "source": "کتاب درسی",
    "year": 1404,
    "explanation": "سرعت متوسط، شیبِ قاطع است — نه شیب مماس.",
    "answerKey": {
      "title": "راه‌حل",
      "steps": [
        { "kind": "text", "span": "full", "value": "سرعت متوسط روی بازهٔ $\\\\Delta t$ برابر **شیب قاطع** است." },
        { "kind": "formula", "span": "half", "value": "v_{avg} = \\\\frac{\\\\Delta x}{\\\\Delta t}" },
        { "kind": "callout", "span": "half", "tone": "warn", "value": "شیب مماس ($۳٫۱$) سرعت **لحظه‌ای** است، نه متوسط." }
      ]
    }
  }
]`

export default function BulkImport() {
  const questions = useQuestions()
  const sync = useSyncState()
  const { go: navigate } = useNav()
  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [editing, setEditing] = useState(false)
  const boxRef = useRef<HTMLTextAreaElement>(null)

  const parse = useCallback((raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      setDrafts([])
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (e) {
      setDrafts([{ index: 0, question: null, error: `JSON خوانده نشد: ${(e as Error).message}`, raw: trimmed }])
      return
    }
    const list = normaliseList(parsed)
    setDrafts(
      list.map((item, index) => {
        const q = migrateQuestion(item)
        if (!q) {
          return { index, question: null, error: 'صورت سؤال خالی است یا ساختار درست نیست', raw: JSON.stringify(item, null, 1) }
        }
        return { index, question: q, error: null, raw: JSON.stringify(item, null, 1) }
      }),
    )
    setSelected(0)
  }, [])

  // Parse as you type, but only once the JSON is plausibly complete.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!text.trim()) {
        setDrafts(null)
        return
      }
      parse(text)
    }, 350)
    return () => clearTimeout(t)
  }, [text, parse])

  const valid = useMemo(() => drafts?.filter((d) => d.question) ?? [], [drafts])
  const broken = useMemo(() => drafts?.filter((d) => !d.question) ?? [], [drafts])
  const existing = useMemo(() => new Set(questions.map((q) => q.id)), [questions])
  const withKey = valid.filter((d) => (d.question?.answerKey?.steps.length ?? 0) > 0).length

  const current = drafts?.[selected]?.question ?? null
  const patchSelected = (patch: Partial<BankQuestion>) => {
    setDrafts((prev) =>
      (prev ?? []).map((d, i) => (i === selected && d.question ? { ...d, question: { ...d.question, ...patch } } : d)),
    )
  }

  const save = async () => {
    if (valid.length === 0) return
    const payload = valid.map((d) => d.question).filter((q): q is BankQuestion => !!q)
    try {
      await api.saveQuestions(payload)
    } catch {
      toast('پایگاه داده در دسترس نیست — تغییرات فقط در همین مرورگر ذخیره شد', 'err')
    }
    // Local cache first, so the bank list updates even when the API is down.
    for (const q of payload) if (!existing.has(q.id)) upsertLocal(q)
    toast(`${toFaDigits(payload.length)} سؤال ذخیره شد ✓`, 'ok', { detail: withKey ? `${toFaDigits(withKey)} پاسخ‌نامه دارد` : undefined })
    navigate('/bank')
  }

  return (
    <div className="min-h-screen bg-canvas font-vazir text-ink">
      <Modal open={editing && !!current} onClose={() => setEditing(false)} size="lg" title="ویرایش سؤال">
        {current && (
          <QuestionEditor
            initial={current}
            allQuestions={questions}
            onSave={(q) => {
              patchSelected(q)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        )}
      </Modal>
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-hairline bg-surface/90 px-4 py-2.5 backdrop-blur">
        <Link href="/bank" className="inline-flex size-8 items-center justify-center rounded-xl text-ink-3 hover:bg-sunken hover:text-ink" aria-label="بازگشت به بانک سؤال">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-sm font-black">ورود گروهی سؤال — JSON</h1>
        <Badge tone={sync === 'online' ? 'ok' : sync === 'offline' ? 'danger' : 'accent'}>
          <Database className="size-3" />
          {sync === 'online' ? 'پایگاه داده' : sync === 'offline' ? 'آفلاین — فقط مرورگر' : 'در حال اتصال…'}
        </Badge>
        <span className="ms-auto flex items-center gap-2">
          {drafts && (
            <>
              <Badge tone={valid.length ? 'ok' : 'neutral'}>{toFaDigits(valid.length)} معتبر</Badge>
              {broken.length > 0 && <Badge tone="danger">{toFaDigits(broken.length)} رد شد</Badge>}
              {withKey > 0 && <Badge tone="brand">{toFaDigits(withKey)} پاسخ‌نامه</Badge>}
            </>
          )}
          <Button size="sm" variant="primary" icon={CheckCircle2} disabled={valid.length === 0} onClick={save}>
            ذخیره در بانک
          </Button>
        </span>
      </header>

      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* ---- paste ---- */}
        <section className="flex min-h-0 flex-col gap-2">
          <div className="surface flex items-center gap-2 rounded-2xl px-3 py-2">
            <ClipboardPaste className="size-3.5 text-ink-3" />
            <span className="text-2xs font-bold text-ink-2">JSON را اینجا بچسبانید</span>
            <Button size="xs" variant="subtle" className="ms-auto" onClick={() => setText(SAMPLE)}>
              نمونه
            </Button>
            <Button size="xs" variant="subtle" onClick={() => setText('')}>
              پاک کردن
            </Button>
          </div>
          <Textarea
            ref={boxRef as never}
            value={text}
            onChange={(e) => setText(e.target.value)}
            dir="ltr"
            spellCheck={false}
            placeholder='[{"stem": "…", "options": ["…"], "answerIndex": 0, "difficulty": 3, "answerKey": { "steps": [...] } }]'
            aria-label="JSON سؤال‌ها"
            className="min-h-[22rem] flex-1 font-mono text-[12px] leading-5"
          />
          {drafts && drafts.length > 0 && (
            <div className="surface max-h-56 space-y-1 overflow-y-auto scroll-thin rounded-2xl p-2">
              {drafts.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(i)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-xl border px-2.5 py-1.5 text-start transition',
                    i === selected ? 'border-brand/60 bg-brand-soft/50' : 'border-transparent hover:bg-sunken',
                  )}
                >
                  {d.question ? (
                    d.question.id && existing.has(d.question.id) ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-warn" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" />
                    )
                  ) : (
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-ink">
                      {d.question ? d.question.stem.replace(/\$[^$]*\$/g, '').slice(0, 70) : d.error}
                    </span>
                    {d.question && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-ink-3">
                        {DIFFICULTY_LABEL[d.question.difficulty ?? 3]}
                        {d.question.tags.length > 0 && <span>· {d.question.tags.join(' › ')}</span>}
                        {d.question.answerKey?.steps.length ? <span className="text-brand">· پاسخ‌نامه</span> : null}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-3">{toFaDigits(i + 1)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ---- preview + edit ---- */}
        <section className="min-w-0 space-y-3">
          {!drafts && <Empty title="هنوز چیزی نچسبانده‌اید" body="یک آرایهٔ JSON از سؤال‌ها بچسبانید؛ پیش از ذخیره می‌توانید هر کدام را اصلاح کنید." icon={ClipboardPaste} />}
          {drafts && !current && (
            <Empty
              icon={AlertTriangle}
              title="هیچ سؤال معتبری پیدا نشد"
              body="JSON از نظر ساختار درست است ولی هیچ صورت سؤالی ندارد."
            />
          )}
          {current && (
            <>
              <div className="surface rounded-2xl p-3">
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-xs font-black">پیش‌نمایش و ویرایش</h2>
                  <span className="text-2xs text-ink-3">{toFaDigits(selected + 1)} از {toFaDigits(drafts?.length ?? 0)}</span>
                  {current.id && existing.has(current.id) && <Badge tone="accent">در بانک هست — ذخیره آن را به‌روز می‌کند</Badge>}
                  <span className="ms-auto flex items-center gap-1.5">
                    <Button size="xs" variant="primary" icon={Pencil} onClick={() => setEditing(true)}>
                      ویرایش متن و گزینه‌ها
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      icon={Plus}
                      onClick={() => setDrafts((prev) => [...(prev ?? []), { index: prev?.length ?? 0, question: emptyQuestion(), error: null, raw: '' }])}
                    >
                      سؤال تازه
                    </Button>
                  </span>
                </div>
                <QuestionCard question={current} />
              </div>

              <AnswerKeyEditor answerKey={current.answerKey} onChange={(ak) => patchSelected({ answerKey: ak })} />
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/** Read-only rendering of one question, exactly as the bank shows it. */
function QuestionCard({ question }: { question: BankQuestion }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {question.tags.map((t) => (
          <Badge key={t}>{t}</Badge>
        ))}
        <Badge tone={(question.difficulty ?? 3) >= 4 ? 'danger' : (question.difficulty ?? 3) <= 2 ? 'ok' : 'neutral'}>
          {DIFFICULTY_LABEL[question.difficulty ?? 3]}
        </Badge>
        {question.source && <Badge>{question.source}</Badge>}
        {question.year ? <Badge>{toFaDigits(question.year)}</Badge> : null}
      </div>
      <StepView
        step={{
          id: question.id,
          kind: 'quiz',
          span: 'full',
          question: question.stem,
          options: question.options,
          answerIndex: question.answerIndex,
          explanation: question.explanation,
          questionBlocks: question.questionBlocks,
          optionBlocks: question.optionBlocks,
        }}
        quizMeta={{ source: question.source, tags: question.tags }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Answer key
 * ------------------------------------------------------------------ */

/**
 * The answer key is a slide, so it can hold anything a slide can hold —
 * including an animation. Steps are edited as JSON here and rendered right
 * below with the real block components, so what you see is what a student
 * would get.
 */
function AnswerKeyEditor({
  answerKey,
  onChange,
}: {
  answerKey: AnswerKey | undefined
  onChange: (next: AnswerKey | undefined) => void
}) {
  const steps = answerKey?.steps ?? []
  const [raw, setRaw] = useState(() => JSON.stringify(answerKey?.steps ?? [], null, 1))
  const [showJson, setShowJson] = useState(false)
  const jsonError = useMemo(() => {
    if (!showJson) return null
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return 'باید آرایه باشد'
      return null
    } catch (e) {
      return (e as Error).message
    }
  }, [raw, showJson])

  const commitJson = () => {
    try {
      const parsed = JSON.parse(raw)
      const normalised = parsed.map((s: Record<string, unknown>) => ({ id: s.id ?? uid('ak'), ...s })) as SlideStep[]
      onChange({ ...answerKey, steps: normalised })
      toast('پاسخ‌نامه به‌روز شد ✓')
    } catch (e) {
      toast(`JSON نامعتبر: ${(e as Error).message}`, 'err')
    }
  }

  return (
    <div className="surface rounded-2xl p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-black">پاسخ‌نامهٔ تشریحی</h2>
        <Badge tone={steps.length ? 'brand' : 'neutral'}>{toFaDigits(steps.length)} کادر</Badge>
        {steps.length > 0 && (
          <span className="flex flex-wrap gap-1 text-[10px] text-ink-3">
            {[...new Set(steps.map((s) => KIND_LABEL[s.kind]))].map((k) => (
              <span key={k} className="rounded-md bg-sunken px-1.5 py-0.5">{k}</span>
            ))}
          </span>
        )}
        <span className="ms-auto flex items-center gap-1.5">
          {answerKey && (
            <Button size="xs" variant={showJson ? 'primary' : 'subtle'} onClick={() => setShowJson((v) => !v)}>
              {showJson ? 'بازگشت به ویرایش کادرها' : 'ویرایش JSON'}
            </Button>
          )}
          <Button size="xs" variant={answerKey ? 'subtle' : 'primary'} onClick={() => (answerKey ? onChange(undefined) : onChange({ title: 'راه‌حل', steps: [] }))}>
            {answerKey ? 'حذف پاسخ‌نامه' : 'افزودن پاسخ‌نامه'}
          </Button>
        </span>
      </div>

      {answerKey && (
        <Input
          value={answerKey.title ?? ''}
          onChange={(e) => onChange({ ...answerKey, title: e.target.value })}
          placeholder="عنوان پاسخ‌نامه"
          className="mb-2 h-8 text-xs"
          aria-label="عنوان پاسخ‌نامه"
        />
      )}

      {!answerKey ? (
        <p className="rounded-xl border border-dashed border-hairline px-3 py-6 text-center text-2xs text-ink-3">
          بدون پاسخ‌نامه. می‌توانید پاسخ را فقط در `explanation` بنویسید، یا یک اسلاید کامل بسازید.
        </p>
      ) : showJson ? (
        <div className="space-y-1.5 rounded-xl border border-hairline bg-sunken/60 p-2">
          <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} dir="ltr" spellCheck={false} aria-label="JSON کادرهای پاسخ‌نامه" className="min-h-[12rem] font-mono text-[11px] leading-5" />
          {jsonError && <p className="text-2xs font-bold text-danger">{jsonError}</p>}
          <Button size="xs" variant="primary" icon={CheckCircle2} disabled={!!jsonError} onClick={commitJson}>
            اعمال تغییرات
          </Button>
        </div>
      ) : (
        <>
          {/* The real editor: every block kind, animation included. */}
          <BlockEditor
            blocks={steps}
            onChange={(next) => onChange({ ...answerKey, steps: next })}
            addLabel="افزودن گام به پاسخ‌نامه"
            emptyHint="پاسخ‌نامه هنوز خالی است. گام‌ها را یکی‌یکی بسازید: توضیح، فرمول، نمودار، حتی انیمیشن."
          />
          {steps.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-2xs font-black text-ink-3">آنچه دانش‌آموز می‌بیند</p>
              <div className="block-grid">
                {steps.map((s) => (
                  <div key={s.id} className={cn('min-w-0', s.span === 'full' ? 'col-span-6' : s.span === 'half' ? 'col-span-6 md:col-span-3' : 'col-span-3 md:col-span-2')}>
                    <StepView step={s} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

/** Accept a question, an array, `{questions: […]}` or pasted bank text. */
function normaliseList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown[] }).questions)) {
    return (parsed as { questions: unknown[] }).questions
  }
  return [parsed]
}

/** Local cache write so the bank list updates even if the API is unreachable. */
function upsertLocal(q: BankQuestion) {
  try {
    const key = 'smart-teach:question-bank:v1'
    const raw = JSON.parse(localStorage.getItem(key) ?? '{"schema":1,"questions":[]}')
    const list: BankQuestion[] = raw.questions ?? []
    const i = list.findIndex((x) => x.id === q.id)
    if (i >= 0) list[i] = q
    else list.unshift(q)
    localStorage.setItem(key, JSON.stringify({ ...raw, questions: list, updatedAt: Date.now() }))
  } catch {
    /* cache write is best-effort */
  }
}

export { DIFFICULTIES, DIFFICULTY_HINT }