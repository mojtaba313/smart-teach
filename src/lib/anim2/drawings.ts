/**
 * Geometry for `Animation2.drawings`.
 *
 * Everything here is pure and frame-free: it works in the scene's own
 * coordinates and only produces numbers. Turning those numbers into SVG is
 * `components/anim2/drawings.tsx`. Keeping the split means the arrow maths can
 * be unit tested without a DOM, which matters because the interesting cases —
 * a zero-length arrow, a protractor that wraps past 360, a label on a curved
 * shaft — are exactly the ones that break silently.
 */

import type {
  ArrowDrawing,
  DimensionDrawing,
  Drawing,
  DrawPoint,
  DrawStyle,
  LabelDrawing,
  NumProp,
  ProtractorDrawing,
} from '../../types/anim2'
import { LIMITS } from '../../types/anim2'
import type { EvalEnv } from './expr'
import { compileExpr, type Scope } from './expr'

export type Pt = { x: number; y: number }

/**
 * Written out rather than derived with `Required<Pick<...>>`: the raw fields
 * are `NumProp`, and `Required` would leave `headSize` an unevaluated union for
 * the renderer to trip over.
 */
export type ResolvedStyle = {
  stroke: string
  width: number
  opacity: number
  dashed: boolean
  head: 'none' | 'end' | 'start' | 'both'
  headSize: number
}

/**
 * Conditional rather than a plain intersection so the result distributes over
 * the `Drawing` union: `ResolvedDrawing` stays discriminated by `kind`, and
 * `d.curvature` type-checks only on the arrow arm.
 */
export type ResolvedDrawing<T extends Drawing = Drawing> = T extends Drawing
  ? Omit<T, 'style'> & {
      /** Resolved once per frame and reused by the renderer. */
      points: Record<string, Pt>
      /** Scalar fields after evaluation, keyed by their schema name. */
      nums: Record<string, number>
      style: ResolvedStyle
    }
  : never

export type DrawingWarning = { drawingId: string; message: string }

/**
 * Evaluate one drawing field. A bare string is an expression, matching the
 * shorthand every other numeric field in the schema accepts.
 */
const num = (v: NumProp | string | undefined, env: EvalEnv, scope: Scope, fallback = 0): number => {
  if (v === undefined) return fallback
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    try {
      const n = compileExpr(v, scope)(env)
      return Number.isFinite(n) ? n : fallback
    } catch {
      return fallback
    }
  }
  // Keyframes are not accepted here on purpose: a drawing is annotation, and a
  // drawing that changes shape over time wants two drawings with a `time`
  // window, which the timeline can show and this cannot.
  if ('expr' in v) return compileExpr(v.expr, scope)(env)
  return fallback
}

export const drawPoint = (p: DrawPoint | undefined, env: EvalEnv, scope: Scope): Pt => ({
  x: num(p?.x, env, scope),
  y: num(p?.y, env, scope),
})

/**
 * The resolved `style` has to replace the raw one, not intersect with it —
 * a raw `NumProp` width would survive the intersection and leak into the
 * renderer as `number & NumProp`.
 */
const bare = <T extends { style?: DrawStyle }>(d: T): Omit<T, 'style'> => {
  const rest = { ...d }
  delete (rest as { style?: DrawStyle }).style
  return rest
}

const style = (s: DrawStyle | undefined, env: EvalEnv, scope: Scope): ResolvedStyle => ({
  stroke: s?.stroke ?? 'rgb(var(--scene-ink))',
  width: num(s?.width, env, scope, 2),
  opacity: num(s?.opacity, env, scope, 1),
  dashed: s?.dashed ?? false,
  head: s?.head ?? ('end' as const),
  headSize: num(s?.headSize, env, scope, 10),
})

/**
 * A quadratic that passes through `a` and `b` with the given sag at the
 * midpoint. Sag is in scene units along the normal, so a negative curvature
 * bows the opposite way and the caller never has to think about winding.
 */
export function arcPoint(a: Pt, b: Pt, sag: number, at = 0.5): Pt {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  // Normal to the chord; degenerate for coincident endpoints, where any bow is
  // invisible anyway.
  const nx = len === 0 ? 0 : -dy / len
  const ny = len === 0 ? 0 : dx / len
  // A quadratic passes through the midpoint of the control polygon, so the
  // control point sits at twice the requested sag or the visible bow is half
  // what the caller asked for.
  const cx = mx + nx * sag * 2
  const cy = my + ny * sag * 2
  const u = 1 - at
  return { x: u * u * a.x + 2 * u * at * cx + at * at * b.x, y: u * u * a.y + 2 * u * at * cy + at * at * b.y }
}

