/**
 * The animation engine.
 *
 * Two halves, deliberately separated:
 *
 *   compileAnimation(anim) — everything expensive happens once. Expressions
 *   are compiled, keys sorted, template instances expanded, motion paths
 *   given an arc-length table, references topologically sorted.
 *
 *   evaluate(compiled, t) — every frame. Pure reads, no allocation of
 *   anything but the result object, and no way to throw: a broken expression
 *   yields a warning on the frame instead of a blank screen.
 *
 * Nothing in here imports React or touches the DOM, so all of it is testable
 * in node.
 */

import {
  type Animation2,
  type ColorProp,
  type Cue,
  type Key,
  type Node,
  type NumProp,
  type Param,
  type Point2,
  ANIM2_SCHEMA,
  LIMITS,
} from '../../types/anim2'
import { BASE_VARS, compileExpr, type CompiledExpr, type EvalEnv, ExprError, type Scope } from './expr'
import { prepareTrack, sampleTrack, sampleTrackDerivative, type Track } from './keys'
import { describeVars, planVars, resolveVars, type VarPlan } from './vars'
import { planEvents, type EventPlan } from './events'
import { resolveDrawings, type DrawingWarning } from './drawings'
import { anchorNames, anchorsOf, resolveAnchors } from './anchors'
import { planShapes, type ShapeRegistry } from './shapes'

/* ------------------------------------------------------------------ *
 *  Compiled forms
 * ------------------------------------------------------------------ */

/** A numeric prop with everything resolved ahead of time. */
type CompiledProp =
  | { k: 'const'; v: number }
  | { k: 'expr'; fn: CompiledExpr; df: CompiledExpr | null; timeDependent: boolean }
  | { k: 'keys'; track: Track; timeDependent: boolean }

export type CompiledColor =
  | { k: 'const'; v: string }
  | { k: 'keys'; stops: { t: number; v: string }[]; timeDependent: boolean }

export type CompiledNode = {
  id: string
  name?: string
  type: Node['type']
  visible: boolean
  locked: boolean
  /** Absolute window; the node is absent outside it. */
  start: number
  end: number
  transform: Record<'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity', CompiledProp>
  style?: {
    fill?: CompiledColor
    stroke?: CompiledColor
    strokeWidth?: CompiledProp
    dash?: CompiledProp
    trim?: CompiledProp
    fillOpacity?: CompiledProp
    blur?: CompiledProp
    hueRotate?: CompiledProp
    brightness?: CompiledProp
  }
  /** Set for path/rect/ellipse/line/text/image/plot; absent for groups. */
  shape?: Record<string, CompiledProp | CompiledColor>
  plot?: CompiledPlot
  /** Registry key for a `shape` node; the outline is measured per frame. */
  shapeId?: string
  shapeParams?: Record<string, NumProp>
  text?: CompiledText
  motionPath?: CompiledPath
  children?: CompiledNode[]
  /** Anything a renderer needs verbatim. */
  raw: Node
  /** False when no property can change with time — lets the renderer skip it. */
  dependsOnTime: boolean
  /** Ids of other nodes this one reads, for ordering and cycle reporting. */
  refs: string[]
  description?: string
}

export type CompiledPlot = {
  /** y as a function of the axis variable x. */
  expr?: CompiledExpr
  /** Or a parametric curve over u. */
  parametric?: { x: CompiledExpr; y: CompiledExpr }
  domain: [number, number]
  samples: number
  draw: 'line' | 'dashed' | 'dots' | 'fill'
}

export type CompiledText =
  | { k: 'const'; v: string }
  | { k: 'expr'; fn: CompiledExpr; format?: string; timeDependent: boolean }
  | { k: 'interp'; src: string; timeDependent: boolean }

export type CompiledPath = {
  /** Resampled polyline in node-local units, already smoothed if asked. */
  points: Point2[]
  closed: boolean
  /** Cumulative length at each point; the last entry is the total. */
  arc: number[]
  total: number
  /** Normalised position along the path. Null means `localTime / duration`. */
  progress: CompiledProp | null
}

export type Warning = {
  nodeId: string
  /** Property path such as `transform.x` or `expr`. */
  field: string
  message: string
}

export type CompiledAnimation = {
  anim: Animation2
  duration: number
  loop: boolean
  autoplay: boolean
  speed: number
  params: Record<string, Param>
  /** Derived quantities, compiled and topologically sorted. */
  vars: VarPlan
  /** Conditions, compiled, with per-event edge state. */
  events: EventPlan
  /** Names an expression may read here. Drawings share it. */
  scope: Scope['vars']
  /** Node ids a `@ref` may point at. */
  refIds: ReadonlySet<string>
  cues: Cue[]
  nodes: CompiledNode[]
  /** Node ids in an order where referenced nodes come first. */
  order: string[]
  /** Ids that are part of a reference cycle; they evaluate to 0. */
  cyclic: Set<string>
  warnings: Warning[]
  /** True when nothing in the animation can change with time. */
  static: boolean
  /** Global hash of everything that affects geometry. Bump to invalidate caches. */
  hash: string
}

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

const TRANSFORM_PROPS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'] as const

function clampDuration(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 6
  return Math.min(LIMITS.maxDuration, Math.max(LIMITS.minDuration, n))
}

