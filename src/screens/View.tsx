import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  Grid3x3,
  Keyboard,
  Link2,
  Maximize,
  Minimize,
  Moon,
  Pencil,
  Printer,
  RotateCcw,
  StickyNote,
  Sun,
  Timer,
} from 'lucide-react'
import type { Presentation, SlideStep } from '../types'
import { KIND_ACCENT, KIND_LABEL, SPAN_LABEL } from '../types'
import { clearProgress, loadProgress, saveProgress } from '../storage'
import { usePresentations, useQuestions } from '../lib/store'
import { HELP_COMBOS, registerHotkeys, useHotkeys } from '../lib/hotkeys'
import { clamp, cn, fmtClock, parseNum, toFaDigits } from '../lib/utils'
import { spanClass } from '../lib/span'
import { useNav } from '../lib/nav'
import { useMounted } from '../lib/useInView'
import { StepView } from '../components/blocks'
import { AnswerKeySheet } from '../components/bank/AnswerKeySheet'
import { Badge, Button, IconButton } from '../components/ui/primitives'
import { toast } from '../components/ui/overlay'
import { ShortcutsSheet } from '../components/ui/ShortcutsSheet'

/* ------------------------------------------------------------------ *
 *  Flattening: one integer index per reveal event
 * ------------------------------------------------------------------ */

/**
 * Flatten slides into a single reveal timeline: every section header and
 * every block occupies one integer, so "next" is just `+1`.
 */
function buildFlat(slides: Presentation['slides']) {
  const sectionStart: number[] = []
  const blocks: { step: SlideStep; global: number; index: number }[][] = []
  let g = 0
  slides.forEach((s) => {
    sectionStart.push(g)
    g += 1
    blocks.push(
      s.steps.map((step, index) => {
        const cur = g
        g += 1
        return { step, global: cur, index }
      }),
    )
  })
  return { sectionStart, blocks, total: g }
}