/** Tangent of the arc at `at`, for aiming an arrow head along a curved shaft. */
export function arcTangent(a: Pt, b: Pt, sag: number, at = 0.5): Pt {
  const e = 1e-3
  const p0 = arcPoint(a, b, sag, Math.max(0, at - e))
  const p1 = arcPoint(a, b, sag, Math.min(1, at + e))
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const len = Math.hypot(dx, dy)
  return len === 0 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len }
}

/** Perpendicular unit normal of `from`→`to`. */
export function normal(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: 0, y: 1 }
  const nx = -dy / len
  const ny = dx / len
  return { x: nx === 0 ? 0 : nx, y: ny === 0 ? 0 : ny }
}

/**
 * Witness lines for a dimension, offset from the measured span. Both witness
 * lines are the same length so the arrow row reads as one object.
 */
export function dimensionGeometry(from: Pt, to: Pt, offset: number): {
  witness: [Pt, Pt]
  measure: [Pt, Pt]
} {
  const n = normal(from, to)
  const ox = n.x * offset
  const oy = n.y * offset
  const a = { x: from.x + ox, y: from.y + oy }
  const b = { x: to.x + ox, y: to.y + oy }
  // Each witness starts at the measured point and runs a little past the
  // arrow row, so the dimension reads as one object rather than three.
  const over = 1.25
  return {
    witness: [
      { x: from.x + ox * over, y: from.y + oy * over },
      { x: to.x + ox * over, y: to.y + oy * over },
    ],
    measure: [a, b],
  }
}

/**
 * Shortest signed sweep from `startDeg` to `endDeg`, in [-180, 180].
 *
 * Always taking the short way means an arc over 180° has to be authored as the
 * opposite direction. That is the right default for a protractor, where 350° to
 * 10° should show the sliver through zero rather than a full turn.
 */
export function sweepDeg(startDeg: number, endDeg: number): number {
  const d = endDeg - startDeg
  const wrapped = (((d % 360) + 360) % 360) as number
  return wrapped > 180 ? wrapped - 360 : wrapped
}

/**
 * Tick angles for a protractor. Wraps around when the sweep is negative, so a
 * protractor drawn from 350° to 10° shows the short arc through zero rather
 * than a full turn backwards.
 */
export function protractorTicks(
  startDeg: number,
  endDeg: number,
  tickDeg: number,
  labelEvery: number,
): { deg: number; x: number; y: number; major: boolean; label: boolean }[] {
  if (tickDeg <= 0 || tickDeg < 1e-6) return []
  const sweep = sweepDeg(startDeg, endDeg)
  const steps = Math.min(LIMITS.maxTicks * 4, Math.round(Math.abs(sweep) / tickDeg))
  if (steps <= 0) return []
  const out: { deg: number; x: number; y: number; major: boolean; label: boolean }[] = []
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const deg = startDeg + sweep * f
    const rad = (deg * Math.PI) / 180
    const major = i % labelEvery === 0
    out.push({ deg, x: Math.cos(rad), y: Math.sin(rad), major, label: major && labelEvery > 0 })
  }
  return out
}

/** `d` for an SVG arc through `from`, `to` bowed by `sag`, as a quadratic. */
export function arcPath(a: Pt, b: Pt, sag: number): string {
  const mid = arcPoint(a, b, sag, 0.5)
  return `M ${a.x} ${a.y} Q ${mid.x} ${mid.y} ${b.x} ${b.y}`
}

/** A single arrow head as a closed triangle at `tip` pointing along `dir`. */
export function arrowHead(tip: Pt, dir: Pt, size: number): string {
  const len = Math.hypot(dir.x, dir.y) || 1
  const ux = dir.x / len
  const uy = dir.y / len
  const base = { x: tip.x - ux * size, y: tip.y - uy * size }
  // Half width, flared back from the tip.
  const w = size * 0.42
  const l = { x: base.x - uy * w, y: base.y + ux * w }
  const r = { x: base.x + uy * w, y: base.y - ux * w }
  return `M ${tip.x} ${tip.y} L ${l.x} ${l.y} L ${r.x} ${r.y} Z`
}

/**
 * Head placement for a curved shaft: the tip sits at the end point but aims
 * along the tangent there, otherwise a bowed arrow points at empty space.
 */
export function headFor(kind: 'start' | 'end', a: Pt, b: Pt, sag: number): { tip: Pt; dir: Pt } | null {
  if (kind === 'end') {
    return { tip: b, dir: arcTangent(a, b, sag, 1) }
  }
  return { tip: a, dir: arcTangent(a, b, sag, 0) }
}

/** Midpoint of a straight span, used for the default dimension label. */
export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export const distance = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y)

/**
 * Resolve every numeric field of a drawing for one frame. Warnings are
 * collected rather than thrown: one bad arrow should not blank the scene.
 */