/** Cheap, stable hash for cache invalidation. */
export function hashOf(anim: Animation2): string {
  let h = 2166136261
  const text = JSON.stringify(anim)
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function countNodes(nodes: readonly Node[]): number {
  let n = 0
  for (const node of nodes) {
    n += 1
    if ('children' in node && Array.isArray(node.children)) n += countNodes(node.children)
  }
  return n
}

/* ------------------------------------------------------------------ *
 *  Compiling a property
 * ------------------------------------------------------------------ */

type CompileCtx = {
  vars: Set<string>
  refIds: Set<string>
  /** Node ids that are plots, so `@id.at(x)` can be resolved. */
  plotIds: Set<string>
  warnings: Warning[]
}

function compileNum(
  prop: NumProp | undefined,
  fallback: number,
  nodeId: string,
  field: string,
  ctx: CompileCtx,
): CompiledProp {
  if (typeof prop === 'number') {
    return { k: 'const', v: Number.isFinite(prop) ? prop : fallback }
  }
  if (prop && typeof prop === 'object' && 'expr' in prop) {
    const source = String(prop.expr ?? '')
    if (source.length > LIMITS.maxExprLength) {
      ctx.warnings.push({ nodeId, field, message: `فرمول بیش از ${fa(LIMITS.maxExprLength)} نویسه است` })
      return { k: 'const', v: fallback }
    }
    try {
      const scope = { vars: ctx.vars, refIds: ctx.refIds }
      const fn = compileExpr(source, scope)
      // Differentiating once here rather than per frame: `d()` hits the same
      // LRU cache, so this is one extra compile per property, ever.
      let df: CompiledExpr | null = null
      try {
        df = compileExpr(`d(${source})`, scope)
      } catch {
        df = null
      }
      return { k: 'expr', fn, df, timeDependent: fn.timeDependent }
    } catch (e) {
      ctx.warnings.push({ nodeId, field, message: describe(e) })
      return { k: 'const', v: fallback }
    }
  }
  if (prop && typeof prop === 'object' && 'keys' in prop && Array.isArray(prop.keys)) {
    const keys = normaliseKeys(prop.keys as Key[], nodeId, field, ctx)
    const track = prepareTrack(keys)
    return { k: 'keys', track, timeDependent: keys.length > 0 }
  }
  return { k: 'const', v: fallback }
}

function fa(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}

function describe(e: unknown): string {
  if (e instanceof ExprError) return e.message
  return e instanceof Error ? e.message : String(e)
}

/**
 * v1 key ids were derived from `t` and `|v|`, which collided whenever a body
 * visited the same pose twice. Any id is accepted here, but duplicates inside
 * one track are reported and regenerated so a track can never address a key
 * twice.
 */
function normaliseKeys(keys: Key[], nodeId: string, field: string, ctx: CompileCtx): Key[] {
  const seen = new Set<string>()
  return keys.map((key, i) => {
    let id = typeof key.id === 'string' && key.id ? key.id : ''
    if (!id || seen.has(id)) {
      if (id && seen.has(id)) {
        ctx.warnings.push({ nodeId, field, message: `شناسهٔ کی‌فریم تکراری «${id}» — جایگزین شد` })
      }
      id = `${nodeId}-${field}-${i}-${keys[i]?.t ?? 0}`
      while (seen.has(id)) id = `${id}x`
    }
    seen.add(id)
    const t = typeof key.t === 'number' && Number.isFinite(key.t) ? key.t : 0
    const v = typeof key.v === 'number' && Number.isFinite(key.v) ? key.v : 0
    return { id, t, v, ease: key.ease }
  })
}

/** Compile an expression, turning a failure into a warning rather than a throw. */
function compileExprIn(source: string, ctx: CompileCtx, nodeId: string, field: string): CompiledExpr {
  if (source.length > LIMITS.maxExprLength) {
    ctx.warnings.push({ nodeId, field, message: `فرمول بیش از ${fa(LIMITS.maxExprLength)} نویسه است` })
    return compileExpr('0', { vars: ctx.vars, refIds: ctx.refIds })
  }
  try {
    return compileExpr(source, { vars: ctx.vars, refIds: ctx.refIds })
  } catch (e) {
    ctx.warnings.push({ nodeId, field, message: describe(e) })
    return compileExpr('0', { vars: ctx.vars, refIds: ctx.refIds })
  }
}

function compileText(
  text: unknown,
  ctx: CompileCtx,
  nodeId: string,
): CompiledText | undefined {
  if (typeof text === 'string') return { k: 'const', v: text }
  if (text && typeof text === 'object') {
    const t = text as Record<string, unknown>
    if (typeof t.expr === 'string') {
      return { k: 'expr', fn: compileExprIn(t.expr, ctx, nodeId, 'text.expr'), format: typeof t.format === 'string' ? t.format : undefined, timeDependent: true }
    }
    if (typeof t.interp === 'string') return { k: 'interp', src: t.interp, timeDependent: true }
  }
  return undefined
}

function compileColor(prop: ColorProp | undefined, fallback: string | undefined): CompiledColor | undefined {
  if (prop === undefined || prop === null) {
    return fallback === undefined ? undefined : { k: 'const', v: fallback }
  }
  if (typeof prop === 'string') return { k: 'const', v: prop }
  if (typeof prop === 'object' && 'keys' in prop && Array.isArray(prop.keys)) {
    const stops = [...prop.keys]
      .map((k) => ({ t: Number(k.t) || 0, v: String(k.v) }))
      .sort((a, b) => a.t - b.t)
    return { k: 'keys', stops, timeDependent: stops.length > 1 }
  }
  return { k: 'const', v: fallback ?? 'currentColor' }
}

/* ------------------------------------------------------------------ *
 *  Motion paths
 * ------------------------------------------------------------------ */

/**
 * Centripetal Catmull-Rom (Barry–Goldman, alpha = 0.5).
 *
 * The parameterisation is the whole point: uniform Catmull-Rom bulges
 * outwards between points and even spirals, so a "circle" built from eight
 * vertices came out visibly wrong. Centripetal is guaranteed to pass through
 * every point and never cusp or self-intersect. It is still a spline, so it
 * approximates a circle rather than being one — the test says so honestly.
 */
function catmullRom(points: Point2[], closed: boolean, samplesPerSpan = 12): Point2[] {
  if (points.length < 3) return points
  const out: Point2[] = []
  const at = (i: number): Point2 => {
    if (closed) return points[((i % points.length) + points.length) % points.length]
    return points[Math.min(points.length - 1, Math.max(0, i))]
  }
  const knot = (a: Point2, b: Point2, prev: number): number =>
    prev + Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5)

  const last = closed ? points.length : points.length - 1
  for (let i = 0; i < last; i += 1) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const t0 = 0
    const t1 = knot(p0, p1, t0)
    const t2 = knot(p1, p2, t1)
    const t3 = knot(p2, p3, t2)
    for (let sIdx = 0; sIdx < samplesPerSpan; sIdx += 1) {
      const u = sIdx / samplesPerSpan
      const t = t1 + (t2 - t1) * u
      const a1 = lerp2(p0, p1, t0, t1, t)
      const a2 = lerp2(p1, p2, t1, t2, t)
      const a3 = lerp2(p2, p3, t2, t3, t)
      const b1 = lerp2(a1, a2, t0, t2, t)
      const b2 = lerp2(a2, a3, t1, t3, t)
      out.push(lerp2(b1, b2, t1, t2, t))
    }
  }
  if (!closed) out.push(points[points.length - 1])
  return out
}

/** Linear interpolation in the non-uniform knot parameterisation. */
function lerp2(a: Point2, b: Point2, ta: number, tb: number, t: number): Point2 {
  const w = tb - ta > 1e-12 ? (t - ta) / (tb - ta) : 0
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]
}

function buildArc(points: Point2[], closed: boolean): { arc: number[]; total: number } {
  const arc: number[] = [0]
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    arc.push(total)
  }
  if (closed && points.length > 1) {
    total += Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1])
    arc.push(total)
  }
  return { arc, total }
}