export default function View() {
  const route = useParams<{ id: string }>()
  const id = route?.id ?? ''
  const { go: navigate, params } = useNav()
  const questions = useQuestions()

  const library = usePresentations()
  const pres = useMemo(() => (id ? library.find((p) => p.id === id) : undefined), [library, id])

  const slides = useMemo(() => pres?.slides ?? [], [pres])
  const { sectionStart, blocks, total } = useMemo(() => buildFlat(slides), [slides])

  // Resume straight from the URL or the last saved position — no reset effect.
  // The search params are read on the client only: Next prerenders this page,
  // where there is no `window` and no history to replace.
  // `?step=` wins, then the last saved position, then the start.
  const deepLink = Number(params.get('step'))
  /**
   * Progress lives in the database now, so the resume point is a round trip.
   * It starts at 0 and is filled in below; `resumeReady` gates the URL sync so
   * the presenter does not overwrite the stored position with 0 before it has
   * been read.
   */
  const [current, setCurrent] = useState(Number.isFinite(deepLink) && deepLink >= 0 ? deepLink : 0)
  const [resumeReady, setResumeReady] = useState(
    Number.isFinite(deepLink) && deepLink >= 0,
  )
  const hydrated = useMounted()
  const [overview, setOverview] = useState(false)
  const [blackout, setBlackout] = useState(false)
  const [notes, setNotes] = useState(false)
  const [dark, setDark] = useState(pres?.theme === 'dark')
  const [timerOn, setTimerOn] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [score, setScore] = useState({ ok: 0, total: 0 })
  const [jump, setJump] = useState('')
  /** id of the quiz whose answer key is open, if any */
  const [answerKey, setAnswerKey] = useState<string | null>(null)
  const [help, setHelp] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [scale, setScale] = useState(1)

  const touchX = useRef<number | null>(null)
  const anchors = useRef(new Map<number, HTMLDivElement>())

  const finished = total > 0 && current >= total

  /* ---- resume where the last presentation left off ---- */
  useEffect(() => {
    if (!id || resumeReady) return
    void loadProgress(id).then((step) => {
      if (typeof step === 'number') setCurrent(step)
      setResumeReady(true)
    })
  }, [id, resumeReady])

  /* ---- keep the URL and the resume point in sync ---- */
  useEffect(() => {
    if (!id || !hydrated || !resumeReady) return
    const next = new URLSearchParams(window.location.search)
    next.set('step', String(current))
    window.history.replaceState(null, '', `${window.location.pathname}?${next.toString()}`)
    void saveProgress(id, current)
  }, [id, current, hydrated, resumeReady])

  /* ---- scroll the active block into view ---- */
  useEffect(() => {
    const id2 = setTimeout(() => {
      if (finished) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
        return
      }
      anchors.current.get(current)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 70)
    return () => clearTimeout(id2)
  }, [current, finished])

  /* ---- root font scaling ---- */
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * scale}px`
    return () => {
      document.documentElement.style.fontSize = ''
    }
  }, [scale])

  useEffect(() => {
    if (!timerOn) return
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [timerOn])

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  /* ---- navigation ---- */
  const next = useCallback(() => {
    if (overview) return
    setCurrent((c) => Math.min(c + 1, total))
  }, [overview, total])

  const prev = useCallback(() => {
    if (overview) return
    setCurrent((c) => Math.max(c - 1, 0))
  }, [overview])

  const goto = useCallback((n: number) => setCurrent(clamp(n, 0, total)), [total])

  const restart = useCallback(() => {
    setCurrent(0)
    setScore({ ok: 0, total: 0 })
    if (id) clearProgress(id)
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 90)
  }, [id])

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('لینک همین نقطه کپی شد ✓')
    } catch {
      toast('کپی نشد', 'err')
    }
  }, [])

  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen().catch(() => {})
  }, [])

  /* ---- keyboard ---- */
  useHotkeys(
    [
      { id: 'next', combo: 'space', label: 'گام بعد', group: 'نمایش', priority: 5, run: next },
      { id: 'next-l', combo: 'arrowleft', label: 'گام بعد (RTL)', group: 'نمایش', priority: 5, run: next },
      { id: 'prev-r', combo: 'arrowright', label: 'گام قبل', group: 'نمایش', priority: 5, run: prev },
      { id: 'prev-bs', combo: 'backspace', label: 'گام قبل', group: 'نمایش', hidden: true, run: prev },
      { id: 'ov', combo: 'g', label: 'نمای کل', group: 'نمایش', run: () => setOverview((o) => !o) },
      { id: 'ov-esc', combo: 'esc', label: 'بستن نمای کل / خاموشی', group: 'نمایش', run: () => {
        if (blackout) setBlackout(false)
        else setOverview(false)
      } },
      { id: 'black', combo: 'b', label: 'صفحهٔ سیاه', group: 'نمایش', run: () => setBlackout((v) => !v) },
      { id: 'notes', combo: 'n', label: 'یادداشت معلم', group: 'نمایش', run: () => setNotes((v) => !v) },
      { id: 'timer', combo: 't', label: 'تایمر', group: 'نمایش', run: () => setTimerOn((v) => !v) },
      { id: 'dark', combo: 'd', label: 'حالت تیره', group: 'نمایش', run: () => setDark((v) => !v) },
      { id: 'full', combo: 'f', label: 'تمام‌صفحه', group: 'نمایش', run: toggleFs },
      ...HELP_COMBOS.map((combo) => ({
        id: `help-${combo}`,
        combo,
        label: 'کلیدهای میان‌بر',
        group: 'راهنما',
        run: () => setHelp(true),
      })),
      { id: 'in', combo: '+', label: 'بزرگ‌تر', group: 'نمایش', run: () => setScale((s) => Math.min(1.35, +(s + 0.05).toFixed(2))) },
      { id: 'out', combo: '-', label: 'کوچک‌تر', group: 'نمایش', run: () => setScale((s) => Math.max(0.8, +(s - 0.05).toFixed(2))) },
      { id: 'home', combo: 'home', label: 'از ابتدا', group: 'نمایش', hidden: true, run: () => goto(0) },
      { id: 'end', combo: 'end', label: 'تا انتها', group: 'نمایش', hidden: true, run: () => goto(total) },
    ],
    [next, prev, goto, toggleFs, blackout, total],
  )

  // Home / End are handled separately so they don't collide with the palette.
  useEffect(() => registerHotkeys([
    { id: 'home2', combo: 'home', label: 'از ابتدا', group: 'نمایش', run: () => goto(0) },
    { id: 'end2', combo: 'end', label: 'تا انتها', group: 'نمایش', run: () => goto(total) },
    { id: 'digit-jump', combo: 'mod+g', label: 'پرش به گام', group: 'نمایش', run: () => {
      const raw = window.prompt('پرش به کدام گام؟')
      if (raw === null) return
      const n = parseNum(raw)
      if (Number.isFinite(n)) goto(n - 1)
    }, allowInInput: true },
  ]), [goto, total])

  /* ---- states ---- */
  const progress = total <= 1 ? 0 : Math.min(100, (current / Math.max(1, total - 1)) * 100)

  /** Global index of the newest revealed quiz — it takes keyboard focus. */
  let activeQuizGlobal = -1
  slides.forEach((_, si) => {
    blocks[si]?.forEach(({ step, global }) => {
      if (step.kind === 'quiz' && global <= current) activeQuizGlobal = global
    })
  })

  if (!pres) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas font-vazir text-ink">
          <p className="text-lg font-black">ارائه‌ای با این شناسه پیدا نشد.</p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => navigate('/create')}>
            ساخت ارائه
          </Button>
          <Button variant="outline" onClick={() => navigate('/bank')}>
            بانک سؤال
          </Button>
        </div>
      </div>
    )
  }

  if (slides.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas font-vazir">
          <div className="text-center">
          <p className="text-lg font-black text-ink">این ارائه بخشی ندارد.</p>
          <Link href="/create" className="mt-3 inline-block rounded-xl bg-brand px-4 py-2 text-sm font-black text-on-brand">
            بازگشت به استودیو
          </Link>
        </div>
      </div>
    )
  }

  const themeName = dark ? 'dark' : (pres.theme ?? 'light')
  const layout = pres.layout ?? 'flow'

  const blockClass = (span: SlideStep['span']) =>
    layout === 'stack' ? 'col-span-6' : spanClass(span)

  const setAnchor = (global: number) => (el: HTMLDivElement | null) => {
    if (el) anchors.current.set(global, el)
    else anchors.current.delete(global)
  }

  return (
    <div data-theme={themeName} className="min-h-screen bg-canvas font-vazir text-ink">

      <div
        className="cursor-pointer"
        onClick={next}
        onTouchStart={(e) => {
          touchX.current = e.touches[0].clientX
        }}
        onTouchEnd={(e) => {
          if (touchX.current === null) return
          const dx = e.changedTouches[0].clientX - touchX.current
          touchX.current = null
          if (dx < -50) next()
          else if (dx > 50) prev()
        }}
      >
        {/* header */}
        <header
          className="studio-header sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b border-hairline bg-surface/88 px-3 py-2 backdrop-blur"
          onClick={(e) => e.stopPropagation()}
        >
          <Link
            href={`/create?slide=${slides[0]?.id ?? ''}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-hairline px-2.5 text-2xs font-black text-ink-2 transition hover:bg-sunken hover:text-ink"
          >
            <Pencil className="size-3.5" />
            ویرایش
          </Link>
          <h1 className="min-w-0 truncate text-xs font-black text-ink-2">{pres.title}</h1>

          <div className="ms-auto flex items-center gap-1">
            {timerOn && <Badge tone="brand" className="tabular-nums">{fmtClock(elapsed)}</Badge>}
            {score.total > 0 && (
              <Badge tone={score.ok === score.total ? 'ok' : 'accent'}>
                {toFaDigits(score.ok)}/{toFaDigits(score.total)}
              </Badge>
            )}
            <IconButton icon={Grid3x3} label="نمای کل (G)" size="sm" active={overview} onClick={() => setOverview(true)} />
            <IconButton icon={Timer} label="تایمر (T)" size="sm" active={timerOn} onClick={() => setTimerOn((v) => !v)} />
            <IconButton icon={StickyNote} label="یادداشت معلم (N)" size="sm" active={notes} onClick={() => setNotes((v) => !v)} />
            <IconButton icon={dark ? Sun : Moon} label="حالت تیره (D)" size="sm" onClick={() => setDark((v) => !v)} />
            <IconButton icon={fullscreen ? Minimize : Maximize} label="تمام‌صفحه (F)" size="sm" onClick={toggleFs} />
            <IconButton icon={Link2} label="کپی لینک همین نقطه" size="sm" onClick={copyLink} />
            <IconButton icon={Keyboard} label="کلیدهای میان‌بر (?)" size="sm" onClick={() => setHelp(true)} />
          </div>
        </header>

        {/* deck */}
        <main className="mx-auto w-full max-w-6xl px-3 pb-36 pt-4">
          {slides.map((slide, si) => {
            const headerGlobal = sectionStart[si] ?? 0
            if (headerGlobal > current) return null
            return (
              <section key={slide.id} className="mb-6">
                <div ref={setAnchor(headerGlobal)}>
                  <motion.h2
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="mb-3 flex items-center gap-2.5"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand text-2xs font-black text-on-brand">
                      {si + 1}
                    </span>
                    <span className="text-lg font-black text-ink md:text-xl">{slide.title || 'بدون عنوان'}</span>
                    <span className="h-px flex-1 bg-hairline" />
                  </motion.h2>
                </div>

                <div className="block-grid">
                  {blocks[si]?.map(({ step, global, index }) => {
                    if (global > current) return null
                    const linked =
                      step.kind === 'quiz' && step.bankId ? questions.find((q) => q.id === step.bankId) : undefined
                    // The newest quiz on screen owns the number keys.
                    const isNewestQuiz = step.kind === 'quiz' && activeQuizGlobal === global
                    return (
                      <motion.div
                        key={step.id}
                        ref={setAnchor(global)}
                        initial={{ opacity: 0, y: 22 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.32, ease: 'easeOut', delay: Math.min(0.12, index * 0.02) }}
                        className={cn('scroll-mt-24 min-w-0', blockClass(step.span))}
                      >
                        <StepView
                          step={step}
                          interactive
                          autoFocus={isNewestQuiz}
                          quizMeta={linked ? { source: linked.source, tags: linked.tags } : undefined}
                          onShowAnswerKey={linked?.answerKey ? () => setAnswerKey(step.id) : undefined}
                          onAnswer={(correct: boolean) =>
                            setScore((s) => ({ ok: s.ok + (correct ? 1 : 0), total: s.total + 1 }))
                          }
                          onOpenStudio={
                            step.kind === 'animation'
                              ? () => {
                                  // Editing the scene means leaving the deck, so
                                  // open it beside the presentation instead of
                                  // throwing away the teacher's place.
                                  window.open(`/studio/${pres.id}/${slide.id}/${step.id}`, '_blank', 'noopener')
                                }
                              : undefined
                          }
                        />
                        {answerKey === step.id && linked?.answerKey && (
                          <AnswerKeySheet
                            answerKey={linked.answerKey}
                            question={step.kind === 'quiz' ? step.question : undefined}
                            onClose={() => setAnswerKey(null)}
                          />
                        )}
                      </motion.div>
                    )
                  })}
                </div>

                {notes && slide.notes && (
                  <div
                    className="mt-3 flex items-start gap-2 rounded-2xl border border-warn/40 bg-warn/[0.08] px-3.5 py-2.5 text-sm leading-7 text-ink-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <StickyNote className="mt-1 size-3.5 shrink-0 text-warn" />
                    <span dir="auto">{slide.notes}</span>
                  </div>
                )}
              </section>
            )
          })}

          {finished && (
            <div className="confetti-host surface rounded-3xl p-8 text-center">
              <div className="text-4xl">🎉</div>
              <h2 className="mt-2 text-2xl font-black text-ink">تمام شد!</h2>
              <p className="mt-1 text-sm text-ink-2">
                {toFaDigits(slides.length)} بخش · {toFaDigits(total - slides.length)} گام
                {score.total > 0 && <> · پرسش‌ها {toFaDigits(score.ok)} از {toFaDigits(score.total)}</>}
              </p>
              <div className="mx-auto mt-5 flex max-w-md flex-wrap justify-center gap-2">
                <Button variant="primary" icon={RotateCcw} onClick={restart}>
                  از اول
                </Button>
                <Button variant="outline" icon={BookMarked} onClick={() => navigate('/bank')}>
                  بانک سؤال
                </Button>
                <Link
                  href="/create"
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-hairline px-3.5 text-sm font-bold text-ink-2 transition hover:bg-sunken"
                >
                  <Pencil className="size-4" />
                  ویرایش
                </Link>
              </div>
            </div>
          )}

          {!finished && (
            <p className="mt-4 text-center text-2xs font-bold text-ink-3">
              کلیک یا <kbd className="kbd">←</kbd> برای گام بعد · {toFaDigits(Math.min(current + 1, total))} از{' '}
              {toFaDigits(total)}
            </p>
          )}
        </main>
      </div>

      {/* footer */}
      <footer
        className="studio-footer fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface/94 backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-3 py-2">
          <Button size="sm" variant="outline" icon={ArrowRight} onClick={prev} disabled={current <= 0}>
            قبلی
          </Button>
          <Button size="sm" variant="primary" icon={ArrowLeft} iconEnd={undefined} onClick={next} disabled={finished}>
            بعدی
          </Button>
          <span className="text-2xs font-black tabular-nums text-ink-3">
            گام {toFaDigits(Math.min(current + 1, total))} / {toFaDigits(total)}
          </span>

          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              const n = parseNum(jump)
              if (Number.isFinite(n)) goto(n - 1)
              setJump('')
            }}
          >
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              inputMode="numeric"
              aria-label="پرش به گام"
              placeholder="پرش"
              className="h-8 w-16 rounded-lg border border-hairline bg-surface px-2 text-center text-2xs font-black outline-none focus:border-brand/70"
            />
          </form>

          <div className="order-last h-1.5 w-full overflow-hidden rounded-full bg-hairline sm:order-none sm:h-2 sm:w-auto sm:min-w-24 sm:flex-1">
            <div
              className="h-full rounded-full bg-gradient-to-l from-brand to-accent transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>

          <IconButton icon={Printer} label="چاپ برنامهٔ درس" size="sm" onClick={() => window.print()} />
        </div>
      </footer>

      {/* overview */}
      {overview && (
        <div
          className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-label="نمای کل"
          onClick={() => setOverview(false)}
        >
          <div className="mx-auto max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-base font-black text-white">نمای کل</h2>
              <span className="text-2xs text-white/60">برای پرش کلیک کنید · Esc = بستن</span>
              <IconButton icon={ArrowLeft} label="بستن" size="sm" className="ms-auto text-white/70" onClick={() => setOverview(false)} />
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {slides.map((s, i) => {
                const start = sectionStart[i] ?? 0
                const seen = start <= current
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      goto(start)
                      setOverview(false)
                    }}
                    className={cn(
                      'rounded-2xl border p-3.5 text-start transition hover:scale-[1.01]',
                      seen ? 'border-brand bg-brand-soft' : 'border-white/15 bg-white/5',
                    )}
                  >
                    <span className="mb-1 flex items-center gap-2">
                      <span
                        className={cn(
                          'flex size-6 items-center justify-center rounded-md text-2xs font-black',
                          seen ? 'bg-brand text-on-brand' : 'bg-white/10 text-white/70',
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className={cn('truncate text-sm font-black', seen ? 'text-ink' : 'text-white/80')}>{s.title || 'بدون عنوان'}</span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {s.steps.slice(0, 6).map((st) => (
                        <span
                          key={st.id}
                          title={`${KIND_LABEL[st.kind]} — ${SPAN_LABEL[st.span]}`}
                          className="size-2 rounded-full opacity-80"
                          style={{ background: KIND_ACCENT[st.kind] }}
                        />
                      ))}
                    </span>
                    <span className={cn('mt-1.5 block text-2xs', seen ? 'text-ink-3' : 'text-white/50')}>
                      {toFaDigits(s.steps.length)} گام{s.notes ? ' · یادداشت' : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {blackout && (
        <div
          className="fixed inset-0 z-[80] flex cursor-pointer items-center justify-center bg-slate-950"
          onClick={(e) => {
            e.stopPropagation()
            setBlackout(false)
          }}
        >
          <p className="animate-pulse text-sm font-black text-white/45">نگاه‌ها به من! · B یا کلیک</p>
        </div>
      )}

      <ShortcutsSheet open={help} onClose={() => setHelp(false)} />
    </div>
  )
}
