/**
 * The v2 renderer.
 *
 * Split into small pieces on purpose: a scene with 200 nodes re-renders every
 * frame, and a single monolithic component would re-derive every path every
 * time. Instead, geometry that cannot change with the clock — plot polylines
 * for a curve drawn in the axis variable, arrow heads, grids — is computed
 * once and cached against the compiled hash plus the view size. Only nodes
 * that actually depend on time are recomputed per frame.
 */

'use client'

import { memo, useMemo, type ReactNode } from 'react'
import type { ResolvedNode } from '../../lib/anim2/engine'
import { plotPoints } from '../../lib/anim2/engine'
import type { Frame, View } from './geometry'
import { makeFrame, pointsToD, smoothStroke, tickLabel, ticksFor } from './geometry'

/* ------------------------------------------------------------------ *
 *  Geometry cache
 * ------------------------------------------------------------------ */

type CacheEntry = { key: string; d: string }
const geometryCache = new Map<string, CacheEntry>()
const GEOMETRY_CACHE_LIMIT = 400

/**
 * A plot's path, cached by node identity plus compiled hash and scale.
 *
 * A traveling wave depends on `t` and so is recomputed every frame; a curve
 * drawn in `x` does not, and recomputing 200 samples of `sin(x)` sixty times
 * a second is exactly the kind of waste this file exists to avoid.
 */
function cachedPath(key: string, compute: () => string): string {
  const hit = geometryCache.get(key)
  if (hit && hit.key === key) return hit.d
  const d = compute()
  if (geometryCache.size >= GEOMETRY_CACHE_LIMIT) {
    const oldest = geometryCache.keys().next().value
    if (oldest !== undefined) geometryCache.delete(oldest)
  }
  geometryCache.set(key, { key, d })
  return d
}

const parseGeometry = (raw: string): { d: string; dots: string } => {
  try {
    const parsed = JSON.parse(raw) as { d?: string; dots?: string }
    return { d: parsed.d ?? '', dots: parsed.dots ?? '' }
  } catch {
    return { d: raw, dots: '' }
  }
}

/** Drop every cached path; called when the animation document changes. */
export function clearGeometryCache(): void {
  geometryCache.clear()
}

/* ------------------------------------------------------------------ *
 *  Shared props
 * ------------------------------------------------------------------ */

type InkProps = {
  fill?: string
  stroke?: string
  strokeWidth: number
  dash: number
  trim: number
  opacity: number
}

const ink = (n: ResolvedNode): InkProps => ({
  fill: n.fill,
  stroke: n.stroke,
  strokeWidth: Math.max(0, n.strokeWidth),
  dash: Math.max(0, n.dash),
  trim: Math.min(1, Math.max(0, n.trim)),
  opacity: Math.min(1, Math.max(0, n.opacity)),
})

/**
 * `trim` applied uniformly: every outlined shape is drawn with a normalised
 * path length, so one mechanism reveals a plot, a polygon, an arrow or a
 * rectangle. This is the whole reason `reveal` could stop being a boolean.
 */
const trimAttrs = (p: InkProps): Record<string, string | number> =>
  p.trim >= 0.999 ? {} : { pathLength: 1, strokeDasharray: `${p.trim} 1`, strokeDashoffset: 0 }

/* ------------------------------------------------------------------ *
 *  Shapes
 * ------------------------------------------------------------------ */

const Shape = memo(function Shape({ node, frame }: { node: ResolvedNode; frame: Frame }) {
  const p = ink(node)
  const x = frame.sx(node.x)
  const y = frame.sy(node.y)

  switch (node.type) {
    case 'rect':
      return (
        <rect
          x={x - (node.shape.w ?? 10) / 2}
          y={y - (node.shape.h ?? 10) / 2}
          width={node.shape.w ?? 10}
          height={node.shape.h ?? 10}
          rx={node.shape.rx ?? 0}
          {...p}
          {...trimAttrs(p)}
        />
      )

    case 'ellipse':
      return (
        <ellipse
          cx={x}
          cy={y}
          rx={node.shape.rx ?? 5}
          ry={node.shape.ry ?? 5}
          {...p}
          {...trimAttrs(p)}
        />
      )

    case 'line':
      return <LineShape node={node} frame={frame} p={p} />

    case 'path':
      return <PathShape node={node} frame={frame} p={p} />

    case 'image':
      return (
        <image
          href={node.raw.type === 'image' ? node.raw.href : ''}
          x={x - (node.shape.w ?? 10) / 2}
          y={y - (node.shape.h ?? 10) / 2}
          width={node.shape.w ?? 10}
          height={node.shape.h ?? 10}
          opacity={p.opacity}
          preserveAspectRatio="xMidYMid meet"
        />
      )

    default:
      return null
  }
})

