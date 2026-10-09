import { memo, useMemo, useRef, useState } from 'react'
import type { AnimLayer, AnimPanel, Animation, AnimScene } from '../../types'
import { cn } from '../../lib/utils'
import { evalExpr } from '../../lib/anim/expr'
import {
  animationDuration,
  layerAcceleration,
  layerVelocity,
  lastFinite,
  layerState,
  readout as computeReadout,
  scenePanels,
  seriesLookupOf,
  seriesPath,
  seriesSlope,
  seriesValue,
  ticksFor,
  trailPoints,
  panelTargets,
} from '../../lib/anim/engine'

const VW = 1000

export type PanelScale = {
  id: string
  title?: string
  yMin: number
  yMax: number
  /** view-box y of the panel's top and bottom edge */
  top: number
  bottom: number
  /** data value → view-box y */
  sy: (v: number) => number
  /** view-box y of the zero line, or the panel's bottom edge */
  axisY: number
  ticks: number[]
}

export type SceneScale = {
  vw: number
  vh: number
  /** pixels per scene unit — keeps object sizes consistent after re-framing */
  unit: number
  xMin: number
  xMax: number
  /** data value → view-box x (shared by every panel: one clock, one axis) */
  sx: (v: number) => number
  /** view-box x of the vertical axis */
  axisX: number
  panels: PanelScale[]
  xTicks: number[]
}

/**
 * Scene data → view-box pixels. In `time` mode the horizontal axis is the
 * clock, so it tracks the animation duration automatically.
 *
 * A scene may stack several panels (`x(t)` over `v(t)` over `a(t)`); they
 * share the horizontal scale and differ only in their vertical domain, which
 * is what makes the comparison at a single instant readable.
 */
export function useScale(anim: Animation): SceneScale {
  const { scene } = anim
  const duration = animationDuration(anim)
  const xMin = scene.plotSpace === 'time' ? 0 : scene.xMin
  const xMax = scene.plotSpace === 'time' ? duration : scene.xMax
  const spanX = Math.max(1e-6, xMax - xMin)
  const vh = VW * scene.aspect
  const unit = VW / spanX
  const defs = scenePanels(anim)
  const gap = defs.length > 1 ? (scene.panelGap ?? 14) : 0
  const height = (vh - gap * (defs.length - 1)) / defs.length

  return useMemo(() => {
    const sx = (v: number) => ((v - xMin) / spanX) * VW
    const panels: PanelScale[] = defs.map((p: AnimPanel, i: number) => {
      const top = i * (height + gap)
      const bottom = top + height
      const spanY = Math.max(1e-6, p.yMax - p.yMin)
      const sy = (v: number) => bottom - ((v - p.yMin) / spanY) * height
      return {
        id: p.id,
        title: p.title,
        yMin: p.yMin,
        yMax: p.yMax,
        top,
        bottom,
        sy,
        axisY: p.yMin <= 0 && 0 <= p.yMax ? sy(0) : bottom,
        ticks: ticksFor(p.yMin, p.yMax, p.yTicks ?? scene.yTicks),
      }
    })
    return {
      vw: VW,
      vh,
      unit,
      xMin,
      xMax,
      sx,
      axisX: xMin <= 0 && 0 <= xMax ? sx(0) : 58,
      panels,
      xTicks: ticksFor(xMin, xMax, scene.xTicks),
    }
  }, [defs, height, gap, spanX, unit, vh, xMax, xMin, scene.yTicks, scene.xTicks])
}

const FA = '۰۱۲۳۴۵۶۷۸۹'

