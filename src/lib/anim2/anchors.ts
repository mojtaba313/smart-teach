/**
 * Named attachment points on a node.
 *
 * An anchor is a point in the node's **local** frame. Resolving it means taking
 * the node's world position, rotating the offset by the node's own angle, and
 * scaling by its scale factors — in that order, so an anchor on a rotating body
 * stays glued to the body rather than to where the origin happens to be.
 *
 * The resolved values are published into the expression namespace under the
 * node's own id (`@body@top`), which is how a force arrow or a spring can be
 * written against an attachment instead of against a hand-typed coordinate.
 */

import type { Anchor, Node, NumProp } from '../../types/anim2'
import { LIMITS } from '../../types/anim2'
import type { EvalEnv, Scope } from './expr'
import { compileExpr } from './expr'

/** Anchors per node. Beyond this the studio list stops being usable. */
export const MAX_ANCHORS = 32

export type ResolvedAnchor = { x: number; y: number }

export type AnchorWarning = { nodeId: string; anchor: string; message: string }

export type NodeTransform = {
  x: number
  y: number
  /** Degrees, counter-clockwise, matching the node's own rotation. */
  angle: number
  scaleX: number
  scaleY: number
}

/**
 * Evaluate one anchor coordinate. A broken expression yields `NaN` rather than
 * a fallback, so the caller can report it — silently substituting `0` would put
 * an attachment point in the wrong place with no indication why.
 */
/**
 * An anchor coordinate. Accepts the same shorthand the rest of the schema
 * does — a bare string is an expression — because `"y": "-r"` is the form a
 * hand-written demo will use, and rejecting it at render time would fail on
 * data that looks perfectly valid.
 */
const num = (v: NumProp | string, env: EvalEnv, scope: Scope, fallback: number): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = compileExpr(v, scope)(env)
    return Number.isFinite(n) ? n : NaN
  }
  if ('expr' in v) {
    try {
      return compileExpr(v.expr, scope)(env)
    } catch {
      return NaN
    }
  }
  // Keyframes in an anchor would need a second sampling path; a node's own
  // animation already covers that case, so treat them as their base value.
  return fallback
}

/**
 * Rotate then scale a local offset into the parent's frame.
 *
 * Scale is applied before rotation in the code, but the composition is
 * scale-then-rotate, which is the only order that keeps an anchor on a body
 * that is itself scaled from a corner rather than from its centre.
 */
export function anchorToWorld(t: NodeTransform, ax: number, ay: number): ResolvedAnchor {
  const sx = ax * t.scaleX
  const sy = ay * t.scaleY
  const rad = (t.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: t.x + sx * cos - sy * sin,
    y: t.y + sx * sin + sy * cos,
  }
}

/** The inverse, for hit-testing a click on an anchor handle. */
export function worldToAnchor(t: NodeTransform, px: number, py: number): ResolvedAnchor {
  const rad = (-t.angle * Math.PI) / 180
  const dx = px - t.x
  const dy = py - t.y
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rx = dx * cos - dy * sin
  const ry = dx * sin + dy * cos
  return {
    x: t.scaleX === 0 ? rx : rx / t.scaleX,
    y: t.scaleY === 0 ? ry : ry / t.scaleY,
  }
}

export type AnchorPlan = {
  /** `${nodeId}@${name}` → resolved point. Empty when a scene uses no anchors. */
  points: Map<string, ResolvedAnchor>
  warnings: AnchorWarning[]
}

export type ResolvedAnchorNode = {
  id: string
  transform: NodeTransform
  anchors: Record<string, Anchor>
}

/**
 * Resolve every anchor for one frame. A node with no anchors costs nothing, so
 * scenes that never use this pay only a single property check.
 */
export function resolveAnchors(
  nodes: ResolvedAnchorNode[],
  env: EvalEnv,
  scope: Scope,
): AnchorPlan {
  const points = new Map<string, ResolvedAnchor>()
  const warnings: AnchorWarning[] = []
  for (const node of nodes) {
    const entries = Object.entries(node.anchors ?? {})
    if (entries.length === 0) continue
    if (entries.length > MAX_ANCHORS) {
      warnings.push({
        nodeId: node.id,
        anchor: '*',
        message: `${entries.length} لنگر؛ تنها ${MAX_ANCHORS} نخست خوانده شد`,
      })
    }
    for (const [name, a] of entries.slice(0, MAX_ANCHORS)) {
      const ax = num(a.x, env, scope, 0)
      const ay = num(a.y, env, scope, 0)
      if (!Number.isFinite(ax) || !Number.isFinite(ay)) {
        warnings.push({ nodeId: node.id, anchor: name, message: 'مختصات لنگر نامعتبر بود' })
        continue
      }
      points.set(`${node.id}@${name}`, anchorToWorld(node.transform, ax, ay))
    }
  }
  return { points, warnings }
}

/** Pull the anchor table off a node, tolerating a malformed one. */
export function anchorsOf(node: Pick<Node, 'anchors'>): Record<string, Anchor> {
  const a = node.anchors
  if (!a || typeof a !== 'object') return {}
  // An array would iterate as indices and produce nonsense names.
  if (Array.isArray(a)) return {}
  const out: Record<string, Anchor> = {}
  for (const [k, v] of Object.entries(a)) {
    if (v && typeof v === 'object' && 'x' in v && 'y' in v) out[k] = v as Anchor
  }
  return out
}

/** Every `${nodeId}@${name}` an animation can address. */
export function anchorNames(nodes: Pick<Node, 'id' | 'anchors'>[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    for (const name of Object.keys(anchorsOf(n))) out.push(`${n.id}@${name}`)
  }
  return out.slice(0, LIMITS.maxNodes)
}