/**
 * A line runs from its transform to a point `length` away at `rotation`
 * degrees, in the direction the angle suggests. Both ends can carry an arrow.
 */
const LineShape = memo(function LineShape({
  node,
  frame,
  p,
}: {
  node: ResolvedNode
  frame: Frame
  p: InkProps
}) {
  const length = node.shape.length ?? 10
  const angle = ((node.rotation ?? 0) * Math.PI) / 180
  const ax = frame.sx(node.x)
  const ay = frame.sy(node.y)
  const bx = ax + length * Math.cos(angle)
  const by = ay - length * Math.sin(angle)

  const head = node.raw.type === 'line' ? node.raw.arrowHead : undefined
  const size = node.shape.arrowSize ?? 8

  return (
    <g opacity={p.opacity}>
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        stroke={p.stroke ?? 'none'}
        strokeWidth={p.strokeWidth}
        strokeDasharray={p.dash > 0 ? p.dash : undefined}
        strokeLinecap="round"
      />
      {p.trim < 0.999 && p.stroke ? (
        <line
          x1={ax}
          y1={ay}
          x2={ax + length * p.trim * Math.cos(angle)}
          y2={ay - length * p.trim * Math.sin(angle)}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          strokeLinecap="round"
        />
      ) : null}
      {head?.start ? <ArrowHead x={ax} y={ay} angle={angle + Math.PI} size={size} colour={p.stroke ?? '#111'} /> : null}
      {head?.end ? <ArrowHead x={bx} y={by} angle={angle} size={size} colour={p.stroke ?? '#111'} /> : null}
    </g>
  )
})

const ArrowHead = memo(function ArrowHead({
  x,
  y,
  angle,
  size,
  colour,
}: {
  x: number
  y: number
  angle: number
  size: number
  colour: string
}) {
  const s = Math.max(2, size)
  const spread = 0.42
  const a1 = angle + Math.PI - spread
  const a2 = angle + Math.PI + spread
  return (
    <polygon
      points={`${round(x)},${round(y)} ${round(x + s * Math.cos(a1))},${round(y - s * Math.sin(a1))} ${round(x + s * Math.cos(a2))},${round(y - s * Math.sin(a2))}`}
      fill={colour}
    />
  )
})

