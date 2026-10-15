import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BookMarked,
  Braces,
  Download,
  FileJson,
  Keyboard,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react'
import type { BankQuestion, SlideStep } from '../types'
import { DIFFICULTIES, DIFFICULTY_LABEL, TAG_SEP, splitTags, uid } from '../types'
import { ingestBank, putPresentation, putQuestion, removeQuestion, usePresentations, useQuestions } from '../lib/store'
import { downloadJSON } from '../storage'
import { HELP_COMBOS, useHotkeys } from '../lib/hotkeys'
import { useNav } from '../lib/nav'
import { cn, toFaDigits } from '../lib/utils'
import { Button, Empty, IconButton, Input, Segmented } from '../components/ui/primitives'
import { Confirm, Menu, Modal, toast, type MenuItem } from '../components/ui/overlay'
import { ShortcutsSheet } from '../components/ui/ShortcutsSheet'
import { QuestionCard, TagTree, matchesQuery } from '../components/bank/QuestionPicker'
import { QuestionEditor } from '../components/bank/QuestionEditor'
import { seedQuestionBank } from '../sample'

export default function Bank() {
  const { go: navigate, params, setParam } = useNav()
  const questions = useQuestions()

  // `/bank?q=کنکور:حرکت شناسی` deep-links straight into a filtered view.
  const deepLink = params.get('q') ?? ''
  const [query, setQuery] = useState(deepLink)
  const [path, setPath] = useState<string[]>(() => (deepLink ? splitTags(deepLink) : []))
  const [diff, setDiff] = useState<number>(0)
  const [onlyStarred, setOnlyStarred] = useState(false)
  const [editing, setEditing] = useState<BankQuestion | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDel, setConfirmDel] = useState<BankQuestion | null>(null)
  const [help, setHelp] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState<BankQuestion | null>(null)

  // Consume the deep-link param so a refresh doesn't re-apply it over edits.
  useEffect(() => {
    if (!deepLink) return
    setParam('q', null)
  }, [deepLink, setParam])

  const results = useMemo(
    () =>
      questions
        .filter((q) => matchesQuery(q, query, path) && (diff === 0 || q.difficulty === diff) && (!onlyStarred || q.starred))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [questions, query, path, diff, onlyStarred],
  )

  const tagsUsed = useMemo(() => new Set(questions.flatMap((q) => q.tags)).size, [questions])

  const save = useCallback(
    (q: BankQuestion) => {
      putQuestion(q)
      setEditing(null)
      setCreating(false)
      toast(editing ? 'تغییرات ذخیره شد ✓' : 'به بانک اضافه شد ✓', 'ok', {
        detail: q.tags.length ? q.tags.join(TAG_SEP) : 'بدون برچسب',
      })
    },
    [editing],
  )

  useHotkeys(
    [
      { id: 'palette', combo: 'mod+k', label: 'جعبه‌فرمان', group: 'عمومی', priority: 10, run: () => navigate('/create') },
      { id: 'new', combo: 'mod+shift+n', label: 'سؤال تازه', group: 'بانک سؤال', run: () => setCreating(true) },
      { id: 'search', combo: '/', label: 'رفتن به جست‌وجو', group: 'بانک سؤال', run: () => document.getElementById('bank-search')?.focus() },
      { id: 'clear', combo: 'escape', label: 'پاک کردن فیلترها', group: 'بانک سؤال', hidden: true, run: () => {
        setQuery('')
        setPath([])
        setDiff(0)
        setOnlyStarred(false)
      } },
      ...HELP_COMBOS.map((combo) => ({
        id: `help-${combo}`,
        combo,
        label: 'کلیدهای میان‌بر',
        group: 'راهنما',
        run: () => setHelp(true),
      })),
      { id: 'back', combo: 'mod+arrowleft', label: 'بازگشت به استودیو', group: 'عمومی', run: () => navigate('/create') },
    ],
    [navigate],
  )

  const handleImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        const bank = await ingestBank(parsed)
        toast(`${toFaDigits(bank.questions.length)} سؤال وارد شد ✓`)
      } catch {
        toast('فایل بانک سؤال معتبر نیست', 'err')
      }
    }
    reader.readAsText(file)
  }

  const seed = () => {
    const fresh = seedQuestionBank()
    for (const q of fresh) putQuestion(q)
    toast(`${toFaDigits(fresh.length)} سؤال نمونه اضافه شد ✓`)
  }

  return (
    <div className="min-h-screen bg-canvas font-vazir text-ink">

      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b border-hairline bg-surface/92 px-3 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate('/create')}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-hairline px-2.5 text-xs font-bold text-ink-2 transition hover:bg-sunken hover:text-ink"
        >
          <ArrowRight className="size-3.5" />
          استودیو
        </button>
        <span className="flex size-8 items-center justify-center rounded-xl bg-brand text-on-brand">
          <BookMarked className="size-4" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-black text-ink">بانک سؤال</h1>
          <p className="text-2xs text-ink-3">
            {toFaDigits(questions.length)} سؤال · {toFaDigits(tagsUsed)} برچسب
          </p>
        </div>

        <div className="ms-auto flex items-center gap-1.5">
          <Button size="sm" variant="subtle" icon={Braces} onClick={() => navigate('/bank/import')}>
            ورود گروهی با پیش‌نمایش
          </Button>
          <IconButton icon={Download} label="خروجی JSON" size="sm" onClick={() => downloadJSON({ questions }, 'question-bank')} />
          <IconButton icon={Upload} label="ورودی JSON" size="sm" onClick={() => fileRef.current?.click()} />
          <IconButton icon={Keyboard} label="کلیدهای میان‌بر" size="sm" onClick={() => setHelp(true)} />
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            سؤال تازه
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleImport(f)
            e.target.value = ''
          }}
        />
      </header>

      <div className="grid gap-3 p-3 lg:grid-cols-[16rem_1fr]">
        {/* ---- tag tree ---- */}
        <aside className="surface h-fit rounded-2xl p-3 lg:sticky lg:top-16">
          <h2 className="mb-2 text-2xs font-black uppercase tracking-wide text-ink-3">درخت برچسب‌ها</h2>
          <div className="max-h-[60vh] overflow-y-auto scroll-thin pe-1">
            <TagTree questions={questions} selected={path} onSelect={(p) => { setPath(p); setQuery('') }} />
          </div>

          {path.length > 0 && (
            <div className="mt-2 rounded-xl bg-brand-soft px-2.5 py-1.5 text-2xs font-black text-brand" dir="auto">
              {path.join(TAG_SEP)}
            </div>
          )}

          {questions.length === 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-2xs leading-6 text-ink-3">بانک خالی است. سؤال نمونه بگذارید یا اولین سؤال را بسازید.</p>
              <Button size="xs" variant="subtle" icon={Wand2} block onClick={seed}>
                بانک نمونه
              </Button>
            </div>
          )}
        </aside>

        {/* ---- list ---- */}
        <main className="min-w-0 space-y-3">
          <div className="surface flex flex-wrap items-center gap-2 rounded-2xl p-2.5">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <Input
                id="bank-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جست‌وجو: صورت سؤال، برچسب، منبع یا سال…   (مثال: کنکور:حرکت شناسی)"
                aria-label="جست‌وجو در بانک سؤال"
                className="ps-8"
              />
            </div>
            <Segmented
              size="sm"
              label="سختی"
              value={String(diff)}
              onChange={(v) => setDiff(Number(v))}
              options={[
                { value: '0', label: 'همه' },
                ...DIFFICULTIES.map((d) => ({ value: String(d), label: `${toFaDigits(d)}· ${DIFFICULTY_LABEL[d]}` })),
              ]}
            />
            <button
              type="button"
              onClick={() => setOnlyStarred((v) => !v)}
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-2xs font-bold transition',
                onlyStarred ? 'border-brand bg-brand-soft text-brand' : 'border-hairline text-ink-3 hover:text-ink',
              )}
            >
              <Star className={cn('size-3', onlyStarred && 'fill-current')} />
              ستاره‌دار
            </button>
            {(query || path.length > 0 || diff !== 0 || onlyStarred) && (
              <IconButton
                icon={Trash2}
                label="پاک کردن فیلترها"
                size="sm"
                onClick={() => {
                  setQuery('')
                  setPath([])
                  setDiff(0)
                  setOnlyStarred(false)
                }}
              />
            )}
            <span className="ms-auto flex items-center gap-1.5 text-2xs font-bold text-ink-3">
              {toFaDigits(results.length)} نتیجه
            </span>
          </div>

          {results.length === 0 ? (
            <Empty
              icon={BookMarked}
              title="سؤالی با این فیلترها پیدا نشد"
              body="فیلترها را باز کنید یا سؤال تازه‌ای بسازید."
              action={
                <div className="flex gap-2">
                  <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                    سؤال تازه
                  </Button>
                  <Button variant="subtle" icon={Wand2} onClick={seed}>
                    بانک نمونه
                  </Button>
                </div>
              }
            />
          ) : (
            <ul className="space-y-2">
              {results.map((q) => (
                <li key={q.id} className="flex items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <QuestionCard
                      question={q}
                      onToggleStar={() => putQuestion({ ...q, starred: !q.starred })}
                      actions={
                        <Menu
                          align="end"
                          label={`ویرایش سؤال: ${q.stem.slice(0, 40)}`}
                          icon={Pencil}
                          triggerSize="sm"
                          items={
                            [
                              { type: 'item', key: 'edit', label: 'ویرایش', icon: <Pencil className="size-4" />, onSelect: () => setEditing(q) },
                              {
                                type: 'item',
                                key: 'copy',
                                label: 'کپی به ارائه…',
                                icon: <FileJson className="size-4" />,
                                onSelect: () => setTarget(q),
                              },
                              { type: 'sep', key: 's' },
                              { type: 'item', key: 'del', label: 'حذف', icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setConfirmDel(q) },
                            ] satisfies MenuItem[]
                          }
                        />
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>

      <Modal
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        title={editing ? 'ویرایش سؤال' : 'سؤال تازه'}
        size="lg"
      >
        <QuestionEditor
          allQuestions={questions}
          initial={editing ?? undefined}
          onSave={save}
          onCancel={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      </Modal>

      <Confirm
        open={confirmDel !== null}
        title="این سؤال حذف شود؟"
        body="کادرهایی که به این سؤال پیوند دارند، نسخهٔ ذخیره‌شدهٔ خودشان را نگه می‌دارند و همچنان کار می‌کنند." 
        onConfirm={() => {
          if (confirmDel) {
            removeQuestion(confirmDel.id)
            toast('حذف شد')
          }
          setConfirmDel(null)
        }}
        onCancel={() => setConfirmDel(null)}
      />

      <DeckPicker question={target} onClose={() => setTarget(null)} />
      <ShortcutsSheet open={help} onClose={() => setHelp(false)} />
    </div>
  )
}

/** Deck picker — "insert this question into a lesson". */
function DeckPicker({
  question,
  onClose,
}: {
  question: BankQuestion | null
  onClose: () => void
}) {
  const { go: navigate } = useNav()
  const decks = usePresentations()

  const insert = (id: string) => {
    const deck = decks.find((d) => d.id === id)
    if (!deck || !question) return
    putQuestion({ ...question, used: (question.used ?? 0) + 1 })
    const slides = deck.slides.length > 0 ? deck.slides : [{ id: uid('slide'), title: 'بخش ۱', steps: [], notes: '' }]
    const last = slides[slides.length - 1]
    const block: SlideStep = {
      id: uid('step'),
      span: 'full',
      kind: 'quiz',
      question: question.stem,
      options: [...question.options],
      answerIndex: question.answerIndex,
      explanation: question.explanation,
      bankId: question.id,
    }
    const next = {
      ...deck,
      slides: slides.map((s, i) => (i === slides.length - 1 ? { ...s, steps: [...s.steps, block] } : s)),
    }
    putPresentation(next)
    onClose()
    toast('سؤال در ارائه درج شد ✓', 'ok', { detail: last.title })
    navigate(`/create?slide=${last.id}`)
  }

  return (
    <Modal open={question !== null} onClose={onClose} title="درج در کدام ارائه؟" size="md">
      {decks.length === 0 ? (
        <Empty
          icon={FileJson}
          title="هنوز ارائه‌ای ندارید"
          body="اول در استودیو یک ارائه بسازید، بعد سؤال را در آن درج کنید."
          action={
            <Button
              variant="primary"
              onClick={() => {
                onClose()
                navigate('/create')
              }}
            >
              رفتن به استودیو
            </Button>
          }
        />
      ) : (
        <ul className="space-y-1.5">
          {decks.map((d) => {
            const blocks = d.slides.reduce((a, s) => a + s.steps.length, 0)
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => insert(d.id)}
                  className="flex w-full items-center gap-2 rounded-xl border border-hairline bg-surface px-3 py-2 text-start transition hover:border-brand/60 hover:bg-soft"
                >
                  <FileJson className="size-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate text-xs font-black text-ink">{d.title || 'بدون عنوان'}</span>
                  <span className="shrink-0 text-2xs text-ink-3">
                    {toFaDigits(d.slides.length)} بخش · {toFaDigits(blocks)} کادر
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
