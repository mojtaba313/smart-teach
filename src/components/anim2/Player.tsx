/**
 * The v2 player.
 *
 * Three things it does that v1's did not:
 *
 * 1. **The clock is not React state.** It lives in a ref and only the canvas
 *    subscribes, so a frame re-renders one `<svg>` subtree instead of the
 *    studio, the timeline and every inspector panel.
 * 2. **Text is sized in screen pixels, not scene units.** A 14-unit label in
 *    a third-width block renders at 7 real pixels. A ResizeObserver measures
 *    the container and the renderer raises the size until it is legible.
 * 3. **It cannot white-screen.** An error boundary sits around the canvas, so
 *    a broken animation shows a message in place rather than an empty block
 *    five minutes into a lesson.
 */

'use client'

import {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { AlertTriangle, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import type { Animation2 } from '../../types/anim2'
import { ANIM2_SCHEMA, LIMITS } from '../../types/anim2'
import { compileAnimation, evaluate, type CompiledAnimation, type Frame as EngineFrame } from '../../lib/anim2/engine'
import { Clock, prefersReducedMotion } from '../../lib/anim2/clock'
import { ParticleSystem } from '../../lib/anim2/particles'
import { clearGeometryCache, ParticleLayer, renderNodes } from './nodes'
import { ParamsPanel } from './Controls'
import { useSceneRuntime } from './useSceneRuntime'
import { freeFrame, viewFor } from './geometry'
import { cn, toFaDigits } from '../../lib/utils'

/* ------------------------------------------------------------------ *
 *  Error boundary
 * ------------------------------------------------------------------ */

/**
 * A broken animation must cost one block, not the whole slide. Without this,
 * one bad expression mid-lesson means an empty rectangle on screen.
 */
class AnimationErrorBoundary extends Component<
  { children: ReactNode; onError?: (e: Error) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error | null } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-xs font-bold text-warn">
          <AlertTriangle className="size-4 shrink-0" />
          <span>این انیمیشن کشیده نشد: {this.state.error.message}</span>
        </div>
      )
    }
    return this.props.children
  }
}

/* ------------------------------------------------------------------ *
 *  Canvas
 * ------------------------------------------------------------------ */

/**
 * The only component that subscribes to the clock. Everything else re-renders
 * when the *document* changes, not when time moves.
 */
const Canvas = memo(function Canvas({
  compiled,
  clock,
  onScrub,
  particles,
  particleVersion,
  mapFrame,
  className,
  overrides,
}: {
  compiled: CompiledAnimation
  clock: Clock
  onScrub?: (t: number) => void
  particles?: ParticleSystem
  particleVersion?: number
  /** Data units to scene units; particles simulate in the scene's own space. */
  mapFrame?: (x: number, y: number) => { x: number; y: number }
  className?: string
  /** Live control readings, so the scene responds to the knobs. */
  overrides?: Record<string, number>
}) {
  // The only place in the tree that follows the clock frame by frame.
  const t = useSyncExternalStore(clock.subscribe, clock.getSnapshot)
  const frame = useMemo(() => evaluate(compiled, t, overrides), [compiled, t, overrides])

  const view = useMemo(
    () => viewFor(compiled.anim.scene?.aspect, compiled.anim.scene?.height),
    [compiled.anim.scene?.aspect, compiled.anim.scene?.height],
  )

  // Measure the rendered box so text can be sized in real pixels.
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [textScale, setTextScale] = useState(1)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setTextScale(Math.max(0.05, w / view.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [view.width])

  const free = useMemo(() => freeFrame(view), [view])

  const scrub = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onScrub) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width)
    onScrub(Math.min(1, Math.max(0, ratio)) * compiled.duration)
  }

  const background = (compiled.anim.scene?.background as string | undefined) ?? 'rgb(var(--scene))'

  return (
    <div ref={boxRef} className={cn('relative w-full', className)}>
      <svg
        viewBox={`0 0 ${view.width} ${view.height}`}
        className="block w-full touch-pan-y select-none"
        role="img"
        aria-label={describe(compiled.anim, frame)}
        style={{ background, aspectRatio: `${view.width} / ${view.height}` }}
        onPointerDown={(e) => {
          scrub(e)
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) scrub(e)
        }}
      >
        <title>{compiled.anim.title || 'انیمیشن'}</title>
        <desc>{describe(compiled.anim, frame)}</desc>
        {renderNodes(frame.nodes, {
          frame: free,
          free,
          hash: compiled.hash,
          t,
          params: overrides ?? {},
          textScale,
        })}
        {particles ? (
          <ParticleLayer particles={particles} version={particleVersion} map={mapFrame} />
        ) : null}
      </svg>
    </div>
  )
})