/** Compact axis label: 3 significant-ish digits, Persian digits. */
function axisLabel(v: number): string {
  const a = Math.abs(v)
  if (a === 0) return '۰'
  const digits = a >= 100 || Number.isInteger(a) ? 0 : a >= 10 ? 1 : a >= 1 ? 1 : 2
  const s = v.toFixed(digits)
  return s.replace(/-/g, '−').replace(/[0-9]/g, (d) => FA[Number(d)]).replace(/\./g, '٫')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/* ------------------------------------------------------------------ *
 *  Shapes
 * ------------------------------------------------------------------ */

function LayerShape({
  layer,
  x,
  y,
  size,
  rotation,
  opacity,
}: {
  layer: AnimLayer
  x: number
  y: number
  size: number
  rotation: number
  opacity: number
}) {
  const r = Math.max(0.6, size / 2)
  const fill = { fill: layer.color, opacity }
  const stroke = { stroke: 'rgb(0 0 0 / 0.22)', strokeWidth: Math.max(0.6, size * 0.05) }

  let body: React.ReactNode = null
  switch (layer.shape) {
    case 'circle':
      body = <circle r={r} {...fill} {...stroke} />
      break
    case 'ball':
      body = (
        <>
          <circle r={r} {...fill} {...stroke} />
          <circle cx={-r * 0.3} cy={-r * 0.32} r={r * 0.28} fill="white" opacity={opacity * 0.6} />
          <path
            d={`M ${-r} 0 A ${r} ${r} 0 0 0 ${r} 0`}
            fill="none"
            stroke="rgb(0 0 0 / 0.25)"
            strokeWidth={Math.max(0.8, r * 0.16)}
          />
        </>
      )
      break
    case 'square':
      body = <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={r * 0.2} {...fill} {...stroke} />
      break
    case 'triangle':
      body = <polygon points={`0,${-r * 1.15} ${r},${r * 0.75} ${-r},${r * 0.75}`} {...fill} {...stroke} />
      break
    case 'arrow':
      body = <polygon points={`${r * 1.7},0 ${-r * 0.6},${-r * 0.8} ${-r * 0.25},0 ${-r * 0.6},${r * 0.8}`} {...fill} {...stroke} />
      break
    case 'car':
      body = (
        <>
          <rect x={-r} y={-r * 0.5} width={r * 2} height={r * 0.8} rx={r * 0.24} {...fill} {...stroke} />
          <path
            d={`M ${-r * 0.6} ${-r * 0.5} L ${-r * 0.18} ${-r} L ${r * 0.55} ${-r} L ${r} ${-r * 0.5} Z`}
            fill={layer.color}
            opacity={opacity}
            stroke="rgb(0 0 0 / 0.22)"
            strokeWidth={Math.max(0.6, size * 0.05)}
          />
          <circle cx={-r * 0.5} cy={r * 0.34} r={r * 0.24} fill="rgb(15 23 42 / 0.85)" opacity={opacity} />
          <circle cx={r * 0.5} cy={r * 0.34} r={r * 0.24} fill="rgb(15 23 42 / 0.85)" opacity={opacity} />
        </>
      )
      break
  }

  return (
    <g transform={`translate(${x} ${y}) rotate(${rotation})`}>
      {body}
      {layer.label && (
        <text
          y={-r - Math.max(4, size * 0.28)}
          textAnchor="middle"
          fontSize={15}
          fontWeight={800}
          fill="rgb(var(--scene-ink))"
          opacity={opacity}
          style={{ paintOrder: 'stroke', stroke: 'rgb(var(--scene))', strokeWidth: 4 }}
        >
          {layer.label}
        </text>
      )}
    </g>
  )
}

/* ------------------------------------------------------------------ *
 *  Arrows
 *
 *  Every arrow in the app is drawn from one pixel point to another. The
 *  y-axis flip for data space happens in exactly one place — the `sx`/`sy`
 *  maps — so an arrow can never come out mirrored below the axis.
 * ------------------------------------------------------------------ */

type Px = { x: number; y: number }

/**
 * An arrow from pixel point `from` to pixel point `to`, head at `to`.
 * SVG y grows downward, so "up" is a smaller y — the caller's problem, not
 * this component's.
 */
function Arrow({
  from,
  to,
  color,
  label,
  width = 3,
  headScale = 1,
  dashed,
  labelSide = -1,
}: {
  from: Px
  to: Px
  color: string
  label?: string
  width?: number
  /** multiplies the auto head size */
  headScale?: number
  dashed?: boolean
  /** -1 puts the caption above the shaft, +1 below */
  labelSide?: -1 | 1
}) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (!Number.isFinite(len) || len < 7) return null
  const ux = dx / len
  const uy = dy / len
  const head = Math.min(24, Math.max(9, len * 0.3)) * headScale
  const ang = (Math.atan2(uy, ux) * 180) / Math.PI
  const shaftX = to.x - ux * head * 0.78
  const shaftY = to.y - uy * head * 0.78

  return (
    <g>
      <line
        x1={from.x}
        y1={from.y}
        x2={shaftX}
        y2={shaftY}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={dashed ? '8 6' : undefined}
        opacity={0.95}
      />
      {/* the head is a triangle whose tip sits exactly on `to` */}
      <polygon
        points={`0,0 ${-head},${-head * 0.44} ${-head * 0.5},0 ${-head},${head * 0.44}`}
        transform={`translate(${to.x} ${to.y}) rotate(${ang})`}
        fill={color}
        opacity={0.95}
      />
      {label && (
        <text
          x={from.x + ux * len * 0.5 - uy * 12 * labelSide}
          y={from.y + uy * len * 0.5 + ux * 12 * labelSide - (labelSide < 0 ? 4 : 12)}
          fontSize={16}
          fontWeight={800}
          fill={color}
          textAnchor="middle"
          style={{ paintOrder: 'stroke', stroke: 'rgb(var(--scene))', strokeWidth: 5 }}
        >
          {label}
        </text>
      )}
    </g>
  )
}