export function compilePath(
  points: Point2[],
  closed: boolean,
  smooth?: boolean,
  progress?: CompiledProp | null,
): CompiledPath {
  const pts = (smooth ? catmullRom(points, closed) : points).map((p) => [p[0], p[1]] as Point2)
  const { arc, total } = buildArc(pts, closed)
  return { points: pts, closed, arc, total, progress: progress ?? null }
}

/** Position at a fraction of the path's total length. */
export function samplePath(path: CompiledPath, progress: number): Point2 {
  const { points, arc, total } = path
  if (points.length === 0) return [0, 0]
  if (points.length === 1 || total <= 0) return points[0]
  const target = Math.min(1, Math.max(0, progress)) * total

  let lo = 0
  let hi = arc.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (arc[mid] <= target) lo = mid
    else hi = mid
  }
  const segLen = arc[hi] - arc[lo]
  const u = segLen > 1e-12 ? (target - arc[lo]) / segLen : 0
  const a = points[lo]
  const b = points[Math.min(hi, points.length - 1)]
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
}

/* ------------------------------------------------------------------ *
 *  Template expansion
 * ------------------------------------------------------------------ */

export type ExpandResult = {
  nodes: Node[]
  warnings: Warning[]
}

/**
 * Replace `use` nodes with the template's nodes. Pure and deterministic: the
 * same animation always expands to the same tree, and nothing is mutated.
 */
export function expandTemplates(anim: Animation2): ExpandResult {
  const warnings: Warning[] = []
  const library = anim.templates ?? {}

  const walk = (nodes: readonly Node[], depth: number, stack: string[]): Node[] => {
    if (depth > LIMITS.maxTemplateDepth) {
      warnings.push({ nodeId: stack[stack.length - 1] ?? '?', field: 'template', message: 'عمق بسط قالب بیش از حد است' })
      return []
    }
    const out: Node[] = []
    for (const node of nodes) {
      if (node.type === 'use') {
        const tpl = library[node.template]
        if (!tpl) {
          warnings.push({ nodeId: node.id, field: 'template', message: `قالب «${node.template}» پیدا نشد` })
          continue
        }
        if (stack.includes(node.template)) {
          warnings.push({ nodeId: node.id, field: 'template', message: `قالب «${node.template}» خودش را صدا می‌زند` })
          continue
        }
        const inner = walk(tpl.nodes, depth + 1, [...stack, node.template])
        const overrides = node.props ?? {}
        // A `use` node is a handle on the instance: it carries the window,
        // the transform and any prop overrides, and wraps the subtree.
        out.push({ ...node, type: 'group', children: applyOverrides(inner, overrides) } as Node)
        continue
      }
      if (node.type === 'group' || node.type === 'axes') {
        out.push({ ...node, children: walk(node.children ?? [], depth + 1, stack) })
        continue
      }
      out.push({ ...node } as Node)
    }
    return out
  }

  return { nodes: walk(anim.nodes, 0, []), warnings }
}

/**
 * A `use` node can override any transform or style of the instance it wraps,
 * which is what makes templates composable: `use: 'velocityArrow'` with a
 * different length, without cloning the arrow.
 */
function applyOverrides(nodes: Node[], overrides: Record<string, NumProp>): Node[] {
  const keys = Object.keys(overrides).filter((k) =>
    (TRANSFORM_PROPS as readonly string[]).includes(k),
  )
  const overrideTransform = (node: Node): Node['transform'] => {
    const transform = { ...(node.transform as unknown as Record<string, NumProp>) }
    for (const k of keys) transform[k] = overrides[k]
    return transform as Node['transform']
  }

  return nodes.map((node) => {
    if (node.type === 'group' || node.type === 'axes') {
      return { ...node, transform: overrideTransform(node), children: applyOverrides(node.children ?? [], overrides) }
    }
    return { ...node, transform: overrideTransform(node) }
  })
}

/* ------------------------------------------------------------------ *
 *  Compile
 * ------------------------------------------------------------------ */

export function compileAnimation(input: Animation2): CompiledAnimation {
  const anim: Animation2 = { ...input, schema: ANIM2_SCHEMA }
  const duration = clampDuration(anim.duration)

  const { nodes: expanded, warnings: templateWarnings } = expandTemplates(anim)

  const warnings: Warning[] = [...templateWarnings]
  if (countNodes(expanded) > LIMITS.maxNodes) {
    warnings.push({ nodeId: 'animation', field: 'nodes', message: `بیش از ${fa(LIMITS.maxNodes)} گره در یک انیمیشن مجاز نیست` })
  }

  const refIds = new Set<string>()
  const plotIds = new Set<string>()
  collectIds(expanded, refIds, plotIds)
  // `@body@top` must resolve during compilation, so the anchor names join the
  // known references up front rather than being discovered at draw time.
  for (const name of anchorNames(expanded)) refIds.add(name)

  // Three sources of names beyond the language itself: parameters, scene
  // variables, and template parameters. A template that mentions `vx` must be
  // compiled with `vx` in scope, or every arrow in the library warns.
  const vars = new Set<string>([...BASE_VARS, ...Object.keys(anim.params ?? {})])
  for (const name of Object.keys(anim.vars ?? {})) vars.add(name)
  for (const tpl of Object.values(anim.templates ?? {})) {
    for (const name of Object.keys(tpl.params ?? {})) vars.add(name)
  }
  // An anchor may reference its own node's shape, which is what makes
  // `{ "y": "-r" }` work without the author repeating the radius. `self` is
  // the escape hatch for anything not worth adding a scope entry for.
  const anchorScope = new Set(vars)
  anchorScope.add('self')
  for (const n of expanded) {
    for (const a of Object.values(anchorsOf(n))) {
      for (const raw of [a.x, a.y]) {
        const src = typeof raw === 'string' ? raw : typeof raw === 'object' && 'expr' in raw ? raw.expr : null
        if (!src) continue
        try {
          // Compile against the node's own shape names first, so `-r` resolves;
          // anything left over joins the shared scope.
          for (const dep of compileExpr(src, { vars: shapeNamesOf(n), refIds }).deps) anchorScope.add(dep)
        } catch {
          // Reported when the anchor is resolved, not here.
        }
      }
    }
  }
  for (const name of anchorScope) vars.add(name)

  // Drawings read the same namespace as everything else, so a force arrow can
  // be written as `{ expr: "F" }`. Their free names join the scope too.
  for (const src of drawingExpressions(anim.drawings)) {
    try {
      for (const dep of compileExpr(src, { vars, refIds }).deps) vars.add(dep)
    } catch {
      // A malformed drawing reports itself at draw time; here it only means
      // the name cannot be discovered up front.
    }
  }

  const ctx: CompileCtx = { vars, refIds, plotIds, warnings }

  // Scene variables can read params and each other, so they are planned with
  // the parameter names in scope.
  const varPlan = planVars(anim.vars, Object.keys(anim.params ?? {}))
  const varWhy = describeVars(varPlan)
  if (varWhy) {
    for (const name of varPlan.reserved) {
      warnings.push({ nodeId: 'scene', field: `vars.${name}`, message: `نام رزرو‌شده — نادیده گرفته شد` })
    }
    for (const name of varPlan.broken) {
      warnings.push({ nodeId: 'scene', field: `vars.${name}`, message: 'فرمول متغیر خوانده نشد' })
    }
    for (const name of varPlan.cyclic) {
      warnings.push({ nodeId: 'scene', field: `vars.${name}`, message: 'ارجاع حلقوی بین متغیرها' })
    }
  }

  const eventPlan = planEvents(anim.events, [...vars])
  for (const id of eventPlan.broken) {
    warnings.push({ nodeId: 'scene', field: `events.${id}`, message: 'شرط رویداد خوانده نشد' })
  }

  const compiledNodes = expanded.map((node) => compileNode(node, ctx, duration))
  const byId = new Map<string, CompiledNode>()
  const index = (nodes: CompiledNode[]) => {
    for (const n of nodes) {
      byId.set(n.id, n)
      if (n.children) index(n.children)
    }
  }
  index(compiledNodes)

  const cyclic = findCycles(compiledNodes)
  for (const id of cyclic) {
    warnings.push({ nodeId: id, field: 'refs', message: 'ارجاع حلقوی است؛ این گره صفر در نظر گرفته می‌شود' })
  }

  const order = topoOrder(compiledNodes)

  let dependsOnTime = false
  for (const n of compiledNodes) scanTime(n, () => {
    dependsOnTime = true
  })
  if (varPlan.order.some((v) => v.fn.timeDependent)) dependsOnTime = true

  return {
    anim,
    duration,
    loop: anim.loop === true,
    autoplay: anim.autoplay === true,
    speed: typeof anim.speed === 'number' && anim.speed > 0 ? anim.speed : 1,
    params: anim.params ?? {},
    vars: varPlan,
    events: eventPlan,
    scope: vars,
    refIds,
    cues: [...(anim.cues ?? [])].sort((a, b) => a.t - b.t),
    nodes: compiledNodes,
    order,
    cyclic,
    warnings,
    static: !dependsOnTime,
    hash: hashOf(anim),
  }
}