export function resolveDrawing(d: Drawing, env: EvalEnv, scope: Scope): { drawing: ResolvedDrawing; warnings: DrawingWarning[] } {
  const warnings: DrawingWarning[] = []
  const base = {
    id: d.id,
    style: style(d.style, env, scope),
    points: {} as Record<string, Pt>,
    nums: {} as Record<string, number>,
  }

  switch (d.kind) {
    case 'arrow': {
      const from = drawPoint(d.from, env, scope)
      const to = drawPoint(d.to, env, scope)
      const sag = num(d.curvature, env, scope, 0) * distance(from, to) * 0.25
      base.nums.curvature = num(d.curvature, env, scope, 0)
      if (distance(from, to) < 1e-6) {
        warnings.push({ drawingId: d.id, message: 'جتهٔ پیکان صفر است؛ رسم نمی‌شود' })
      }
      return {
        drawing: {
          ...bare(d as ArrowDrawing),
          ...base,
          points: { from, to, mid: d.labelOnCurve ? arcPoint(from, to, sag, 0.5) : midpoint(from, to) },
        },
        warnings,
      }
    }
    case 'dimension': {
      const from = drawPoint(d.from, env, scope)
      const to = drawPoint(d.to, env, scope)
      base.nums.offset = num(d.offset, env, scope, 0)
      const g = dimensionGeometry(from, to, base.nums.offset)
      if (distance(from, to) < 1e-6) {
        warnings.push({ drawingId: d.id, message: 'فاصلهٔ اندازه‌گیری صفر است؛ رسم نمی‌شود' })
      }
      return {
        drawing: {
          ...bare(d as DimensionDrawing),
          ...base,
          points: {
            from,
            to,
            witnessA: g.witness[0],
            witnessB: g.witness[1],
            fromA: { x: from.x, y: from.y },
            toB: { x: to.x, y: to.y },
            measureA: g.measure[0],
            measureB: g.measure[1],
            mid: midpoint(g.measure[0], g.measure[1]),
          },
        },
        warnings,
      }
    }
    case 'protractor': {
      const center = drawPoint(d.center, env, scope)
      base.nums.radius = num(d.radius, env, scope, 1)
      base.nums.startDeg = num(d.startDeg, env, scope, 0)
      base.nums.endDeg = num(d.endDeg, env, scope, 90)
      base.nums.tickDeg = num(d.tickDeg, env, scope, 10)
      base.nums.labelEvery = num(d.labelEvery, env, scope, 6)
      return {
        drawing: {
          ...bare(d as ProtractorDrawing),
          ...base,
          points: { center },
        },
        warnings,
      }
    }
    case 'label': {
      const at = drawPoint(d.at, env, scope)
      base.nums.size = num(d.size, env, scope, 16)
      base.nums.rotation = num(d.rotation, env, scope, 0)
      base.nums.padding = num(d.padding, env, scope, 3)
      return { drawing: { ...bare(d as LabelDrawing), ...base, points: { at } }, warnings }
    }
  }
}

export function resolveDrawings(
  list: Drawing[] | undefined,
  env: EvalEnv,
  scope: Scope,
): {
  resolved: ResolvedDrawing[]
  warnings: DrawingWarning[]
} {
  if (!list || list.length === 0) return { resolved: [], warnings: [] }
  const resolved: ResolvedDrawing[] = []
  const warnings: DrawingWarning[] = []
  for (const d of list.slice(0, LIMITS.maxNodes)) {
    try {
      const r = resolveDrawing(d, env, scope)
      resolved.push(r.drawing)
      warnings.push(...r.warnings)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[drawing]', d.id, d.kind, message)
      warnings.push({ drawingId: d.id, message: `رسم خطا داشت؛ نادیده گرفته شد (${message})` })
    }
  }
  return { resolved, warnings }
}

/**
 * A drawing label's text for this frame. Keyframes are allowed here, unlike
 * for the numbers: a readout that counts up is the point of a label.
 */
export function drawingText(v: LabelDrawing['text'], env: EvalEnv, scope: Scope): string {
  if (typeof v === 'string') return v
  if ('keys' in v && v.keys.length > 0) {
    let last = v.keys[0]
    for (const k of v.keys) if (k.t <= env.t) last = k
    return last.v
  }
  if ('expr' in v) {
    try {
      const n = compileExpr(v.expr, scope)(env)
      return formatNum(n)
    } catch {
      return v.expr
    }
  }
  return ''
}

/** Short, locale-free number formatting for labels. */
function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Number.isInteger(n)) return String(n)
  const abs = Math.abs(n)
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 3
  return String(Number(n.toFixed(digits)))
}

/** True when the drawing is inside its window, treating no window as always. */
export function drawingVisible(
  d: { time?: { start?: number; end?: number } },
  t: number,
): boolean {
  if (!d.time) return true
  if (d.time.start !== undefined && t < d.time.start) return false
  if (d.time.end !== undefined && t > d.time.end) return false
  return true
}