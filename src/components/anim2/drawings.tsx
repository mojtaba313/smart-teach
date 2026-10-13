/**
 * SVG for `Animation2.drawings`.
 *
 * The layer sits *under* the nodes so a force arrow reads as annotation on top
 * of the physics rather than as another object in it. Points arrive already
 * resolved but still in scene units, so `map` carries them into whatever frame
 * the enclosing `axes` established — the same contract the particles use.
 */

'use client'

import { memo } from 'react'
import type { Pt, ResolvedDrawing } from '../../lib/anim2/drawings'
import type { Frame } from './geometry'
import type { ArrowDrawing, DimensionDrawing, LabelDrawing, ProtractorDrawing } from '../../types/anim2'
import {
  arcPath,
  arrowHead,
  dimensionGeometry,
  distance,
  headFor,
  midpoint,
  protractorTicks,
} from '../../lib/anim2/drawings'



function Arrow({ d, at }: { d: ResolvedDrawing<ArrowDrawing>; at: (p: Pt) => Pt }) {
  const from = at(d.points.from)
  const to = at(d.points.to)
  const st = d.style
  const sag = d.nums.curvature * distance(from, to) * 0.25
  const heads: string[] = []
  if (st.head === 'end' || st.head === 'both') {
    const h = headFor('end', from, to, sag)
    if (h) heads.push(arrowHead(h.tip, h.dir, st.headSize))
  }
  if (st.head === 'start' || st.head === 'both') {
    const h = headFor('start', from, to, sag)
    if (h) heads.push(arrowHead(h.tip, h.dir, st.headSize))
  }
  return (
    <g data-drawing={d.id} opacity={st.opacity}>
      {sag === 0 ? (
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={st.stroke} strokeWidth={st.width} strokeDasharray={st.dashed ? `${st.width * 3} ${st.width * 2}` : undefined} />
      ) : (
        <path d={arcPath(from, to, sag)} fill="none" stroke={st.stroke} strokeWidth={st.width} strokeDasharray={st.dashed ? `${st.width * 3} ${st.width * 2}` : undefined} />
      )}
      {heads.map((h, i) => (
        <path key={i} d={h} fill={st.stroke} />
      ))}
      {d.label ? <Annotation x={at(d.points.mid).x} y={at(d.points.mid).y} text={d.label} fill={st.stroke} size={14} /> : null}
    </g>
  )
}

function Dimension({ d, at, k }: { d: ResolvedDrawing<DimensionDrawing>; at: (p: Pt) => Pt; k: number }) {
  const st = d.style
  const g = dimensionGeometry(at(d.points.from), at(d.points.to), d.nums.offset * k)
  const dir = { x: g.measure[1].x - g.measure[0].x, y: g.measure[1].y - g.measure[0].y }
  const heads = [arrowHead(g.measure[0], { x: -dir.x, y: -dir.y }, st.headSize), arrowHead(g.measure[1], dir, st.headSize)].filter(
    () => st.head !== 'none',
  )
  const label = d.label ?? ''
  return (
    <g data-drawing={d.id} opacity={st.opacity} stroke={st.stroke} strokeWidth={st.width} fill="none">
      <line x1={g.witness[0].x} y1={g.witness[0].y} x2={g.witness[1].x} y2={g.witness[1].y} strokeWidth={st.width * 0.7} />
      <line x1={at(d.points.from).x} y1={at(d.points.from).y} x2={g.witness[0].x} y2={g.witness[0].y} strokeWidth={st.width * 0.7} />
      <line x1={at(d.points.to).x} y1={at(d.points.to).y} x2={g.witness[1].x} y2={g.witness[1].y} strokeWidth={st.width * 0.7} />
      <line x1={g.measure[0].x} y1={g.measure[0].y} x2={g.measure[1].x} y2={g.measure[1].y} />
      {heads.map((h, i) => (
        <path key={i} d={h} fill={st.stroke} stroke="none" />
      ))}
      {label ? (
        <g>
          {/* Swapping in a minus flips the sign of the whole offset vector. */}
          <Annotation
            x={midpoint(g.measure[0], g.measure[1]).x}
            y={midpoint(g.measure[0], g.measure[1]).y}
            text={label}
            fill={st.stroke}
            size={14}
            rotate={-90}
          />
        </g>
      ) : null}
    </g>
  )
}