/** A node's own scalar shape fields, so an anchor can write `-r` for its r. */
function shapeNamesOf(node: Node): Set<string> {
  const out = new Set<string>()
  for (const [k, v] of Object.entries(node as unknown as Record<string, unknown>)) {
    if (k === 'type' || k === 'id' || k === 'style' || k === 'time' || k === 'transform') continue
    if (typeof v === 'number') out.add(k)
    else if (v && typeof v === 'object' && typeof (v as { expr?: unknown }).expr === 'string') {
      out.add(k)
    }
  }
  return out
}

function collectIds(nodes: readonly Node[], ids: Set<string>, plots: Set<string>): void {
  for (const node of nodes) {
    ids.add(node.id)
    if (node.type === 'plot') plots.add(node.id)
    if (node.type === 'group' || node.type === 'axes') collectIds(node.children ?? [], ids, plots)
  }
}

function scanTime(node: CompiledNode, onTime: () => void): void {
  if (node.dependsOnTime) onTime()
  node.children?.forEach((c) => scanTime(c, onTime))
}

function compileNode(node: Node, ctx: CompileCtx, duration: number): CompiledNode {
  // Imported JSON is not trusted: a node may arrive with no transform at all.
  const source = (node.transform ?? {}) as unknown as Record<string, NumProp | undefined>
  const transform = {} as CompiledNode['transform']
  for (const prop of TRANSFORM_PROPS) {
    transform[prop] = compileNum(
      source[prop],
      prop === 'scaleX' || prop === 'scaleY' ? 1 : prop === 'opacity' ? 1 : 0,
      node.id,
      `transform.${prop}`,
      ctx,
    )
  }

  const style: NonNullable<CompiledNode['style']> = {}
  const rawStyle = node.style
  if (rawStyle) {
    const fill = compileColor(rawStyle.fill, 'none')
    const stroke = compileColor(rawStyle.stroke, '#111827')
    const strokeWidth = compileNum(rawStyle.strokeWidth, 2, node.id, 'style.strokeWidth', ctx)
    const dash = compileNum(rawStyle.dash, 0, node.id, 'style.dash', ctx)
    const trim = compileNum(rawStyle.trim, 1, node.id, 'style.trim', ctx)
    if (fill) style.fill = fill
    if (stroke) style.stroke = stroke
    style.strokeWidth = strokeWidth
    style.dash = dash
    style.trim = trim
    const fillOpacity = compileNum(rawStyle.fillOpacity, 1, node.id, 'style.fillOpacity', ctx)
    const blur = compileNum(rawStyle.blur, 0, node.id, 'style.blur', ctx)
    const hueRotate = compileNum(rawStyle.hueRotate, 0, node.id, 'style.hueRotate', ctx)
    const brightness = compileNum(rawStyle.brightness, 1, node.id, 'style.brightness', ctx)
    if (fillOpacity !== undefined) style.fillOpacity = fillOpacity
    if (blur !== undefined) style.blur = blur
    if (hueRotate !== undefined) style.hueRotate = hueRotate
    if (brightness !== undefined) style.brightness = brightness
  }

  const out: CompiledNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible !== false,
    locked: node.locked === true,
    start: typeof node.time?.start === 'number' ? node.time.start : -Infinity,
    end: typeof node.time?.end === 'number' ? node.time.end : Infinity,
    transform,
    style: Object.keys(style).length ? style : undefined,
    raw: node,
    dependsOnTime: false,
    refs: collectNodeRefs(node),
    description: node.description,
  }

  if (node.type === 'rect') {
    out.shape = {
      w: compileNum(node.w, 10, node.id, 'w', ctx),
      h: compileNum(node.h, 10, node.id, 'h', ctx),
      rx: compileNum(node.rx, 0, node.id, 'rx', ctx),
    }
  } else if (node.type === 'ellipse') {
    out.shape = {
      rx: compileNum(node.rx, 5, node.id, 'rx', ctx),
      ry: compileNum(node.ry, 5, node.id, 'ry', ctx),
    }
  } else if (node.type === 'line') {
    out.shape = {
      length: compileNum(node.length, 10, node.id, 'length', ctx),
      arrowSize: compileNum(node.arrowHead?.size, 8, node.id, 'arrowHead.size', ctx),
    }
  } else if (node.type === 'text') {
    out.shape = { fontSize: compileNum(node.fontSize, 14, node.id, 'fontSize', ctx) }
  } else if (node.type === 'image') {
    out.shape = { w: compileNum(node.w, 10, node.id, 'w', ctx), h: compileNum(node.h, 10, node.id, 'h', ctx) }
  } else if (node.type === 'plot') {
    const samples = node.samples ?? 160
    const domain: [number, number] = [
      Number(node.domain?.[0]) || 0,
      Number(node.domain?.[1]) || 1,
    ]
    const compiledPlot: CompiledPlot = {
      domain,
      samples: Math.min(LIMITS.maxPlotSamples, Math.max(2, Math.floor(Number.isFinite(samples) ? samples : 160))),
      draw: node.draw ?? 'line',
    }
    if (node.parametric) {
      compiledPlot.parametric = {
        x: compileExprIn(String(node.parametric.xExpr ?? 'u'), ctx, node.id, 'parametric.xExpr'),
        y: compileExprIn(String(node.parametric.yExpr ?? '0'), ctx, node.id, 'parametric.yExpr'),
      }
    } else if (node.expr) {
      compiledPlot.expr = compileExprIn(String(node.expr), ctx, node.id, 'expr')
    }
    out.plot = compiledPlot
  }

  if (node.type === 'text') {
    out.text = compileText(node.text, ctx, node.id)
  }

  if (node.motionPath?.points?.length) {
    out.motionPath = compilePath(
      node.motionPath.points,
      node.motionPath.closed === true,
      node.motionPath.smooth === true,
      node.motionPath.progress === undefined
        ? null
        : compileNum(node.motionPath.progress, 0, node.id, 'motionPath.progress', ctx),
    )
  }

  if (node.type === 'group' || node.type === 'axes') {
    out.children = (node.children ?? []).map((c) => compileNode(c, ctx, duration))
  }

  // A shape keeps only its identity at compile time; the outline is measured
  // per frame, because its parameters are usually expressions in `t`.
  if (node.type === 'shape') {
    out.shapeId = String(node.shape ?? '')
    out.shapeParams = node.params ?? {}
  }

  recomputeDependsOnTime(out)
  return out
}