/**
 * A straight guide drawn between two points in data space, with an optional
 * caption. Used for the secant (average velocity) and tangent (instantaneous
 * velocity) lines.
 */
function GuideLine({
  x1,
  y1,
  x2,
  y2,
  color,
  label,
  dashed,
  labelAt = 0.5,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  label?: string
  dashed?: boolean
  /** where along the line the caption sits, 0..1 */
  labelAt?: number
}) {
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null
  // Keep the caption clear of the curve's own value label.
  const lx = x1 + (x2 - x1) * labelAt
  const ly = y1 + (y2 - y1) * labelAt - (dashed ? 22 : 34)
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2.4} strokeDasharray={dashed ? '9 7' : undefined} opacity={0.95} />
      {label && (
        <text
          x={lx}
          y={ly}
          fontSize={16}
          fontWeight={800}
          fill={color}
          textAnchor="middle"
          style={{ paintOrder: 'stroke', stroke: 'rgb(var(--scene))', strokeWidth: 5 }}
        >
          {label}
        </text>
      )}
    </g>
  )
}

/* ------------------------------------------------------------------ *
 *  Scene
 * ------------------------------------------------------------------ */

export type SceneDragHandlers = {
  /** a layer was grabbed under the cursor */
  onGrab: (layerId: string) => void
  /** pointer moved, in scene units */
  onMove: (x: number, y: number) => void
  /** pointer released */
  onRelease: (x: number, y: number) => void
}

export type AnimationSceneProps = {
  anim: Animation
  t: number
  className?: string
  onScrub?: (t: number) => void
  showLegend?: boolean
  /** enables grabbing and dragging objects — the studio's record mode */
  drag?: SceneDragHandlers
  /**
   * Used when the cursor is inside this layer's panel but not on the object:
   * with an object selected in the list, you can then just drop it anywhere.
   */
  fallbackLayerId?: string | null
  /** outlines these layers so a drag target is obvious while recording */
  highlightLayerId?: string | null
}

