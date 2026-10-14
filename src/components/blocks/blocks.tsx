import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BlockMath } from 'react-katex'
import {
  BookOpenCheck,
  AlertTriangle,
  BadgeCheck,
  Check,
  Copy,
  CopyCheck,
  ExternalLink,
  Lightbulb,
  ListOrdered,
  Play,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { CalloutTone, SlideStep } from '../../types'
import { CALLOUT_TONE_LABEL } from '../../types'
import { cn } from '../../lib/utils'
import { useInView } from '../../lib/useInView'
import { Caption, Frame } from './Frame'
import { RichText, renderRich } from './RichText'
import { StepView } from './index'

/* ------------------------------------------------------------------ *
 *  Text
 * ------------------------------------------------------------------ */

export function TextBlock({ value }: { value: string }) {
  if (!value.trim()) return <Empty value="متنی بنویسید…" />
  return (
    <div dir="auto" className="text-lg leading-9 text-ink-2 md:text-xl md:leading-10">
      <RichText value={value} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  List
 * ------------------------------------------------------------------ */

const FA_NUM = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']

export function ListBlock({ items, ordered }: { items: string[]; ordered?: boolean }) {
  const clean = items.filter((i) => i.trim())
  if (clean.length === 0) return <Empty value="آیتمی اضافه کنید…" />
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => {
        if (!item.trim()) return null
        const last = i === items.length - 1
        return (
          <li
            key={i}
            className={cn(
              'flex items-start gap-3 text-lg leading-8 text-ink-2',
              !last && 'border-b border-hairline/70 pb-2.5',
            )}
          >
            <span
              className={cn(
                'mt-1.5 flex size-6 shrink-0 items-center justify-center text-xs font-black',
                ordered
                  ? 'rounded-md bg-brand-soft text-brand'
                  : 'size-2.5 rounded-full bg-brand/70',
              )}
            >
              {ordered ? FA_NUM[i + 1] : ''}
            </span>
            <span dir="auto" className="min-w-0 flex-1">
              <RichText value={item} as="span" />
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------------ *
 *  Callout
 * ------------------------------------------------------------------ */

const TONE: Record<CalloutTone, { icon: typeof Lightbulb; bg: string; text: string; ring: string; accent: string }> = {
  info: { icon: Sparkles, bg: 'bg-accent-soft', text: 'text-accent', ring: 'ring-accent/20', accent: '#2563eb' },
  tip: { icon: Lightbulb, bg: 'bg-brand-soft', text: 'text-brand', ring: 'ring-brand/20', accent: '#ea580c' },
  warn: { icon: TriangleAlert, bg: 'bg-danger/10', text: 'text-danger', ring: 'ring-danger/20', accent: '#e11d48' },
  idea: { icon: Sparkles, bg: 'bg-ok/12', text: 'text-ok', ring: 'ring-ok/20', accent: '#059669' },
}

export function CalloutBlock({ value, tone = 'info' }: { value: string; tone?: CalloutTone }) {
  const t = TONE[tone] ?? TONE.info
  const Icon = t.icon
  return (
    <div className={cn('flex items-start gap-3 rounded-2xl px-4 py-3.5 ring-1', t.bg, t.ring)} style={{ ['--k-accent' as string]: t.accent }}>
      <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface/70', t.text)}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('mb-1 text-xs font-black', t.text)}>{CALLOUT_TONE_LABEL[tone]}</div>
        <div dir="auto" className="text-base leading-8 text-ink-2">
          <RichText value={value} />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Trap — the exam trap callout
 * ------------------------------------------------------------------ */

export function TrapBlock({ value }: { value: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-danger/25 bg-danger/[0.06] px-4 py-3.5">
      <div
        aria-hidden
        className="absolute inset-y-0 start-0 w-1.5"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgb(var(--danger)) 0 6px, transparent 6px 12px)', opacity: 0.75 }}
      />
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-danger/12 text-danger">
          <AlertTriangle className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-black text-danger">تلهٔ امتحانی</span>
            <span className="h-px flex-1 bg-danger/20" />
          </div>
          <div dir="auto" className="text-base leading-8 text-ink-2">
            <RichText value={value} />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Formula
 * ------------------------------------------------------------------ */

export function FormulaBlock({ value }: { value: string }) {
  if (!value.trim()) return <Empty value="فرمولی بنویسید…" />
  return (
    <div dir="ltr" className="rounded-2xl border border-accent/20 bg-accent-soft/60 px-4 py-5 sm:px-6">
      <div className="overflow-x-auto scroll-thin">
        <BlockMath math={value} errorColor="rgb(var(--danger))" />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Image
 * ------------------------------------------------------------------ */

export function ImageBlock({ value, alt, caption }: { value: string; alt?: string; caption?: string }) {
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(false)

  if (!value.trim() || failed) {
    return (
      <Frame variant="media" bodyClassName="flex items-center gap-3 py-6">
        <span className="text-2xl">🖼️</span>
        <span className="text-sm font-bold text-ink-3">
          {failed ? 'تصویر بارگذاری نشد — آدرس را بررسی کنید.' : 'آدرس تصویر را وارد کنید…'}
        </span>
      </Frame>
    )
  }

  return (
    <>
      <figure
        className="group relative overflow-hidden rounded-2xl border border-hairline bg-sunken/60"
        onClick={(e) => {
          e.stopPropagation()
          setZoom(true)
        }}
      >
        <img
          src={value}
          alt={alt ?? ''}
          loading="lazy"
          onError={() => setFailed(true)}
          className="mx-auto max-h-[46vh] w-full cursor-zoom-in object-contain"
        />
        <span className="pointer-events-none absolute end-2 top-2 rounded-lg bg-ink/70 px-2 py-1 text-2xs font-bold text-canvas opacity-0 transition group-hover:opacity-100">
          بزرگ‌نمایی
        </span>
        {caption && <Caption>{renderRich(caption)}</Caption>}
      </figure>
      {zoom && (
        <div
          className="fixed inset-0 z-[95] flex cursor-zoom-out items-center justify-center bg-slate-950/90 p-4"
          role="dialog"
          aria-label="نمای بزرگ تصویر"
          onClick={(e) => {
            e.stopPropagation()
            setZoom(false)
          }}
        >
          <img src={value} alt={alt ?? ''} className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Video
 * ------------------------------------------------------------------ */

function videoEmbed(url: string): { kind: 'iframe'; src: string } | { kind: 'file'; src: string } | null {
  const u = url.trim()
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/)
  if (yt) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0` }
  if (u.includes('youtube.com/embed/')) return { kind: 'iframe', src: u.replace('youtube.com', 'youtube-nocookie.com') }
  const ap = u.match(/aparat\.com\/v\/([\w]+)/)
  if (ap) return { kind: 'iframe', src: `https://www.aparat.com/video/video/embed/videohash/${ap[1]}/vt/frame` }
  if (/vimeo\.com\/(?:video\/)?(\d+)/.test(u)) {
    const id = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)![1]
    return { kind: 'iframe', src: `https://player.vimeo.com/video/${id}` }
  }
  if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(u)) return { kind: 'file', src: u }
  return null
}

export function VideoBlock({ value, caption }: { value: string; caption?: string }) {
  const media = videoEmbed(value ?? '')
  const [hostRef, inView] = useInView<HTMLElement>()
  // Decoding video nobody is looking at is pure waste; iframes get reloaded
  // instead, since there is no API to pause a cross-origin player.
  useEffect(() => {
    const el = hostRef.current
    if (!el || media?.kind !== 'file') return
    const v = el.querySelector('video')
    if (!v) return
    if (inView) {
      if (v.dataset.autoplay === '1') void v.play().catch(() => undefined)
    } else if (!v.paused) {
      v.pause()
    }
  }, [inView, hostRef, media])
  if (!media) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-3 rounded-2xl border border-accent/25 bg-accent-soft/60 px-4 py-3.5 font-bold text-accent transition hover:bg-accent-soft"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
          <ExternalLink className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm" dir="ltr">
          {value || 'لینک ویدیو…'}
        </span>
        {caption && <span className="hidden shrink-0 text-xs font-bold opacity-70 sm:block">{caption}</span>}
      </a>
    )
  }
  return (
    <figure ref={hostRef} className="overflow-hidden rounded-2xl border border-hairline bg-slate-950" onClick={(e) => e.stopPropagation()}>
      {media.kind === 'iframe' ? (
        <div className="aspect-video w-full">
          {inView ? (
            <iframe
              src={media.src}
              title="video"
              className="size-full"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              className="flex aspect-video w-full items-center justify-center gap-2 text-sm font-black text-slate-400 hover:text-slate-200"
              onClick={(e) => e.stopPropagation()}
            >
              <Play className="size-5" />
              ویدیو خارج از دید است — برای پخش کلیک کنید
            </button>
          )}
        </div>
      ) : (
        <video src={media.src} controls preload="metadata" className="max-h-[52vh] w-full" />
      )}
      {caption && <Caption className="bg-slate-950 text-slate-400">{renderRich(caption)}</Caption>}
    </figure>
  )
}

/* ------------------------------------------------------------------ *
 *  Code
 * ------------------------------------------------------------------ */

export function CodeBlock({ value, caption }: { value: string; caption?: string }) {
  const [copied, setCopied] = useState(false)
  const lines = (value || '// …').split('\n')

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <Frame variant="terminal" bodyClassName="p-0">
      <div dir="ltr" className="text-left" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/10 px-3.5 py-2">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-rose-400/80" />
            <span className="size-2.5 rounded-full bg-amber-300/80" />
            <span className="size-2.5 rounded-full bg-emerald-400/80" />
          </span>
          {caption && <span className="ms-2 truncate text-2xs font-bold text-slate-400">{caption}</span>}
          <button
            type="button"
            onClick={copy}
            className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-2xs font-bold text-slate-200 transition hover:bg-white/20"
          >
            {copied ? <CopyCheck className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
            {copied ? 'کپی شد' : 'کپی'}
          </button>
        </div>
        <pre className="max-h-[42vh] overflow-auto scroll-thin p-3.5 font-mono text-[13px] leading-6">
          <code>
            {lines.map((line, i) => (
              <span key={i} className="flex">
                <span className="me-3 w-8 shrink-0 select-none text-end text-slate-600">{i + 1}</span>
                <span className="whitespace-pre text-emerald-100/95">{line || ' '}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </Frame>
  )
}

/* ------------------------------------------------------------------ *
 *  Quiz
 * ------------------------------------------------------------------ */

const OPTION_KEYS = ['1', '2', '3', '4', '5', '6', 'a', 'b', 'c', 'd', 'e', 'f']

export function QuizBlock({
  question,
  options,
  answerIndex,
  explanation,
  interactive,
  source,
  tags,
  onAnswer,
  onReview,
  onUnlink,
  onShowAnswerKey,
  questionBlocks,
  optionBlocks,
  compact,
  autoFocus,
}: {
  question: string
  options: string[]
  answerIndex: number
  explanation?: string
  interactive?: boolean
  source?: string
  tags?: string[]
  questionBlocks?: SlideStep[]
  optionBlocks?: SlideStep[][]
  onShowAnswerKey?: () => void
  onAnswer?: (correct: boolean, picked: number) => void
  /** shown in the editor: jump back to the bank entry */
  onReview?: () => void
  onUnlink?: () => void
  compact?: boolean
  /**
   * The presenter sets this on the quiz it has just revealed, so the number
   * keys answer it without the teacher ever touching the mouse.
   */
  autoFocus?: boolean
}) {
  const [picked, setPicked] = useState<number | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const revealed = picked !== null

  useEffect(() => {
    if (autoFocus) hostRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  const pick = (i: number) => {
    if (!interactive || revealed) return
    setPicked(i)
    onAnswer?.(i === answerIndex, i)
  }

  return (
    <div
      ref={hostRef}
      tabIndex={interactive ? 0 : -1}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (!interactive || revealed) return
        const n = OPTION_KEYS.indexOf(e.key.toLowerCase())
        if (n >= 0 && n < options.length) {
          e.preventDefault()
          pick(n)
        }
      }}
      className="rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/[0.05] p-4 outline-none transition focus-visible:border-fuchsia-500/60 sm:p-5"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia-500/12 px-2 py-0.5 text-2xs font-black text-fuchsia-600 dark:text-fuchsia-300">
          <BadgeCheck className="size-3" />
          سنجش یادگیری
        </span>
        {source && <span className="truncate text-2xs font-bold text-ink-3">{source}</span>}
        {tags && tags.length > 0 && (
          <span className="truncate text-2xs text-ink-3" dir="auto">
            {tags.join(' › ')}
          </span>
        )}
        {onReview && (
          <button
            type="button"
            onClick={onReview}
            className="ms-auto rounded-lg bg-surface px-2 py-1 text-2xs font-bold text-ink-2 shadow-card hover:text-ink"
          >
            در بانک سؤال
          </button>
        )}
        {onUnlink && (
          <button type="button" onClick={onUnlink} className="ms-auto text-2xs font-bold text-ink-3 hover:text-danger">
            حذف پیوند
          </button>
        )}
      </div>

      <div dir="auto" className={cn('font-extrabold leading-9 text-ink', compact ? 'text-base' : 'text-lg md:text-xl')}>
        <RichText value={question} />
      </div>

      {/* figures on the stem — a circuit, a trajectory, a charge diagram */}
      {questionBlocks && questionBlocks.length > 0 && (
        <div className="mt-3 space-y-2">
          {questionBlocks.map((b) => (
            <div key={b.id} className={cn('min-w-0', b.span === 'full' ? '' : b.span === 'half' ? 'sm:w-1/2 sm:inline-block sm:me-1' : 'sm:w-1/3 sm:inline-block sm:me-1')}>
              <StepView step={b} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-2">
        {options.map((op, i) => {
          if (op === '' && i >= 2) return null
          const isAnswer = i === answerIndex
          const isPicked = picked === i
          let cls = 'border-hairline bg-surface text-ink-2 hover:border-fuchsia-400/60'
          if (revealed && isAnswer) cls = 'border-ok/60 bg-ok/10 text-ok'
          else if (revealed && isPicked) cls = 'border-danger/50 bg-danger/10 text-danger'
          return (
            <button
              key={i}
              type="button"
              disabled={!interactive || revealed}
              onClick={(e) => {
                e.stopPropagation()
                pick(i)
              }}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-start text-sm font-bold transition',
                cls,
                interactive && !revealed && 'cursor-pointer',
              )}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-lg text-2xs font-black',
                  revealed && isAnswer ? 'bg-ok text-white' : 'bg-sunken text-ink-3',
                )}
              >
                {FA_NUM[i + 1] ?? i + 1}
              </span>
              <span dir="auto" className="min-w-0 flex-1">
                {renderRich(op)}
                {/* an option can carry a figure too — «کدام شکل درست است؟» */}
                {optionBlocks?.[i] && optionBlocks[i].length > 0 && (
                  <span className="mt-2 block space-y-2">
                    {optionBlocks[i].map((b) => (
                      <StepView key={b.id} step={b} />
                    ))}
                  </span>
                )}
              </span>
              {revealed && isAnswer && <Check className="size-4 shrink-0" />}
              {revealed && isPicked && !isAnswer && <X className="size-4 shrink-0" />}
            </button>
          )
        })}
      </div>

      {revealed && explanation && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-surface/70 px-3 py-2 text-sm leading-7 text-ink-2">
          <ListOrdered className="mt-1 size-3.5 shrink-0 text-ink-3" />
          <span dir="auto">{renderRich(explanation)}</span>
        </div>
      )}

      {revealed && (
        <p className={cn('mt-3 text-sm font-black', picked === answerIndex ? 'text-ok' : 'text-danger')}>
          {picked === answerIndex ? 'آفرین! درست جواب دادی.' : 'اشکال ندارد — جواب درست سبز شد.'}
        </p>
      )}

      {/* the answer key is a full walkthrough, so it opens beside the question */}
      {revealed && onShowAnswerKey && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onShowAnswerKey()
          }}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-fuchsia-500/12 px-2.5 py-1.5 text-2xs font-black text-fuchsia-700 transition hover:bg-fuchsia-500/20 dark:text-fuchsia-300"
        >
          <BookOpenCheck className="size-3.5" />
          پاسخ‌نامهٔ تشریحی
        </button>
      )}

      {interactive && !revealed && (
        <p className="mt-3 text-2xs font-bold text-ink-3">
          با کلیدهای <span className="kbd mx-0.5">۱</span> تا <span className="kbd mx-0.5">{FA_NUM[options.length] ?? options.length}</span> یا
          <span className="kbd mx-0.5">a</span> تا <span className="kbd mx-0.5">d</span> پاسخ بده
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Shared empty state
 * ------------------------------------------------------------------ */

export function Empty({ value }: { value: string }): ReactNode {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-hairline px-4 py-3 text-sm font-bold text-ink-3">
      <Play className="size-3.5 shrink-0 opacity-60" />
      {value}
    </div>
  )
}

/**
 * A table.
 *
 * Rendered as a real `<table>` rather than a grid of divs: a comparison table
 * is exactly the content a screen reader user navigates by row and column, and
 * a div grid announces it as an undifferentiated pile of text. The scroll
 * container keeps `overflow` on a wrapper so a sticky header can work without
 * fighting the block chrome.
 */
export function TableBlock({
  rows,
  header = true,
  caption,
  compact,
  emphasizeLastRow,
}: {
  rows: string[][]
  header?: boolean
  caption?: string
  compact?: boolean
  emphasizeLastRow?: boolean
}) {
  // A hand-edited table is rarely rectangular; a short row would otherwise
  // collapse the grid and shift every column to its left.
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const body = rows.length === 0 ? [['']] : rows
  const head = header ? body[0] : null
  const rest = header ? body.slice(1) : body
  const last = emphasizeLastRow ? rest.length - 1 : -1

  const pad = compact ? 'px-2 py-1 text-2xs' : 'px-3 py-1.5 text-xs'

  return (
    <Frame variant="quiet" bodyClassName="p-0">
      <div className="max-h-[26rem] w-full overflow-auto">
        <table className="w-full border-collapse text-start">
          {caption ? <caption className="px-3 pb-1.5 text-start text-2xs text-ink-3">{caption}</caption> : null}
          <thead className="sticky top-0 z-[1] bg-sunken">
            <tr>
              {(head ?? new Array(cols).fill('')).map((cell, i) => (
                <th
                  key={i}
                  scope="col"
                  className={cn(pad, 'border-b border-hairline text-start font-bold text-ink-2', i > 0 && 'border-s border-hairline')}
                >
                  {/* A cell may hold a formula, which is most of what a
                      physics data table contains. */}
                  {cell.includes('$') ? <BlockMath math={cell.replace(/\$/g, '')} /> : cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rest.map((row, r) => (
              <tr key={r} className={cn(r === last && 'bg-brand-soft/30 font-medium')}>
                {Array.from({ length: cols }, (_, c) => (
                  <td
                    key={c}
                    className={cn(pad, 'border-b border-hairline align-top text-ink-2', c > 0 && 'border-s border-hairline')}
                  >
                    {row[c]?.includes('$') ? <BlockMath math={row[c]!.replace(/\$/g, '')} /> : (row[c] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rest.length === 0 ? (
        <p className="px-3 py-3 text-2xs text-ink-3">جدول خالی است.</p>
      ) : null}
    </Frame>
  )
}