function collectNodeRefs(node: Node): string[] {
  const refs = new Set<string>()
  const visit = (v: unknown) => {
    if (!v) return
    if (typeof v === 'object' && 'expr' in (v as object)) {
      const source = String((v as { expr: unknown }).expr ?? '')
      for (const m of source.matchAll(/@([A-Za-z_][\w؀-ۿ]*)\s*(?:\.\s*([A-Za-z_][\w]*))?/g)) {
        refs.add(m[2] ? `${m[1]}.${m[2]}` : m[1])
      }
      return
    }
    if (Array.isArray(v)) {
      v.forEach(visit)
      return
    }
    if (typeof v === 'object') {
      for (const entry of Object.values(v as Record<string, unknown>)) visit(entry)
    }
  }
  visit(node.transform ?? {})
  visit(node.style)
  visit(node.type === 'rect' || node.type === 'image' ? node : {})
  return [...refs]
}

function recomputeDependsOnTime(node: CompiledNode): void {
  let time = false
  for (const p of Object.values(node.transform)) if (propTimeDependent(p)) time = true
  if (node.style) {
    for (const p of [
      node.style.strokeWidth,
      node.style.dash,
      node.style.trim,
      node.style.fillOpacity,
      node.style.blur,
      node.style.hueRotate,
      node.style.brightness,
    ]) {
      if (propTimeDependent(p)) time = true
    }
    if (node.style.fill?.k === 'keys' && node.style.fill.timeDependent) time = true
    if (node.style.stroke?.k === 'keys' && node.style.stroke.timeDependent) time = true
  }
  if (node.shape) {
    for (const p of Object.values(node.shape)) if (propTimeDependent(p)) time = true
  }
  if (node.motionPath) time = true
  // A plot drawn in `x` is static; a traveling wave reading `t` is not, and
  // missing this makes the wave freeze at its first frame.
  if (node.plot?.expr?.timeDependent) time = true
  if (node.plot?.parametric?.x.timeDependent) time = true
  if (node.plot?.parametric?.y.timeDependent) time = true
  if (node.text?.k === 'expr' && node.text.timeDependent) time = true
  if (node.text?.k === 'interp') time = true
  if (node.children) node.children.forEach(recomputeDependsOnTime)
  node.dependsOnTime = time
}

function propTimeDependent(p: CompiledProp | CompiledColor | undefined): boolean {
  if (!p) return false
  if (p.k === 'keys') return p.timeDependent
  if (p.k === 'expr') return p.timeDependent
  return false
}

/* ------------------------------------------------------------------ *
 *  Reference ordering
 * ------------------------------------------------------------------ */