export const AnimationScene = memo(function AnimationScene({
  anim,
  t,
  className,
  onScrub,
  showLegend = true,
  drag,
  fallbackLayerId,
  highlightLayerId,
}: AnimationSceneProps) {
  const { scene } = anim
  const { sx, vw, vh, panels, axisX, xTicks, xMin, xMax } = useScale(anim)
  const duration = animationDuration(anim)
  const lookup = useMemo(() => seriesLookupOf(anim), [anim])

  const activeSeries = useMemo(() => anim.series.filter((s) => s.visible && s.expr.trim()), [anim.series])
  const activeLayers = useMemo(() => anim.layers.filter((l) => l.visible), [anim.layers])
  const primaryLayer = activeLayers[0]

  const cursorT = Math.min(Math.max(t, 0), duration)

  const padL = 58
  const padR = 22
  const padT = 26
  const padB = 38
  const last = panels.length - 1
  // The clock axis lives on the bottom panel; with a single panel that is
  // exactly where it always was.
  const xAxisY = panels[last]?.axisY ?? vh - padB
  const yTitleY = padT - 16

  const scrubFrom = (clientX: number, el: SVGSVGElement) => {
    if (!onScrub) return
    const rect = el.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    onScrub(Math.max(0, Math.min(1, ratio)) * duration)
  }

  /** client pixels → (view-box px, py) for the panel under the cursor */
  const clientToView = (clientX: number, clientY: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect()
    return {
      px: ((clientX - rect.left) / rect.width) * vw,
      py: ((clientY - rect.top) / rect.height) * vh,
    }
  }

  /** which panel a view-box y falls in */
  const panelAt = (py: number): PanelScale => {
    for (const p of panels) if (py >= p.top && py <= p.bottom) return p
    return py < (panels[0]?.top ?? 0) ? panels[0] : panels[panels.length - 1]
  }

  /** view-box px → scene units, in the panel under the cursor */
  const viewToData = (px: number, py: number) => {
    const p = panelAt(py)
    const height = Math.max(1e-6, p.bottom - p.top)
    return {
      x: xMin + (px / vw) * (xMax - xMin),
      y: p.yMin + ((p.bottom - py) / height) * (p.yMax - p.yMin),
      panel: p,
    }
  }

  /** topmost layer within grabbing distance of the cursor, if any */
  const pickLayer = (px: number, py: number): AnimLayer | null => {
    const st0 = (l: AnimLayer) => layerState(l, cursorT, lookup)
    for (const layer of [...activeLayers].reverse()) {
      const st = st0(layer)
      const reach = Math.max(10, (st.size * (vh / Math.max(1, panels.length))) / 2 + 7)
      for (const pi of panelTargets(panels, layer.panel)) {
        const p = panels[pi]
        if (!p) continue
        if (Math.hypot(px - sx(st.x), py - p.sy(st.y)) <= reach) return layer
      }
    }
    // Nothing under the cursor: if the teacher picked an object in the list,
    // placing it anywhere in its panel counts as grabbing it.
    const fallback = activeLayers.find((l) => l.id === fallbackLayerId)
    if (fallback) {
      for (const pi of panelTargets(panels, fallback.panel)) {
        const p = panels[pi]
        if (p && py >= p.top && py <= p.bottom) return fallback
      }
    }
    return null
  }

  /** keeps the dragged object pinned to the cursor while recording */
  const dragLayerId = useRef<string | null>(null)
  const [grabbed, setGrabbed] = useState<string | null>(null)

  const inPanel = (p: PanelScale, x: number, y: number) =>
    x > -80 && x < vw + 80 && y > p.top - 60 && y < p.bottom + 60

  return (
    <div className={cn('relative isolate overflow-hidden rounded-2xl border border-hairline bg-scene', className)}>
      <svg
        viewBox={`0 0 ${vw} ${vh}`}
        // `pan-y` keeps vertical page scrolling alive on touch; a horizontal
        // drag still lands here and scrubs.
        className={cn('block h-auto w-full touch-pan-y select-none', drag && 'cursor-grab')}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`صحنهٔ انیمیشن در ثانیهٔ ${t.toFixed(2)}`}
        style={{ direction: 'ltr' }}
        tabIndex={onScrub ? 0 : -1}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          if (drag) {
            const { px, py } = clientToView(e.clientX, e.clientY, e.currentTarget)
            const hit = pickLayer(px, py)
            if (hit) {
              dragLayerId.current = hit.id
              setGrabbed(hit.id)
              drag.onGrab(hit.id)
              e.preventDefault()
              return
            }
          }
          if (!onScrub) return
          scrubFrom(e.clientX, e.currentTarget)
        }}
        onPointerMove={(e) => {
          if (dragLayerId.current && drag) {
            const { px, py } = clientToView(e.clientX, e.clientY, e.currentTarget)
            const d = viewToData(px, py)
            drag.onMove(d.x, d.y)
            return
          }
          if (!onScrub || e.buttons === 0) return
          scrubFrom(e.clientX, e.currentTarget)
        }}
        onPointerUp={(e) => {
          if (dragLayerId.current && drag) {
            const { px, py } = clientToView(e.clientX, e.clientY, e.currentTarget)
            const d = viewToData(px, py)
            dragLayerId.current = null
            setGrabbed(null)
            drag.onRelease(d.x, d.y)
            return
          }
          if (!onScrub) return
          scrubFrom(e.clientX, e.currentTarget)
        }}

      >
        <defs>
          <marker id="an-ax" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="rgb(var(--scene-ink))" />
          </marker>
        </defs>

        <rect x={0} y={0} width={vw} height={vh} fill="rgb(var(--scene))" />

        {/* clock gridlines — one column set for the whole scene */}
        {scene.showGrid &&
          xTicks.map((v) => (
            <line key={`gx${v}`} x1={sx(v)} y1={panels[0]?.top ?? padT} x2={sx(v)} y2={panels[last]?.bottom ?? vh} stroke="rgb(var(--scene-grid))" strokeWidth={1} />
          ))}

        {/* per-panel: value grid, axes, ticks, caption */}
        {panels.map((p, pi) => {
          const yLabelsInside = axisX < padL + 8
          const yLabelX = yLabelsInside ? axisX + 9 : axisX - 12
          const yLabelAnchor = yLabelsInside ? 'start' : 'end'
          const clampX = (x: number) => Math.min(Math.max(x, 16), vw - 16)
          const isLast = pi === last
          return (
            <g key={p.id || 'p0'}>
              {scene.showGrid &&
                p.ticks.map((v) => (
                  <line key={`gy${p.id}${v}`} x1={padL} y1={p.sy(v)} x2={vw - padR} y2={p.sy(v)} stroke="rgb(var(--scene-grid))" strokeWidth={1} />
                ))}
              {scene.showAxes && (
                <g>
                  <line
                    x1={Math.min(axisX, vw - padR - 4)}
                    y1={p.axisY}
                    x2={vw - padR}
                    y2={p.axisY}
                    stroke="rgb(var(--scene-ink))"
                    strokeWidth={2.2}
                    markerEnd={isLast ? 'url(#an-ax)' : undefined}
                  />
                  <line
                    x1={axisX}
                    y1={Math.min(p.axisY, p.bottom - 4)}
                    x2={axisX}
                    y2={p.top + 10}
                    stroke="rgb(var(--scene-ink))"
                    strokeWidth={2.2}
                    markerEnd="url(#an-ax)"
                  />
                  {p.ticks.map((v) => (
                    <g key={`yt${p.id}${v}`}>
                      <line
                        x1={yLabelsInside ? axisX : axisX - 8}
                        y1={p.sy(v)}
                        x2={yLabelsInside ? axisX + 8 : axisX}
                        y2={p.sy(v)}
                        stroke="rgb(var(--scene-ink))"
                        strokeWidth={1.6}
                      />
                      {Math.abs(p.sy(v) + 6 - yTitleY) > 15 && (
                        <text x={yLabelX} y={p.sy(v) + 6} fontSize={17} fontWeight={700} fill="rgb(var(--scene-ink))" textAnchor={yLabelAnchor} opacity={0.7}>
                          {axisLabel(v)}
                        </text>
                      )}
                    </g>
                  ))}
                  {isLast && (
                    <>
                      {xTicks.map((v) => (
                        <g key={`xt${v}`}>
                          <line x1={sx(v)} y1={p.axisY} x2={sx(v)} y2={p.axisY + 8} stroke="rgb(var(--scene-ink))" strokeWidth={1.6} />
                          <text x={clampX(sx(v))} y={p.axisY + 26} fontSize={17} fontWeight={700} fill="rgb(var(--scene-ink))" textAnchor="middle" opacity={0.7}>
                            {axisLabel(v)}
                          </text>
                        </g>
                      ))}
                      <text
                        x={vw - padR}
                        y={Math.max(12, xAxisY - 12)}
                        fontSize={19}
                        fontWeight={800}
                        fill="rgb(var(--scene-ink))"
                        textAnchor="end"
                        style={{ paintOrder: 'stroke', stroke: 'rgb(var(--scene))', strokeWidth: 5 }}
                      >
                        {scene.xLabel}
                      </text>
                    </>
                  )}
                  {p.title && (
                    <text
                      x={4}
                      y={p.top + 14}
                      fontSize={17}
                      fontWeight={800}
                      fill="rgb(var(--scene-ink))"
                      style={{ paintOrder: 'stroke', stroke: 'rgb(var(--scene))', strokeWidth: 5 }}
                    >
                      {p.title}
                    </text>
                  )}
                </g>
              )}
            </g>
          )
        })}

        {/* playhead — only meaningful when the horizontal axis *is* time */}
        {scene.showAxes && scene.plotSpace === 'time' && activeSeries.length > 0 && (
          <line
            x1={sx(cursorT)}
            y1={panels[0]?.top ?? padT}
            x2={sx(cursorT)}
            y2={panels[last]?.bottom ?? vh}
            stroke="rgb(var(--scene-ink) / 0.3)"
            strokeWidth={1.5}
            strokeDasharray="6 7"
          />
        )}

        {/* curves */}
        {activeSeries.map((s) => {
          const targets = panelTargets(panels, s.panel)
          const to = s.reveal ? cursorT : duration
          const dotEvery = duration / 24
          return (
            <g key={s.id}>
              {targets.map((pi) => {
                const p = panels[pi]
                if (!p) return null
                const d = seriesPath(s, 0, to, sx, p.sy)
                if (!d) return null
                const head = s.reveal ? lastFinite(s, to) : NaN
                const v0 = seriesValue(s, 0)
                return (
                  <g key={p.id || 'p0'}>
                    {s.style === 'fill' && (
                      <path
                        d={`${d} L ${sx(to).toFixed(2)} ${p.sy(p.yMin).toFixed(2)} L ${sx(0).toFixed(2)} ${p.sy(p.yMin).toFixed(2)} Z`}
                        fill={s.color}
                        opacity={0.15}
                      />
                    )}
                    {s.style === 'dots' &&
                      Array.from({ length: 25 }, (_, i) => {
                        const tt = i * dotEvery
                        const yy = seriesValue(s, tt)
                        return Number.isFinite(yy) ? <circle key={i} cx={sx(tt)} cy={p.sy(yy)} r={4.5} fill={s.color} /> : null
                      })}
                    <path
                      d={d}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={3.4}
                      strokeLinecap="round"
                      strokeDasharray={s.style === 'dashed' ? '11 9' : undefined}
                    />
                    {Number.isFinite(head) && (
                      <g>
                        <line x1={sx(to)} y1={p.sy(head)} x2={sx(to)} y2={p.sy(p.yMin)} stroke={s.color} strokeWidth={1.3} opacity={0.35} />
                        <circle cx={sx(to)} cy={p.sy(head)} r={7.5} fill={s.color} stroke="rgb(var(--scene))" strokeWidth={2.5} />
                        <text x={sx(to)} y={p.sy(head) - 13} fontSize={16} fontWeight={800} fill={s.color} textAnchor="middle">
                          {axisLabel(head)}
                        </text>
                      </g>
                    )}

                    {/* Chord over the averaging window: its slope is the average
                        velocity over Δt. Shrinking Δt lands it on the tangent. */}
                    {s.window != null && cursorT > 0.01 && (
                      (() => {
                        const raw = typeof s.window === 'string' ? evalExpr(s.window, cursorT, 0) : s.window
                        const w = Math.min(raw, cursorT)
                        if (!(w > 0.001)) return null
                        const va = seriesValue(s, cursorT - w)
                        const vb = head
                        if (!Number.isFinite(va) || !Number.isFinite(vb)) return null
                        const m = (vb - va) / w
                        return (
                          <GuideLine
                            x1={sx(cursorT - w)}
                            y1={p.sy(va)}
                            x2={sx(cursorT)}
                            y2={p.sy(vb)}
                            color={s.color}
                            label={`v̄ = ${axisLabel(round2(m))}`}
                            dashed
                            labelAt={0.5}
                          />
                        )
                      })()
                    )}

                    {/* Chord from t=0 to now — its slope is the average velocity. */}
                    {s.secant && cursorT > 0.01 && Number.isFinite(v0) && (
                      <GuideLine
                        x1={sx(0)}
                        y1={p.sy(v0)}
                        x2={sx(cursorT)}
                        y2={p.sy(head)}
                        color={s.color}
                        label="v̄"
                        dashed
                        labelAt={0.28}
                      />
                    )}

                    {/* Tangent at the playhead — its slope is the instantaneous velocity. */}
                    {s.tangent &&
                      (() => {
                        const m = seriesSlope(s, cursorT)
                        if (!Number.isFinite(m) || !Number.isFinite(head)) return null
                        const span = (duration - cursorT) * 0.85
                        return (
                          <GuideLine
                            x1={sx(cursorT - span)}
                            y1={p.sy(head - m * span)}
                            x2={sx(cursorT + span)}
                            y2={p.sy(head + m * span)}
                            color={s.color}
                            label={`v = ${axisLabel(round2(m))}`}
                            labelAt={0.78}
                          />
                        )
                      })()}
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* objects */}
        {activeLayers.map((layer) => {
          const st = layerState(layer, cursorT, lookup)
          const v = layerVelocity(layer, cursorT, lookup)
          const a = layerAcceleration(layer, cursorT, lookup)
          const vecScale = layer.vectors?.scale ?? layer.vectorScale
          const targets = panelTargets(panels, layer.panel)
          return (
            <g key={layer.id}>
              {targets.map((pi) => {
                const p = panels[pi]
                if (!p) return null
                const px = sx(st.x)
                const py = p.sy(st.y)
                // Size is a fraction of the panel's own height, so an object
                // keeps its proportions whether it rides a 90px strip or a
                // 600px plot — and stays visible in a stacked x/v/a view.
                const sizePx = Math.max(2, st.size * (p.bottom - p.top))
                const r = Math.max(3, sizePx / 2)
                const inside = inPanel(p, px, py)
                const opacity = inside ? 1 : 0.12
                const pv = layer.positionVector
                const showV = layer.vectors?.velocity ?? layer.showVelocity
                const showA = layer.vectors?.acceleration ?? layer.showAcceleration
                // Arrows are drawn on top of the object and start at its
                // centre: an arrow shorter than the object used to vanish
                // underneath it.
                const centre: Px = { x: px, y: py }
                return (
                  <g key={p.id || 'p0'}>
                    {layer.showTrail && (
                      <polyline
                        points={trailPoints(layer, cursorT, lookup)
                          .map((q) => `${sx(q.x).toFixed(1)},${p.sy(q.y).toFixed(1)}`)
                          .join(' ')}
                        fill="none"
                        stroke={layer.color}
                        strokeWidth={2.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.36}
                        strokeDasharray={layer.mode === 'key' ? undefined : '8 7'}
                      />
                    )}

                    <LayerShape layer={layer} x={px} y={py} size={sizePx} rotation={st.rotation} opacity={opacity} />

                    {/* position vector: origin (or a fixed anchor) → object */}
                    {pv && pv.visible !== false && (
                      <Arrow
                        from={(() => {
                          const a2 = pv.from === 'origin' || !pv.from ? { x: 0, y: 0 } : pv.from
                          return { x: sx(a2.x), y: p.sy(a2.y) }
                        })()}
                        to={{ x: px, y: py }}
                        color={pv.color ?? layer.color}
                        label={pv.label ?? 'r'}
                        dashed={pv.dashed}
                        width={2.6}
                      />
                    )}

                    {showV && (
                      <Arrow
                        from={centre}
                        to={{ x: px + v.x * vecScale, y: py - v.y * vecScale }}
                        color={layer.color}
                        label="v"
                      />
                    )}
                    {showA && (
                      <Arrow
                        from={centre}
                        to={{ x: px + a.x * vecScale * 0.6, y: py - a.y * vecScale * 0.6 }}
                        color="#0f172a"
                        label="a"
                        width={2.8}
                        headScale={0.9}
                        labelSide={1}
                      />
                    )}
                    {/* a = a_t + a_n — the spiral decomposition */}
                    {layer.vectors?.decomposition && (
                      (() => {
                        const sp = Math.hypot(v.x, v.y)
                        if (sp < 1e-6) return null
                        const ux = v.x / sp
                        const uy = v.y / sp
                        const at = a.x * ux + a.y * uy
                        const ax = at * ux
                        const ay = at * uy
                        const nx = a.x - ax
                        const ny = a.y - ay
                        return (
                          <>
                            <Arrow from={centre} to={{ x: px + ax * vecScale * 0.6, y: py - ay * vecScale * 0.6 }} color="#0d9488" label="aₜ" width={2.8} headScale={0.9} labelSide={1} />
                            <Arrow from={centre} to={{ x: px + nx * vecScale * 0.6, y: py - ny * vecScale * 0.6 }} color="#db2777" label="aₙ" width={2.8} headScale={0.9} labelSide={1} />
                          </>
                        )
                      })()
                    )}

                    {(highlightLayerId === layer.id || grabbed === layer.id) && (
                      <circle
                        cx={px}
                        cy={py}
                        r={Math.max(10, r + 7)}
                        fill="none"
                        stroke="rgb(var(--brand))"
                        strokeWidth={2.4}
                        strokeDasharray="5 5"
                        opacity={0.85}
                      />
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>

      {showLegend && activeSeries.length > 0 && (
        // The axis title owns the top-start corner; with stacked panels the
        // legend moves to the bottom so it cannot cover a plot.
        <div
          className={cn(
            'pointer-events-none absolute end-2 flex max-w-[70%] flex-wrap justify-end gap-1',
            panels.length > 1 ? 'bottom-2' : 'top-8',
          )}
        >
          {activeSeries.map((s) => (
            <span
              key={s.id}
              className="rounded-full border border-hairline bg-scene/90 px-2 py-0.5 text-2xs font-bold backdrop-blur"
              style={{ color: s.color }}
              dir="auto"
            >
              {s.label || s.expr}
            </span>
          ))}
        </div>
      )}

      {anim.readout && primaryLayer && <ReadoutPanel layer={primaryLayer} t={cursorT} lookup={lookup} />}
    </div>
  )
})

function ReadoutPanel({
  layer,
  t,
  lookup,
}: {
  layer: AnimLayer
  t: number
  lookup: (id: string, t: number) => number | undefined
}) {
  const r = useMemo(() => computeReadout(layer, t, lookup), [layer, t, lookup])
  const rows: [string, string][] = [
    ['x', axisLabel(r.x)],
    ['y', axisLabel(r.y)],
    ['vx', axisLabel(r.vx)],
    ['vy', axisLabel(r.vy)],
    ['|v|', axisLabel(r.speed)],
    ['ax', axisLabel(r.ax)],
  ]
  return (
    <div className="pointer-events-none absolute start-2 top-2 rounded-xl border border-hairline bg-scene/92 px-2.5 py-1.5 backdrop-blur">
      <div className="mb-1 text-2xs font-black" style={{ color: layer.color }}>
        {layer.name || 'جسم'}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 text-2xs tabular-nums">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-bold text-scene-ink/60">{k}</dt>
            <dd className="font-black text-scene-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export { axisLabel as formatAxisValue }
export type { AnimScene }