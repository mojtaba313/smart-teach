import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Expand, Gauge, Minimize, Pause, Pencil, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import type { Animation } from '../../types'
import { animationDuration, wrapTime } from '../../lib/anim/engine'
import { useLocalKeys } from '../../lib/hotkeys'
import { useInView } from '../../lib/useInView'
import { clamp, cn, toFaDigits } from '../../lib/utils'
import { useScrollLock } from '../ui/overlay'
import { IconButton } from '../ui/primitives'
import { AnimationScene } from '../anim/Scene'

/**
 * The in-deck player. Self-contained transport, keyboard-driven, and it
 * starts cleanly whenever the presenter reveals the block.
 */
export function AnimationPlayer({
  anim,
  className,
  autoStart,
  onOpenStudio,
}: {
  anim: Animation
  className?: string
  autoStart?: boolean
  onOpenStudio?: () => void
}) {
  const duration = animationDuration(anim)
  const [t, setT] = useState(0)
  // The presenter mounts each block exactly when it is revealed, so the
  // initial state is the right place to decide whether to start playing.
  const [playing, setPlaying] = useState(() => autoStart ?? anim.autoplay)
  const [expanded, setExpanded] = useState(false)
  const frame = useRef<number | null>(null)
  const last = useRef<number>(0)
  // Off-screen blocks stop their animation loop entirely: a long deck should
  // not keep a frame callback alive per animation the audience cannot see.
  const [hostRef, inView] = useInView<HTMLDivElement>()

  // Fullscreen mode must not leave the page scrolling behind it, and Escape
  // has to get the teacher out of it.
  useScrollLock(expanded)
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setExpanded(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [expanded])

  useEffect(() => {
    // A fullscreen block is always on screen, whatever the observer says.
    if (!playing || (!inView && !expanded)) {
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = null
      return
    }
    last.current = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last.current) / 1000)
      last.current = now
      setT((prev) => {
        const adv = prev + dt * anim.speed
        if (!anim.loop && adv >= duration) {
          setPlaying(false)
          return duration
        }
        return wrapTime(adv, anim)
      })
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [playing, inView, expanded, anim, duration])

  const seek = useCallback((v: number) => setT(clamp(v, 0, duration)), [duration])

  const nudgeTime = useCallback(
    (dir: -1 | 1) => setT((prev) => wrapTime(prev + dir * 0.1 * Math.max(0.1, anim.speed), anim)),
    [anim],
  )

  const restart = useCallback(() => {
    setT(0)
    setPlaying(true)
  }, [])

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      switch (e.key) {
        case ' ':
        case 'k':
        case 'Enter':
          e.preventDefault()
          setPlaying((p) => !p)
          break
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault()
          e.stopPropagation()
          nudgeTime(e.key === 'ArrowLeft' ? 1 : -1)
          break
        case 'Home':
          e.preventDefault()
          e.stopPropagation()
          seek(0)
          break
        case 'End':
          e.preventDefault()
          e.stopPropagation()
          seek(duration)
          break
        case 'r':
          e.preventDefault()
          restart()
          break
        default:
          break
      }
    },
    [duration, nudgeTime, restart, seek],
  )

  const keysRef = useLocalKeys(onKey, [onKey])
  const pct = duration > 0 ? (t / duration) * 100 : 0
  const timeLabel = useMemo(() => `${toFaDigits(t.toFixed(1))} / ${toFaDigits(duration.toFixed(1))} ث`, [t, duration])

  return (
    <div
      ref={(el) => {
        keysRef.current = el
        hostRef.current = el
      }}
      tabIndex={0}
      role="group"
      aria-label={`انیمیشن: ${anim.title}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'overflow-hidden rounded-2xl border border-hairline bg-surface shadow-card outline-none',
        expanded ? 'fixed inset-3 z-[95] flex flex-col md:inset-10' : className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <Gauge className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-black text-ink">{anim.title}</span>
        {onOpenStudio && (
          <IconButton
            icon={Pencil}
            label="ویرایش انیمیشن در استودیو"
            size="sm"
            onClick={onOpenStudio}
          />
        )}
        <IconButton
          icon={expanded ? Minimize : Expand}
          label={expanded ? 'خروج از تمام‌صفحه' : 'تمام‌صفحه'}
          size="sm"
          onClick={() => setExpanded((e) => !e)}
        />
      </div>

      <div className={cn('p-2', expanded && 'min-h-0 flex-1 overflow-auto scroll-thin')}>
        <AnimationScene anim={anim} t={t} onScrub={seek} />
      </div>

      <div className="flex items-center gap-1.5 border-t border-hairline bg-sunken/50 px-2.5 py-2">
        <IconButton icon={playing ? Pause : Play} label={playing ? 'مکث' : 'پخش'} size="sm" onClick={() => setPlaying((p) => !p)} />
        <IconButton icon={RotateCcw} label="از اول" size="sm" onClick={restart} />
        <IconButton icon={SkipBack} label="یک قاب عقب" className="hidden sm:inline-flex" size="sm" onClick={() => nudgeTime(-1)} />
        <IconButton icon={SkipForward} label="یک قاب جلو" size="sm" onClick={() => nudgeTime(1)} />

        <div className="relative mx-1 min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={t}
            onChange={(e) => seek(Number(e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="زمان انیمیشن"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-hairline"
            style={{
              backgroundImage: `linear-gradient(to left, rgb(var(--brand)) ${pct}%, rgb(var(--line)) ${pct}%)`,
            }}
          />
        </div>

        <span className="shrink-0 text-2xs font-black tabular-nums text-ink-3">{timeLabel}</span>
      </div>

      <p className="border-t border-hairline px-3 py-1.5 text-center text-2xs text-ink-3">
        <span className="kbd mx-0.5">Space</span> پخش/مکث · <span className="kbd mx-0.5">←</span>
        <span className="kbd mx-0.5">→</span> قاب‌به‌قاب · <span className="kbd mx-0.5">R</span> از اول
      </p>
    </div>
  )
}