const PathShape = memo(function PathShape({
  node,
  frame,
  p,
}: {
  node: ResolvedNode
  frame: Frame
  p: InkProps
}) {
  const raw = node.raw as { points?: [number, number][]; closed?: boolean }
  const d = useMemo(() => {
    if (!raw.points?.length) return ''
    const mapped = raw.points.map(([x, y]) => [frame.sx(x), frame.sy(y)] as [number, number])
    return pointsToD(mapped, raw.closed === true)
  }, [raw.points, raw.closed, frame])
  if (!d) return null
  return (
    <path
      d={d}
      {...p}
      {...trimAttrs(p)}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
})

/* ------------------------------------------------------------------ *
 *  Plot
 * ------------------------------------------------------------------ */

const Plot = memo(function Plot({
  node,
  frame,
  hash,
  t,
  params,
}: {
  node: ResolvedNode
  frame: Frame
  hash: string
  t: number
  params: Record<string, number>
}) {
  const p = ink(node)
  const compiled = node.plot
  if (!compiled) return null

  // Cached against the compiled document and the scale, so scrubbing time
  // does not re-sample a curve that does not depend on it.
  // A curve drawn in `x` is cached by document and scale. One that reads `t` —
  // a traveling wave — has to be re-sampled every frame, so the time is part
  // of its key. This is the difference between 200 wasted trig evaluations
  // per frame and none.
  const timeKey =
    compiled.expr?.timeDependent || compiled.parametric?.x.timeDependent || compiled.parametric?.y.timeDependent
      ? `:${t.toFixed(4)}`
      : ''
  const cacheKey = `${node.id}:${hash}${timeKey}:${round(frame.box.x)},${round(frame.box.y)},${round(frame.box.w)},${round(frame.box.h)}`
  const built = cachedPath(cacheKey, () => {
    const pts = plotPoints(compiled, t, params)
    const mapped = pts.map(([x, y]) => [frame.sx(x), frame.sy(y)] as [number, number])
    return JSON.stringify({ d: smoothStroke(mapped, false), dots: mapped.map(([x, y]) => `${round(x)},${round(y)}`).join(' ') })
  })
  const { d, dots } = parseGeometry(built)

  const draw = (node.raw as { draw?: string }).draw ?? 'line'
  if (!d && !dots) return null

  if (draw === 'dots') {
    return (
      <g opacity={p.opacity}>
        {p.trim < 0.999 ? null : (
          <polyline points={dots} fill="none" stroke={p.stroke ?? '#111'} strokeWidth={p.strokeWidth * 2.4} strokeLinecap="round" opacity={0.5} />
        )}
      </g>
    )
  }

  if (draw === 'fill') {
    const mapped = d ? d : ''
    return (
      <path
        d={mapped}
        fill={p.fill ?? p.stroke ?? '#111'}
        fillOpacity={0.18}
        stroke="none"
        opacity={p.opacity}
      />
    )
  }

  return (
    <path
      d={d}
      fill="none"
      stroke={p.stroke ?? '#111'}
      strokeWidth={p.strokeWidth}
      strokeDasharray={draw === 'dashed' ? `${Math.max(4, p.strokeWidth * 3)} ${Math.max(3, p.strokeWidth * 2)}` : p.dash > 0 ? p.dash : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={p.opacity}
      {...trimAttrs(p)}
    />
  )
})

/* ------------------------------------------------------------------ *
 *  Text
 * ------------------------------------------------------------------ */

const Label = memo(function Label({
  node,
  frame,
  textScale,
}: {
  node: ResolvedNode
  frame: Frame
  textScale: number
}) {
  const text = node.text
  if (!text) return null
  const raw = node.raw as { anchor?: string; latex?: boolean }
  // Scene units are not pixels. A label drawn at 14 units inside a half-width
  // block is 7 real pixels and unreadable, so the size is raised to whatever
  // keeps it at least 12 on screen.
  const wanted = (node.shape.fontSize ?? 14) / Math.max(0.05, textScale)
  const size = Math.max(wanted, 12 / Math.max(0.05, textScale))
  const x = frame.sx(node.x)
  const y = frame.sy(node.y)
  const anchor = raw.anchor === 'middle' ? 'middle' : raw.anchor === 'end' ? 'end' : 'start'
  const dx = anchor === 'middle' ? 0 : anchor === 'end' ? -size * 0.35 : size * 0.35

  return (
    <text
      x={x + dx}
      y={y - size * 0.35}
      fontSize={size}
      fontWeight={700}
      textAnchor={anchor}
      fill={(node.fill ?? 'rgb(var(--scene-ink))') as string}
      opacity={node.opacity}
      direction="ltr"
      style={{ paintOrder: 'stroke', stroke: 'rgb(var(--scene))', strokeWidth: Math.max(2, size * 0.18) }}
    >
      {text}
    </text>
  )
})

/* ------------------------------------------------------------------ *
 *  Axes
 * ------------------------------------------------------------------ */

const AxesFrame = memo(function AxesFrame({
  frame,
  labels,
}: {
  frame: Frame
  labels?: { x?: string; y?: string }
}) {
  const { box } = frame
  const { xDomain, yDomain } = frame
  const xTicks = useMemo(() => ticksFor(xDomain, 7), [xDomain])
  const yTicks = useMemo(() => ticksFor(yDomain, 5), [yDomain])
  /**
   * One unit for ticks, text and labels. Sized off the box so a small panel
   * gets small furniture — an earlier divisor here produced 40-unit numerals,
   * which is about twice the height of the whole axis.
   */
  const unit = Math.max(0.8, Math.min(box.w, box.h) / 55)

  return (
    <g aria-hidden="true">
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        fill="none"
        stroke="rgb(var(--scene-ink) / 0.18)"
        strokeWidth={unit * 0.3}
      />
      {xTicks.map((v) => (
        <g key={`x${v}`}>
          <line
            x1={frame.sx(v)}
            y1={box.y + box.h}
            x2={frame.sx(v)}
            y2={box.y + box.h + unit * 1.4}
            stroke="rgb(var(--scene-ink))"
            strokeWidth={unit * 0.3}
          />
          <text
            x={frame.sx(v)}
            y={box.y + box.h + unit * 3.4}
            fontSize={unit * 1.7}
            textAnchor="middle"
            direction="ltr"
            fill="rgb(var(--scene-ink) / 0.7)"
          >
            {tickLabel(v)}
          </text>
        </g>
      ))}
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line
            x1={box.x}
            y1={frame.sy(v)}
            x2={box.x - unit * 1.4}
            y2={frame.sy(v)}
            stroke="rgb(var(--scene-ink))"
            strokeWidth={unit * 0.3}
          />
          <text
            x={box.x - unit * 2.4}
            y={frame.sy(v)}
            fontSize={unit * 1.7}
            textAnchor="middle"
            dominantBaseline="middle"
            direction="ltr"
            fill="rgb(var(--scene-ink) / 0.7)"
          >
            {tickLabel(v)}
          </text>
        </g>
      ))}
      <line x1={box.x} y1={box.y + box.h} x2={box.x + box.w} y2={box.y + box.h} stroke="rgb(var(--scene-ink))" strokeWidth={unit * 0.5} />
      <line x1={box.x} y1={box.y + box.h} x2={box.x} y2={box.y} stroke="rgb(var(--scene-ink))" strokeWidth={unit * 0.5} />
      {labels?.x ? (
        <text
          x={box.x + box.w}
          y={box.y + box.h + unit * 5.4}
          fontSize={unit * 1.9}
          textAnchor="end"
          direction="ltr"
          fill="rgb(var(--scene-ink) / 0.85)"
        >
          {labels.x}
        </text>
      ) : null}
      {labels?.y ? (
        <text
          x={box.x}
          y={box.y - unit * 1.6}
          fontSize={unit * 1.9}
          textAnchor="start"
          direction="ltr"
          fill="rgb(var(--scene-ink) / 0.85)"
        >
          {labels.y}
        </text>
      ) : null}
    </g>
  )
})