/** A sentence a screen reader can actually read. */
function describe(anim: Animation2, frame: EngineFrame): string {
  const parts: string[] = []
  if (anim.title) parts.push(anim.title)
  const named = frame.nodes.filter((n) => n.name).slice(0, 6)
  if (named.length) parts.push(named.map((n) => n.name).join('، '))
  const readout = frame.nodes.find((n) => typeof n.text === 'string' && n.text.length > 0)
  if (readout?.text) parts.push(readout.text)
  return parts.join(' — ') || 'صحنهٔ انیمیشن'
}

/**
 * The transport follows the clock too, but it is a handful of buttons, so it
 * costs nothing. Split out precisely so the Player above never re-renders.
 */
const Transport = memo(function Transport({
  clock,
  duration,
  reduced,
}: {
  clock: Clock
  duration: number
  reduced: boolean
}) {
  const t = useSyncExternalStore(clock.subscribe, clock.getSnapshot)
  return (
    <>
      <div className="flex items-center gap-2 text-2xs text-ink-3" dir="ltr">
        <button type="button" onClick={() => clock.toggle()} aria-label={clock.playing ? 'مکث' : 'پخش'} className="grid size-7 place-items-center rounded-lg border border-hairline hover:bg-sunken">
          {clock.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <button type="button" onClick={() => clock.restart()} aria-label="از اول" className="grid size-7 place-items-center rounded-lg border border-hairline hover:bg-sunken">
          <RotateCcw className="size-3.5" />
        </button>
        <button type="button" onClick={() => clock.step(-1 / 30)} aria-label="یک قاب عقب" className="grid size-7 place-items-center rounded-lg border border-hairline hover:bg-sunken">
          <SkipBack className="size-3.5" />
        </button>
        <button type="button" onClick={() => clock.step(1 / 30)} aria-label="یک قاب جلو" className="grid size-7 place-items-center rounded-lg border border-hairline hover:bg-sunken">
          <SkipForward className="size-3.5" />
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={t}
          onChange={(e) => clock.seek(Number(e.target.value))}
          aria-label="زمان"
          className="h-1 flex-1 accent-brand"
        />
        <span className="tabular-nums">
          {toFaDigits(t.toFixed(1))} / {toFaDigits(duration.toFixed(1))} ث
        </span>
      </div>
      {reduced ? (
        <p className="text-2xs text-ink-3">به‌دلیل تنظیم «کاهش حرکت» دستگاه، پخش خودکار خاموش است.</p>
      ) : null}
    </>
  )
})

/* ------------------------------------------------------------------ *
 *  Player
 * ------------------------------------------------------------------ */

export type AnimationPlayerProps = {
  anim: Animation2
  /** Presenter mode stops on `pause` cues; the viewer does not. */
  presenter?: boolean
  autoPlay?: boolean
  showTransport?: boolean
  onScrub?: (t: number) => void
  className?: string
}

export function AnimationPlayer({
  anim,
  presenter = false,
  autoPlay,
  showTransport = true,
  onScrub,
  className,
}: AnimationPlayerProps) {
  /**
   * Control readings are local state, not a document edit. A viewer's slider
   * drag must not mark the deck dirty, and must not survive into the next
   * scene — so they start from the declared defaults every mount.
   */
  const [live, setLive] = useState<Record<string, number>>({})
  const overrides = useMemo(() => {
    if (Object.keys(live).length === 0) return undefined
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(live)) out[k] = v
    return out
  }, [live])
  const duration = Math.min(LIMITS.maxDuration, Math.max(LIMITS.minDuration, anim.duration || 6))
  const reduced = useMemo(() => prefersReducedMotion(), [])

  const compiled = useMemo(() => {
    clearGeometryCache()
    try {
      return compileAnimation({ ...anim, schema: ANIM2_SCHEMA })
    } catch (e) {
      console.error('animation failed to compile', e)
      return null
    }
  }, [anim])

  // The clock is state, not a ref: reading a ref during render is what made
  // v1 re-render the studio sixty times a second, and React is right to
  // complain about it.
  const [clock] = useState(() => new Clock({ duration, startAt: anim.playback?.startAt }))
  /**
   * Particles live outside React. Spawning 200 of them must not re-render the
   * scene tree, so the system holds the state and bumps a version counter.
   */
  const runtime = useSceneRuntime(clock, compiled, overrides)
  const particles = runtime.particles

  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    clock.reconfigure({
      duration,
      loop: anim.loop === true,
      speed: (anim.speed ?? 1) * (anim.playback?.rate ?? 1),
      segments: (anim.playback?.segments ?? []).map((s) => ({ from: s.from ?? 0, to: s.to ?? duration })),
      pingPong: anim.playback?.pingPong === true,
      startAt: anim.playback?.startAt,
      stopAt: anim.playback?.stopAt,
      pauses: (anim.cues ?? []).filter((c) => c.pause).map((c) => c.t),
      honourPauses: presenter,
    })
  }, [clock, duration, presenter, anim.loop, anim.speed, anim.playback, anim.cues])

  useEffect(() => () => clock.dispose(), [clock])

  // The runtime owns seeking so edge state and particles reset together.
  const seek = useCallback(
    (time: number) => {
      runtime.seek(time)
      onScrub?.(time)
    },
    [runtime, onScrub],
  )

  // Off screen, stop. A lesson deck can hold a dozen animations and running
  // all of them is pure heat.
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (!e.isIntersecting) clock.pause()
    }, { rootMargin: '160px' })
    io.observe(el)
    return () => io.disconnect()
  }, [clock])

  const wantsAutoPlay = autoPlay ?? anim.autoplay === true
  useEffect(() => {
    // Reduced motion means: no autoplay, and step controls instead.
    if (wantsAutoPlay && !reduced) clock.play()
    else clock.pause()
  }, [clock, wantsAutoPlay, reduced, compiled])

  if (!compiled || error) {
    return (
      <div ref={hostRef} className={className}>
        <div role="alert" className="rounded-xl bg-warn-soft px-3 py-2 text-xs font-bold text-warn">
          انیمیشن قابل نمایش نیست.
        </div>
      </div>
    )
  }

  return (
    <div ref={hostRef} className={cn('space-y-2', className)}>
      <AnimationErrorBoundary onError={setError}>
        <Canvas
          compiled={compiled}
          clock={clock}
          onScrub={seek}
          particles={particles}
          particleVersion={runtime.version}
          overrides={overrides}
        />
      </AnimationErrorBoundary>

      {showTransport ? (
        <>
          <ParamsPanel
            params={compiled.params}
            disabled={reduced || compiled.warnings.length > 0}
            onChange={(name, value) =>
              setLive((prev) => ({ ...prev, [name]: value }))
            }
            onAction={(_name, actions) => runtime.run(actions)}
          />
          <Transport clock={clock} duration={duration} reduced={reduced} />
        </>
      ) : null}

      {compiled.warnings.length > 0 ? (
        <ul className="space-y-0.5 text-2xs text-warn">
          {compiled.warnings.slice(0, 3).map((w, i) => (
            <li key={`${w.nodeId}-${i}`}>
              {w.nodeId}: {w.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