function Protractor({ d, at, k }: { d: ResolvedDrawing<ProtractorDrawing>; at: (p: Pt) => Pt; k: number }) {
  const st = d.style
  const c = at(d.points.center)
  const r = d.nums.radius * k
  const start = d.nums.startDeg
  const end = d.nums.endDeg
  const tickDeg = d.nums.tickDeg
  const labelEvery = d.nums.labelEvery
  const ticks = protractorTicks(start, end, tickDeg, labelEvery)
  const arc = describeArc(c, r, start, end)
  return (
    <g data-drawing={d.id} opacity={st.opacity} stroke={st.stroke} fill="none" strokeWidth={st.width * 0.8}>
      <path d={arc} />
      {ticks.map((k) => (
        <line
          key={k.deg}
          x1={c.x + k.x * r}
          y1={c.y - k.y * r}
          x2={c.x + k.x * r * (k.major ? 0.9 : 0.95)}
          y2={c.y - k.y * r * (k.major ? 0.9 : 0.95)}
          strokeWidth={k.major ? st.width : st.width * 0.6}
        />
      ))}
      {ticks
        .filter((k) => k.label)
        .map((k) => (
          <text
            key={`l${k.deg}`}
            x={c.x + k.x * r * 0.82}
            y={c.y - k.y * r * 0.82}
            fontSize={r * 0.14}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={st.stroke}
            stroke="none"
          >
            {Math.round(k.deg)}
          </text>
        ))}
    </g>
  )
}

/** Arc path in a y-down coordinate system, where degrees turn clockwise. */
function describeArc(c: { x: number; y: number }, r: number, startDeg: number, endDeg: number): string {
  const a0 = ((startDeg - 90) * Math.PI) / 180
  let sweep = endDeg - startDeg
  while (sweep <= -360) sweep += 360
  while (sweep > 360) sweep -= 360
  const a1 = ((startDeg + sweep - 90) * Math.PI) / 180
  const p0 = { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) }
  const p1 = { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) }
  const large = Math.abs(sweep) > 180 ? 1 : 0
  // Screen y grows downward, so a counter-clockwise sweep in math terms is a
  // negative sweep flag here.
  const dir = sweep >= 0 ? 1 : 0
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} ${dir} ${p1.x} ${p1.y}`
}

function Annotation({
  x,
  y,
  text,
  fill,
  size = 14,
  rotate,
  background,
  padding = 3,
}: {
  x: number
  y: number
  text: string
  fill: string
  size?: number
  rotate?: number
  background?: string
  padding?: number
}) {
  // Rough width: good enough for a backing plate, and it avoids measuring the
  // DOM once per frame.
  const w = text.length * size * 0.55 + padding * 2
  return (
    <g transform={`translate(${x} ${y})${rotate ? ` rotate(${rotate})` : ''}`}>
      {background ? <rect x={-w / 2} y={-size / 2 - padding} width={w} height={size + padding * 2} fill={background} rx={3} /> : null}
      <text textAnchor="middle" dominantBaseline="central" fontSize={size} fill={fill}>
        {text}
      </text>
    </g>
  )
}

function Label({ d, at, resolveText }: {
  d: ResolvedDrawing<LabelDrawing>
  at: (p: Pt) => Pt
  resolveText: (v: LabelDrawing['text']) => string
}) {
  const pos = at(d.points.at)
  const size = d.nums.size
  const text = resolveText(d.text)
  const anchor = d.anchor ?? 'middle'
  const bg = d.background
  return (
    <g data-drawing={d.id} transform={`translate(${pos.x} ${pos.y}) rotate(${d.nums.rotation})`}>
      {bg ? (
        <rect
          x={anchor === 'start' ? 0 : anchor === 'end' ? -text.length * size * 0.55 : (-text.length * size * 0.55) / 2}
          y={-size * 0.8}
          width={text.length * size * 0.55 + 6}
          height={size * 1.5}
          fill={bg}
          rx={3}
        />
      ) : null}
      <text textAnchor={anchor} dominantBaseline={d.baseline ?? 'central'} fontSize={size} fill={d.color ?? d.style.stroke}>
        {text}
      </text>
    </g>
  )
}

export const DrawingLayer = memo(function DrawingLayer({
  drawings,
  frame,
  resolveText,
}: {
  drawings: ResolvedDrawing[]
  /**
   * Drawings are authored in the scene's own coordinates, so they go through
   * the same frame the nodes do. Without it a dimension line drawn from -1 to 1
   * would be two pixels wide on a plot spanning ten units.
   */
  frame: Frame
  resolveText: (v: LabelDrawing['text']) => string
}) {
  if (drawings.length === 0) return null
  const at = (p: Pt): Pt => ({ x: frame.sx(p.x), y: frame.sy(p.y) })
  /**
   * Only *geometric* lengths scale with the axes. Stroke widths, arrow heads
   * and font sizes stay in scene units: a zoomed-in plot should not grow its
   * line weight, and a stroke authored in data units would be 125px thick on a
   * ten-unit axis.
   */
  const k = frame.scale(1)
  return (
    <g aria-hidden="true">
      {drawings.map((d) => {
        switch (d.kind) {
          case 'arrow':
            return <Arrow key={d.id} d={d} at={at} />
          case 'dimension':
            return <Dimension key={d.id} d={d} at={at} k={k} />
          case 'protractor':
            return <Protractor key={d.id} d={d} at={at} k={k} />
          case 'label':
            return <Label key={d.id} d={d} at={at} resolveText={resolveText} />
        }
      })}
    </g>
  )
})