function allNodes(nodes: readonly CompiledNode[]): CompiledNode[] {
  const out: CompiledNode[] = []
  const walk = (list: readonly CompiledNode[]) => {
    for (const n of list) {
      out.push(n)
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** Ids that take part in a reference cycle. */
export function findCycles(nodes: readonly CompiledNode[]): Set<string> {
  const all = allNodes(nodes)
  const edges = new Map<string, string[]>()
  for (const n of all) {
    edges.set(
      n.id,
      n.refs.map((r) => r.split('.')[0]).filter((id) => id !== n.id),
    )
  }
  const cyclic = new Set<string>()
  const colour = new Map<string, 0 | 1 | 2>()

  const visit = (id: string, path: string[]): void => {
    if (colour.get(id) === 2) return
    if (colour.get(id) === 1) {
      // Everything from the first sighting of `id` is on the cycle.
      const start = path.indexOf(id)
      for (const onPath of path.slice(start < 0 ? 0 : start)) cyclic.add(onPath)
      cyclic.add(id)
      return
    }
    colour.set(id, 1)
    path.push(id)
    for (const next of edges.get(id) ?? []) visit(next, path)
    path.pop()
    colour.set(id, 2)
  }

  for (const n of all) visit(n.id, [])
  return cyclic
}

/** Referenced nodes first, so evaluation order is well defined. */
function topoOrder(nodes: readonly CompiledNode[]): string[] {
  const all = allNodes(nodes)
  const byId = new Map(all.map((n) => [n.id, n]))
  const out: string[] = []
  const state = new Map<string, 0 | 1 | 2>()

  const visit = (id: string) => {
    if (state.get(id) !== undefined) return
    state.set(id, 1)
    const node = byId.get(id)
    if (node) {
      for (const ref of node.refs) {
        const target = ref.split('.')[0]
        if (byId.has(target)) visit(target)
      }
    }
    state.set(id, 2)
    out.push(id)
  }

  for (const n of all) visit(n.id)
  return out
}

/* ------------------------------------------------------------------ *
 *  Evaluate
 * ------------------------------------------------------------------ */

export type ResolvedNode = {
  id: string
  type: Node['type']
  name?: string
  visible: boolean
  /** Locked nodes are skipped by hit-testing and cannot be dragged. */
  locked: boolean
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  opacity: number
  fill?: string
  stroke?: string
  strokeWidth: number
  dash: number
  trim: number
  /** Type-specific numbers: rect w/h, ellipse r, line length, font size… */
  shape: Record<string, number>
  /** Resolved text, when the node has any. */
  text?: string
  /** Style extras, resolved for this frame. */
  fillOpacity?: number
  blur?: number
  hueRotate?: number
  brightness?: number
  /** Registry key for a `shape` node. */
  shapeId?: string
  /** Instance parameters overriding the shape's defaults. */
  shapeParams?: Record<string, NumProp>
  /** The outline itself, measured for this frame. */
  shapePath?: { d: string; offset: { x: number; y: number } }
  /** The compiled curve, for a plot node. The renderer needs the expression. */
  plot?: CompiledPlot
  children: ResolvedNode[]
  raw: Node
  /** True when the node is inside its time window right now. */
  live: boolean
  /** Derivative of (x, y) with respect to the clock, for velocity arrows. */
  dydt: { x: number; y: number }
}

export type Frame = {
  t: number
  nodes: ResolvedNode[]
  warnings: Warning[]
}

/* ------------------------------------------------------------------ *
 *  Evaluate
 * ------------------------------------------------------------------ */

type Ctx = {
  compiled: CompiledAnimation
  /** Shape registry for this frame; outlines are measured, not compiled. */
  shapes: ShapeRegistry
  /** Expression scope, shared with the shape resolver. */
  scope: Scope
  /** Values already resolved at the current frame, keyed by node id. */
  done: Map<string, ResolvedNode>
  v: Record<string, number>
  warnings: Warning[]
  cyclic: Set<string>
  /** Guards a reference that reads its own target. */
  visiting: Set<string>
}

function paramValues(compiled: CompiledAnimation, overrides?: Record<string, number>): Record<string, number> {
  const v: Record<string, number> = {}
  for (const [k, p] of Object.entries(compiled.params)) v[k] = Number(p?.value ?? 0)
  for (const [k, value] of Object.entries(overrides ?? {})) {
    if (Number.isFinite(value)) v[k] = value
  }
  return v
}

/**
 * Parameters and scene variables share one namespace, so any expression can
 * read either. Variables are resolved *per frame* — they read `t`.
 */
function valueNamespace(compiled: CompiledAnimation, t: number, overrides?: Record<string, number>): Record<string, number> {
  const params = paramValues(compiled, overrides)
  return resolveVars(compiled.vars, { t, lt: t, x: t, u: 0, duration: compiled.duration, v: params }, params)
}

function inWindow(node: CompiledNode, t: number): boolean {
  return t >= node.start && t <= node.end
}

/**
 * Resolve one node at one time.
 *
 * Colours *hold* rather than blend: a cross-fade is two stacked nodes.
 */
function readColor(color: CompiledColor, t: number): string | undefined {
  if (color.k === 'const') return color.v
  const stops = color.stops
  if (stops.length === 0) return undefined
  if (stops.length === 1 || t <= stops[0].t) return stops[0].v
  if (t >= stops[stops.length - 1].t) return stops[stops.length - 1].v
  let i = 0
  while (i < stops.length - 2 && stops[i + 1].t <= t) i += 1
  return stops[i].v
}

function readText(
  text: CompiledText,
  env: EvalEnv,
  ctx: Ctx,
  nodeId: string,
): string | undefined {
  if (text.k === 'const') return text.v
  try {
    if (text.k === 'expr') {
      const value = text.fn(env)
      return text.format ? formatValue(value, text.format) : defaultFormat(value)
    }
    return interpolateText(text.src, env)
  } catch (e) {
    ctx.warnings.push({ nodeId, field: 'text', message: describe(e) })
    return undefined
  }
}

/** `round(v, 2)`-style formatting, matching the authoring docs. */
function formatValue(value: number, format: string): string {
  const m = format.match(/^\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*$/)
  if (!m) return defaultFormat(value)
  const fn = m[1]
  const args = m[2].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
  if (fn === 'round' && args[0] !== undefined) {
    const factor = 10 ** args[0]
    return String(Math.round(value * factor) / factor)
  }
  if (fn === 'fixed' && args[0] !== undefined) return value.toFixed(args[0])
  return defaultFormat(value)
}

function defaultFormat(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded)
}

/**
 * `{ v = {round(x + a*t, 2)} m/s }` — the name is documentation, the braces
 * hold the expression to render in its place.
 */
function interpolateText(src: string, env: EvalEnv): string {
  return src.replace(/\{([^{}]*)\}/g, (_all, body: string) => {
    const eq = body.indexOf('=')
    const formula = (eq >= 0 ? body.slice(eq + 1) : body).trim()
    if (!formula) return ''
    try {
      const vars = new Set<string>(['t', 'lt', 'x', 'u', ...Object.keys(env.v)])
      const value = compileExpr(formula, { vars })(env)
      return defaultFormat(value)
    } catch {
      return '—'
    }
  })
}

/** Parameters, controls and scene variables as one name→value map. */
export function valueOf(
  compiled: CompiledAnimation,
  t: number,
  paramOverrides?: Record<string, number>,
): Record<string, number> {
  return valueNamespace(compiled, t, paramOverrides)
}

/** Every expression string a drawing carries, for scope discovery. */
function drawingExpressions(list: Animation2['drawings']): string[] {
  if (!list) return []
  const out: string[] = []
  const push = (v: unknown): void => {
    if (v && typeof v === 'object' && 'expr' in v && typeof (v as { expr: unknown }).expr === 'string') {
      out.push((v as { expr: string }).expr)
    }
  }
  const pushPoint = (p: { x: unknown; y: unknown } | undefined): void => {
    push(p?.x)
    push(p?.y)
  }
  for (const d of list) {
    switch (d.kind) {
      case 'arrow':
        pushPoint(d.from)
        pushPoint(d.to)
        push(d.curvature)
        push(d.style?.width)
        push(d.style?.opacity)
        push(d.style?.headSize)
        break
      case 'dimension':
        pushPoint(d.from)
        pushPoint(d.to)
        push(d.offset)
        push(d.style?.width)
        push(d.style?.opacity)
        break
      case 'protractor':
        pushPoint(d.center)
        push(d.radius)
        push(d.startDeg)
        push(d.endDeg)
        push(d.style?.width)
        push(d.style?.opacity)
        break
      case 'label':
        pushPoint(d.at)
        push(d.size)
        push(d.rotation)
        break
    }
  }
  return out
}

/**
 * Resolve the drawing layer for a frame. Kept beside `evaluate` so a renderer
 * only needs one call site; a drawing that throws is dropped with a warning
 * rather than taking the scene with it.
 */
export function resolveDrawingLayer(
  compiled: CompiledAnimation,
  t: number,
  paramOverrides?: Record<string, number>,
): { resolved: ReturnType<typeof resolveDrawings>['resolved']; warnings: DrawingWarning[] } {
  const list = compiled.anim.drawings
  if (!list || list.length === 0) return { resolved: [], warnings: [] }
  const scope: Scope = { vars: compiled.scope, refIds: compiled.refIds }
  const env: EvalEnv = {
    t,
    lt: t,
    x: t,
    u: compiled.duration === 0 ? 0 : t / compiled.duration,
    duration: compiled.duration,
    v: valueNamespace(compiled, t, paramOverrides),
  }
  return resolveDrawings(list, env, scope)
}

export function evaluate(
  compiled: CompiledAnimation,
  t: number,
  paramOverrides?: Record<string, number>,
): Frame {
  const warnings: Warning[] = []
  const v = valueNamespace(compiled, t, paramOverrides)
  const shapes = planShapes(compiled.anim.shapes)
  const scope: Scope = { vars: compiled.scope, refIds: compiled.refIds }
  const done = new Map<string, ResolvedNode>()
  const byId = new Map<string, CompiledNode>()
  const indexAll = (list: CompiledNode[]) => {
    for (const n of list) {
      byId.set(n.id, n)
      if (n.children) indexAll(n.children)
    }
  }
  indexAll(compiled.nodes)

  const ctx: Ctx = {
    compiled,
    shapes,
    scope,
    done,
    v,
    warnings,
    cyclic: compiled.cyclic,
    visiting: new Set(),
  }

  const resolver: EvalEnv = {
    t,
    lt: t,
    x: t,
    u: 0,
    duration: compiled.duration,
    v,
    refAt: (path, at) => {
      // An anchor reference is `id@name.x`, so the id must stop at the `@`,
      // not at the first dot — otherwise `body@top.x` splits into a node called
      // `body@top`, which never exists.
      const at2 = path.indexOf('@')
      const dot = path.indexOf('.', at2 === -1 ? 0 : at2 + 1)
      const id = path.slice(0, dot)
      const prop = path.slice(dot + 1)
      const target = byId.get(id)
      if (!target || ctx.cyclic.has(id) || ctx.visiting.has(id)) return 0
      // A reference at the current instant is already resolved; anything else
      // only happens inside d(), which needs t ± h.
      if (at === t) return readRefProp(done.get(id), prop)
      // Off-clock resolutions must not land in the frame cache: d() asks for
      // t ± h, and caching that would leave the real frame a hair behind.
      const scratch: Ctx = { ...ctx, done: new Map(), warnings: [] }
      return readRefProp(resolveNodeWithEnv(target, at, scratch, resolver), prop)
    },
    plotAt: (id, x) => {
      const target = byId.get(id)
      if (!target?.plot) return 0
      return plotValue(target.plot, x, t, v)
    },
  }
  ctx.visiting = new Set()

  /**
   * Anchor points for one node, from its own resolved transform. An anchor is
   * local to its node, so this needs no other node's position and no cycle
   * check — it is a fixed point, not a dependency.
   *
   * The map is filled in *as the node pass proceeds* rather than after it,
   * because a node reading `@body@top` may well come before `body` in document
   * order. Reading a not-yet-resolved anchor yields 0 for that frame instead of
   * throwing, which is the same rule the rest of the engine uses for a forward
   * reference.
   */
  const anchorPoints = new Map<string, { x: number; y: number }>()
  const anyAnchor = compiled.nodes.some((n) => Object.keys(anchorsOf(n.raw)).length > 0)

  const anchorsFor = (id: string, at: number, scratch: Ctx): ReadonlyMap<string, { x: number; y: number }> => {
    const src = compiled.nodes.find((n) => n.id === id)
    if (!src) return new Map()
    const r = at === t ? done.get(id) : scratch.done.get(id)
    return resolveAnchors(
      [{
        id,
        transform: {
          x: r?.x ?? 0,
          y: r?.y ?? 0,
          angle: r?.rotation ?? 0,
          scaleX: r?.scaleX ?? 1,
          scaleY: r?.scaleY ?? 1,
        },
        anchors: anchorsOf(src.raw),
      }],
      { t: at, lt: at, x: at, u: 0, duration: compiled.duration, v },
      { vars: compiled.scope, refIds: compiled.refIds },
    ).points
  }

  const env: EvalEnv = {
    ...resolver,
    refAt: (path, at) => {
      const a2 = path.indexOf('@')
      if (a2 > 0) {
        const dot = path.indexOf('.', a2 + 1)
        const id = path.slice(0, a2)
        const rest = dot === -1 ? path.slice(a2 + 1) : path.slice(a2 + 1, dot)
        const axis = dot === -1 ? 'xy' : path.slice(dot + 1)
        const p = at === t ? anchorPoints.get(`${id}@${rest}`) : anchorsFor(id, at, ctx).get(`${id}@${rest}`)
        if (!p) return 0
        // `.xy` reads the pair's length, which is what a distance formula wants.
        if (axis === 'x') return p.x
        if (axis === 'y') return p.y
        return Math.hypot(p.x, p.y)
      }
      return resolver.refAt!(path, at)
    },
  }

  /**
   * Anchors depend on their node's transform and on nothing else, so one
   * evaluation is enough — but only once every node has run. That is why the
   * pass runs twice when a scene uses anchors: the second pass is what makes
   * `@body@top` work from a node declared *above* `body`, which is the common
   * authoring order for a label that reports a distance. Scenes without
   * anchors take the single pass and pay nothing.
   */
  const passes = anyAnchor ? 2 : 1
  for (let pass = 0; pass < passes; pass++) {
    // `done` *is* `ctx.done`; clearing only the context would leave the frame
    // cache pointing at first-pass results that predate the anchors.
    if (pass === 1) done.clear()
    // The whole node pass first, anchors after: filling them per node would
    // still leave a node declared above its target reading an empty map.
    for (const node of compiled.nodes) resolveNodeWithEnv(node, t, ctx, env)
    if (anyAnchor) {
      for (const node of compiled.nodes) {
        for (const [k, v] of anchorsFor(node.id, t, ctx)) anchorPoints.set(k, v)
      }
    }
  }
  if (anyAnchor) {
    for (const node of compiled.nodes) {
      const r = done.get(node.id)
      for (const w of resolveAnchors(
        [{
          id: node.id,
          transform: {
            x: r?.x ?? 0,
            y: r?.y ?? 0,
            angle: r?.rotation ?? 0,
            scaleX: r?.scaleX ?? 1,
            scaleY: r?.scaleY ?? 1,
          },
          anchors: anchorsOf(node.raw),
        }],
        { t, lt: t, x: t, u: 0, duration: compiled.duration, v },
        { vars: compiled.scope, refIds: compiled.refIds },
      ).warnings) {
        warnings.push({ nodeId: node.id, field: `anchors.${w.anchor}`, message: w.message })
      }
    }
  }

  return { t, nodes: compiled.nodes.map((n) => done.get(n.id)!).filter(Boolean), warnings }
}

/** `resolveNode` needs the shared resolver env; keep it in one place. */
function resolveNodeWithEnv(node: CompiledNode, t: number, ctx: Ctx, env: EvalEnv): ResolvedNode {
  const lt = t - (Number.isFinite(node.start) ? node.start : 0)
  const local: EvalEnv = { ...env, t, lt, x: env.x, u: env.u, duration: env.duration, v: ctx.v }
  const read = (p: CompiledProp | undefined, fallback: number): number => {
    if (!p) return fallback
    if (p.k === 'const') return p.v
    if (p.k === 'keys') return sampleTrack(p.track, t)
    try {
      const value = p.fn(local)
      return Number.isFinite(value) ? value : fallback
    } catch (e) {
      ctx.warnings.push({ nodeId: node.id, field: 'expression', message: describe(e) })
      return fallback
    }
  }

  const shape: Record<string, number> = {}
  if (node.shape) {
    for (const [key, value] of Object.entries(node.shape)) {
      if (value && typeof value === 'object' && 'k' in value && value.k !== 'const') {
        shape[key] = read(value as CompiledProp, 0)
      } else if (typeof value === 'number') {
        shape[key] = value
      }
    }
  }

  const style = node.style
  const out: ResolvedNode = {
    id: node.id,
    type: node.type,
    name: node.name,
    visible: node.visible,
    locked: node.locked,
    x: read(node.transform.x, 0),
    y: read(node.transform.y, 0),
    scaleX: read(node.transform.scaleX, 1),
    scaleY: read(node.transform.scaleY, 1),
    rotation: read(node.transform.rotation, 0),
    opacity: read(node.transform.opacity, 1),
    strokeWidth: style ? read(style.strokeWidth, 2) : 0,
    dash: style ? read(style.dash, 0) : 0,
    trim: style ? read(style.trim, 1) : 1,
    shape,
    children: [],
    raw: node.raw,
    live: node.visible && inWindow(node, t),
    dydt: { x: 0, y: 0 },
  }

  if (node.plot) out.plot = node.plot
  if (node.shapeId) {
    out.shapePath =
      ctx.shapes.resolve(node.shapeId, node.shapeParams, local, ctx.scope) ?? undefined
    if (!out.shapePath) {
      ctx.warnings.push({ nodeId: node.id, field: 'shape', message: `شکل «${node.shapeId}» یافت نشد` })
    }
  }
  if (style?.fill) out.fill = readColor(style.fill, t)
  if (style?.fillOpacity) out.fillOpacity = read(style.fillOpacity, 1)
  if (style?.blur) out.blur = read(style.blur, 0)
  if (style?.hueRotate) out.hueRotate = read(style.hueRotate, 0)
  if (style?.brightness) out.brightness = read(style.brightness, 1)
  if (style?.stroke) out.stroke = readColor(style.stroke, t)
  if (node.text) out.text = readText(node.text, local, ctx, node.id)

  if (node.motionPath) {
    const p =
      node.motionPath.progress
        ? read(node.motionPath.progress, 0)
        : (() => {
            const span = node.end !== Infinity ? node.end - (Number.isFinite(node.start) ? node.start : 0) : 0
            return span > 0 ? lt / span : 0
          })()
    const at = samplePath(node.motionPath, p)
    out.x += at[0]
    out.y += at[1]
  }

  if (node.children) out.children = node.children.map((c) => resolveNodeWithEnv(c, t, ctx, env))

  // Velocity for a velocity arrow: exact for keyed tracks, symbolic for
  // formulas. A node that cannot move reports zero rather than sampling noise.
  out.dydt = { x: derivOf(node.transform.x, local), y: derivOf(node.transform.y, local) }

  ctx.done.set(node.id, out)
  return out
}

/** d/dt of a compiled prop. Zero when the prop cannot change with time. */
function derivOf(p: CompiledProp | undefined, env: EvalEnv): number {
  if (!p || p.k === 'const') return 0
  if (p.k === 'keys') return sampleTrackDerivative(p.track, env.t)
  if (!p.df) return 0
  try {
    const value = p.df(env)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function readRefProp(node: ResolvedNode | undefined, prop: string): number {
  if (!node) return 0
  switch (prop) {
    case 'x':
      return node.x
    case 'y':
      return node.y
    case 'scaleX':
      return node.scaleX
    case 'scaleY':
      return node.scaleY
    case 'rotation':
      return node.rotation
    case 'opacity':
      return node.opacity
    default:
      return node.shape[prop] ?? 0
  }
}

/** y of a compiled plot at an arbitrary x. */
export function plotValue(
  plot: CompiledPlot,
  x: number,
  t: number,
  v: Record<string, number>,
): number {
  const env: EvalEnv = { t, lt: t, x, u: x, duration: 0, v }
  try {
    if (plot.parametric) return plot.parametric.y(env)
    return plot.expr ? plot.expr(env) : 0
  } catch {
    return 0
  }
}

/** Sample a compiled plot into a polyline. Used by the renderer. */
export function plotPoints(plot: CompiledPlot, t: number, v: Record<string, number>): [number, number][] {
  const [a, b] = plot.domain
  const n = plot.samples
  const out: [number, number][] = []
  const env: EvalEnv = { t, lt: t, x: 0, u: 0, duration: 0, v }
  for (let i = 0; i < n; i += 1) {
    const u = n === 1 ? 0 : i / (n - 1)
    const x = a + (b - a) * u
    env.x = x
    env.u = u
    let y: number
    try {
      if (plot.parametric) {
        y = plot.parametric.y(env)
        const px = plot.parametric.x(env)
        if (!Number.isFinite(y) || !Number.isFinite(px)) continue
        out.push([px, y])
        continue
      }
      y = plot.expr ? plot.expr(env) : 0
    } catch {
      continue
    }
    if (!Number.isFinite(y)) continue
    out.push([x, y])
  }
  return out
}