/* ------------------------------------------------------------------ *
 *  Tree walk
 * ------------------------------------------------------------------ */

export type RenderContext = {
  frame: Frame
  free: Frame
  hash: string
  t: number
  params: Record<string, number>
  textScale: number
}

export function renderNodes(nodes: ResolvedNode[], ctx: RenderContext): ReactNode[] {
  const out: ReactNode[] = []
  for (const node of nodes) out.push(renderNode(node, ctx, null))
  return out
}

/**
 * One node. A node inside an `axes` node is positioned in that node's data
 * units; outside one, it is in scene units. That single decision is what
 * replaced `plotSpace` and the panel machinery.
 */
export function renderNode(node: ResolvedNode, ctx: RenderContext, parent: Frame | null): ReactNode {
  if (!node.live) return null
  const frame = parent ?? ctx.free

  const transform =
    node.rotation !== 0
      ? `rotate(${-node.rotation} ${round(frame.sx(node.x))} ${round(frame.sy(node.y))})`
      : undefined

  const scaled =
    node.scaleX !== 1 || node.scaleY !== 1
      ? `translate(${round(frame.sx(node.x))} ${round(frame.sy(node.y))}) scale(${node.scaleX} ${-node.scaleY}) translate(${-round(frame.sx(node.x))} ${-round(frame.sy(node.y))})`
      : undefined

  const wrap = (children: ReactNode): ReactNode => (
    <g key={node.id} transform={[transform, scaled].filter(Boolean).join(' ') || undefined}>{children}</g>
  )

  switch (node.type) {
    case 'axes': {
      const axes = (node.raw as {
        axes?: {
          xDomain: [number, number]
          yDomain: [number, number]
          rect?: [number, number, number, number]
          labels?: { x?: string; y?: string }
        }
      }).axes
      if (!axes) return null
      // `rect` is a fraction of the *parent* box. Ignoring it made every axes
      // node fill the whole scene, which drew tick labels outside the view box
      // and made stacked panels impossible.
      const r = axes.rect ?? [0, 0, 1, 1]
      const box = {
        x: frame.box.x + r[0] * frame.box.w,
        y: frame.box.y + r[1] * frame.box.h,
        w: Math.max(0, r[2] * frame.box.w),
        h: Math.max(0, r[3] * frame.box.h),
      }
      const child = makeFrame(box, axes.xDomain, axes.yDomain)
      return wrap(
        <>
          <AxesFrame frame={child} labels={axes.labels} />
          {node.children.map((c) => renderNode(c, ctx, child))}
        </>,
      )
    }

    case 'group':
      return wrap(node.children.map((c) => renderNode(c, ctx, frame)))

    case 'plot':
      return wrap(<Plot node={node} frame={frame} hash={ctx.hash} t={ctx.t} params={ctx.params} />)

    case 'text':
      return wrap(<Label node={node} frame={frame} textScale={ctx.textScale} />)

    default:
      return wrap(<Shape node={node} frame={frame} />)
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

export type { View }