/**
 * The scene, as one SVG.
 *
 * Shared by the player and the studio so there is exactly one renderer. The
 * only difference between them is what sits on top: the studio adds selection
 * chrome and pointer handling, the player adds a transport. The geometry is
 * identical, which means what you drag in the studio is what you see when you
 * present.
 */

'use client'

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SVGProps,
} from 'react'
import type { Animation2 } from '../../types/anim2'
import {
  resolveDrawingLayer,
  valueOf,
  type CompiledAnimation,
  type Frame as EngineFrame,
} from '../../lib/anim2/engine'
import { drawingText } from '../../lib/anim2/drawings'
import type { EvalEnv } from '../../lib/anim2/expr'
import { fracBox, freeFrame, makeFrame, viewFor, type Frame, type View } from './geometry'
import { DrawingLayer } from './drawings'
import { renderNodes } from './nodes'
import { cn } from '../../lib/utils'

/** A sentence a screen reader can actually read. */
/** The environment drawing expressions evaluate in. */
function drawingEnv(compiled: CompiledAnimation, t: number): EvalEnv {
  return {
    t,
    lt: t,
    x: t,
    u: compiled.duration === 0 ? 0 : t / compiled.duration,
    duration: compiled.duration,
    v: valueOf(compiled, t),
  }
}

export function describeScene(anim: Animation2, frame: EngineFrame): string {
  const parts: string[] = []
  if (anim.title) parts.push(anim.title)
  const named = frame.nodes.filter((n) => n.name).slice(0, 6)
  if (named.length) parts.push(named.map((n) => n.name).join('، '))
  const readout = frame.nodes.find((n) => typeof n.text === 'string' && n.text.length > 0)
  if (readout?.text) parts.push(readout.text)
  return parts.join(' — ') || 'صحنهٔ انیمیشن'
}

export type SceneSvgProps = {
  compiled: CompiledAnimation
  frame: EngineFrame
  t: number
  /** Extra nodes drawn last: selection outlines, handles, guides. */
  overlay?: ReactNode
  className?: string
  svgProps?: SVGProps<SVGSVGElement>
  onReady?: (info: { view: View; textScale: number; free: Frame; scene: Frame }) => void
}

/**
 * Measures its own box so text can be sized in real pixels. A 14-unit label
 * inside a half-width block renders at 7 real pixels; this is what stops that.
 */
export const SceneSvg = memo(
  forwardRef<HTMLDivElement, SceneSvgProps>(function SceneSvg(
    { compiled, frame, t, overlay, className, svgProps, onReady },
    ref,
  ) {
    const boxRef = useRef<HTMLDivElement | null>(null)
    const view = useMemo(
      () => viewFor(compiled.anim.scene?.aspect, compiled.anim.scene?.height),
      [compiled.anim.scene?.aspect, compiled.anim.scene?.height],
    )
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
  const drawingLayer = useMemo(() => resolveDrawingLayer(compiled, t), [compiled, t])
  const resolveDrawingText = useCallback(
    (v: Parameters<typeof drawingText>[0]): string => drawingText(v, drawingEnv(compiled, t), { vars: compiled.scope, refIds: compiled.refIds }),
    [compiled, t],
  )
  /**
   * The frame a bare `(x, y)` pair belongs to. Event particles spawn in the
   * scene's own units, so they have to go through the axes when the scene has
   * one — mapping them with the free frame parked them on the origin pixel.
   */
  const scene = useMemo((): Frame => {
    // `type` lives on the *resolved* node, not the compiled one; asking the
    // compiled tree silently finds nothing and everything falls back to the
    // free frame, which parks a value of 2 at the top-left pixel.
    const axes = frame.nodes.find((n) => n.type === 'axes')?.raw as
      | { axes?: { xDomain: [number, number]; yDomain: [number, number]; rect?: [number, number, number, number] } }
      | undefined
    if (!axes?.axes) return free
    const r = axes.axes.rect ?? [0, 0, 1, 1]
    return makeFrame(fracBox(r, view), axes.axes.xDomain, axes.axes.yDomain)
  }, [frame, free, view])
    useEffect(() => {
      onReady?.({ view, textScale, free, scene })
    }, [onReady, view, textScale, free, scene])

    const background = (compiled.anim.scene?.background as string | undefined) ?? 'rgb(var(--scene))'

    return (
      <div ref={(node) => { boxRef.current = node; if (typeof ref === 'function') ref(node) }} className={cn('relative w-full', className)}>
        <svg
          viewBox={`0 0 ${view.width} ${view.height}`}
          className="block w-full touch-pan-y select-none"
          role="img"
          aria-label={describeScene(compiled.anim, frame)}
          style={{ background, aspectRatio: `${view.width} / ${view.height}` }}
          {...svgProps}
        >
          <title>{compiled.anim.title || 'انیمیشن'}</title>
          <desc>{describeScene(compiled.anim, frame)}</desc>
          <DrawingLayer
            drawings={drawingLayer.resolved}
            frame={scene}
            resolveText={resolveDrawingText}
          />
          {renderNodes(frame.nodes, {
            frame: free,
            free,
            hash: compiled.hash,
            t,
            params: {},
            textScale,
          })}
          {overlay}
        </svg>
      </div>
    )
  }),
)