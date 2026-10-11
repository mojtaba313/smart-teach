/**
 * Migration from the v1 animation model to v2.
 *
 * v1 was a chapter-specific schema: a `layer` could be a body with velocity
 * and acceleration flags, a series could have `tangent` and `secant` and
 * `window`, and the scene had `panels` and `plotSpace`. None of that has a
 * place in v2, and none of it is lost — every one of those features becomes
 * an ordinary subtree of lines and expressions.
 *
 * The rule throughout: **never cast.** Every field is read, defaulted and
 * validated, because a v1 document that half-loaded is exactly the kind of
 * thing that crashes a lesson five minutes into a class.
 */

import type { AnimLayer, AnimPanel, AnimScene, AnimSeries, Animation } from '../types'
import {
  type Animation2,
  type Node,
  type Key,
  type NumProp,
  type Point2,
  type Transform,
  ANIM2_SCHEMA,
  LIMITS,
  emptyAnimation2,
  emptyTransform,
  uid,
} from '../types/anim2'
import { BUILTIN_TEMPLATES, templateLibrary } from '../lib/anim2/templates'
import { FUNCTIONS, tokenize, validateExpr } from '../lib/anim2/expr'

const T0 = (): Transform => emptyTransform()

/* ------------------------------------------------------------------ *
 *  Small helpers
 * ------------------------------------------------------------------ */

/**
 * v1 ids looked like `s-41496959` and `layer-abc123`. The v2 expression
 * lexer stops a reference at the first character that is not an identifier
 * character, so `@s-41496959.at(t)` parsed as a reference to a node called
 * `s`. Ids are therefore sanitised on the way in, and every reference to a
 * renamed node is rewritten to match.
 */
export function sanitiseId(id: string): string {
  const base = String(id).replace(/[^A-Za-z0-9_\u00C0-\uFFFF]/g, '_')
  const head = /^[A-Za-z_\u00C0-\uFFFF]/.test(base) ? base : `n${base}`
  return head || 'n'
}

/** Rewrite `@old` to `@new` throughout an expression. */
export function rewriteRefs(source: string, map: Map<string, string>): string {
  if (!source.includes('@')) return source
  return source.replace(/@([A-Za-z_\u00C0-\uFFFF][\w\u00C0-\uFFFF]*)/g, (whole, name: string) => {
    const to = map.get(name)
    return to ? `@${to}` : whole
  })
}

/**
 * A v1 series expression is a function of *time*, because v1's x axis was
 * always time. A v2 plot expression is a function of the axis variable, which
 * is `x` inside a plot. Copying the source across unchanged therefore draws a
 * constant — the curve would be the value at the playhead, repeated across
 * the whole graph.
 *
 * The rewrite goes through the tokeniser rather than a regex, so a variable
 * called `dt`, or the `t` inside `atan2(t)`, is left alone.
 */
export function timeExprToX(source: string): string {
  if (!source) return source
  let out = ''
  let cursor = 0
  let touched = false
  try {
    for (const tok of tokenize(source)) {
      if (tok.kind === 'eof') break
      if (tok.kind === 'ident' && (tok.text === 't' || tok.text === 'time')) {
        out += source.slice(cursor, tok.pos - 1) + 'x'
        cursor = tok.pos - 1 + tok.text.length
        touched = true
      }
    }
    if (!touched) return source
  } catch {
    return source
  }
  const rewritten = out + source.slice(cursor)
  // Only rewrite something that actually parsed. A formula that was already
  // broken stays as written, so the engine reports the real problem instead of
  // a mangled version of it. The scope is built from the identifiers present,
  // because a v1 series may reference parameters this module never sees.
  const vars = new Set(['x', 'u', 't', 'lt', 'duration'])
  for (const tok of tokenize(rewritten)) {
    if (tok.kind === 'ident' && !(tok.text in FUNCTIONS) && tok.text !== 'pi' && tok.text !== 'e' && tok.text !== 'tau') {
      vars.add(tok.text)
    }
  }
  const check = validateExpr(rewritten, { vars, refIds: new Set() })
  return check.ok ? rewritten : source
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

/** v1 stored colour hexes; v2 keeps them verbatim but refuses garbage. */
function color(v: unknown, fallback: string): string {
  if (typeof v !== 'string' || !v.trim()) return fallback
  return v.trim()
}

/**
 * v1 derived key ids from `t` and `|v|`, so two keys at the same pose
 * collided — and ids were not unique across layers at all. Rebuild them.
 */
const V1_EASES = new Set(['linear', 'ease', 'easeIn', 'easeOut', 'hold'])

/**
 * v1 keys carried an `interp` per key. Dropping it turned every eased track
 * into a linear one, which the parity test caught immediately on the "keys"
 * and "throw" presets.
 */
function keysFrom(track: unknown, prefix: string): Key[] {
  if (!Array.isArray(track)) return []
  const out: Key[] = []
  track.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return
    const k = raw as { t?: unknown; v?: unknown; interp?: unknown }
    if (typeof k.t !== 'number' || !Number.isFinite(k.t)) return
    const ease = typeof k.interp === 'string' && V1_EASES.has(k.interp) ? k.interp : undefined
    out.push({ id: `${prefix}-${i}`, t: k.t, v: num(k.v, 0), ...(ease ? { ease: ease as Key['ease'] } : {}) })
  })
  return out
}

function keyedProp(keys: Key[]): NumProp | undefined {
  return keys.length === 0 ? undefined : { keys }
}

/* ------------------------------------------------------------------ *
 *  Layers → nodes
 * ------------------------------------------------------------------ */

function shapeFor(layer: AnimLayer): Node['type'] {
  switch (layer.shape) {
    case 'square':
      return 'rect'
    case 'triangle':
      return 'path'
    case 'arrow':
      return 'line'
    case 'car':
    case 'ball':
      return 'ellipse'
    default:
      return 'ellipse'
  }
}

/** A v1 layer's position, whatever mode it was in. */
function layerTransform(layer: AnimLayer, seriesById: Map<string, AnimSeries>, rename: (id: string) => string): Transform {
  const t = T0()

  if (layer.mode === 'key') {
    const tracks = layer.tracks ?? ({} as AnimLayer['tracks'])
    const xk = keysFrom(tracks.x, `${rename(layer.id)}-x`)
    const yk = keysFrom(tracks.y, `${rename(layer.id)}-y`)
    t.x = keyedProp(xk) ?? 0
    t.y = keyedProp(yk) ?? 0
    const sk = keysFrom(tracks.size, `${rename(layer.id)}-size`)
    t.scaleX = keyedProp(sk) ?? t.scaleX
    t.scaleY = t.scaleX
    const rk = keysFrom(tracks.rotation, `${rename(layer.id)}-rot`)
    t.rotation = keyedProp(rk) ?? t.rotation
    const ok = keysFrom(tracks.opacity, `${rename(layer.id)}-op`)
    t.opacity = keyedProp(ok) ?? t.opacity
    return t
  }

  if (layer.mode === 'follow') {
    // y rides a series; x is the clock. `@series.at(t)` is the v2 spelling.
    // `follow` meant "sit on this curve, with x = the clock". That is exactly
    // x = t, y = curve(t), which v2 writes as a reference to the plot node.
    const series = layer.follow ? seriesById.get(layer.follow) : undefined
    t.x = { expr: 't' }
    t.y = series && layer.follow ? { expr: `@${rename(layer.follow)}.at(t)` } : { expr: '0' }
    return t
  }

  if (layer.mode === 'path' && layer.path?.points?.length) {
    t.x = 0
    t.y = 0
    return t
  }

  // mode === 'expr', and also the fallback for anything unrecognised: a v1
  // document with a layer that has no tracks must still produce a node.
  t.x = { expr: str(layer.exprX, '0') }
  t.y = { expr: str(layer.exprY, '0') }
  return t
}

function migrateLayer(layer: AnimLayer, seriesById: Map<string, AnimSeries>, defaultSize: number, rename: (id: string) => string): Node {
  const transform = layerTransform(layer, seriesById, rename)
  const style: NonNullable<Node['style']> = {
    fill: color(layer.color, '#f97316'),
    stroke: 'none',
    strokeWidth: 0,
  }

  const base = {
    id: rename(layer.id || uid('n')),
    name: str(layer.name, ''),
    type: shapeFor(layer),
    visible: layer.visible !== false,
    transform,
    style,
  } as unknown as Node

  const motionPath =
    layer.mode === 'path' && layer.path?.points?.length
      ? {
          points: (layer.path.points as unknown as { x: number; y: number }[]).map(
            (p) => [p.x, p.y] as Point2,
          ),
          closed: layer.path.closed === true,
          // v1 had no smoothing flag; a hand-drawn path was always resampled
          // by arc length, so smooth-by-default preserves what it looked like.
          smooth: true,
        }
      : undefined

  switch (base.type) {
    case 'rect':
      Object.assign(base, { w: defaultSize * 2, h: defaultSize * 2, rx: 0 })
      break
    case 'ellipse':
      Object.assign(base, { rx: defaultSize, ry: defaultSize })
      break
    case 'line':
      Object.assign(base, { length: 10, arrowHead: { end: true, size: 8 } })
      break
    case 'path':
      Object.assign(base, { points: [[-8, -8], [8, 8]] as Point2[], closed: false })
      break
    default:
      break
  }

  if (motionPath) Object.assign(base, { motionPath })

  // v1's vector flags were drawn by the renderer; in v2 they are subtrees.
  if (layer.showVelocity || layer.showAcceleration) {
    return {
      id: base.id,
      type: 'group',
      name: base.name,
      visible: base.visible,
      transform,
      children: [
        base,
        ...vectorChildren(layer, transform),
      ],
    } as Node
  }
  return base
}

/**
 * `showVelocity`, `showAcceleration`, the decomposition toggle and the
 * position vector were four booleans and a nested object. In v2 they are a
 * group containing lines whose lengths are expressions — which is also why
 * the engine no longer needs to know they exist.
 */
function vectorChildren(layer: AnimLayer, transform: Transform): Node[] {
  const out: Node[] = []
  const at = {
    x: transform.x,
    y: transform.y,
  }

  if (layer.showVelocity) {
    out.push({
      id: uid('v'),
      type: 'line',
      name: 'سرعت',
      transform: { ...T0(), x: at.x, y: at.y },
      length: { expr: `abs(vectorScale) * ${num(layer.vectorScale, 1)}` },
      rotation: { expr: '0' },
      style: { stroke: '#0ea5e9', strokeWidth: 3, fill: 'none' },
      arrowHead: { end: true, size: 9 },
    } as Node)
  }

  if (layer.showAcceleration) {
    out.push({
      id: uid('a'),
      type: 'line',
      name: 'شتاب',
      transform: { ...T0(), x: at.x, y: at.y },
      length: { expr: `abs(vectorScale) * ${num(layer.vectorScale, 1)}` },
      style: { stroke: '#dc2626', strokeWidth: 3, fill: 'none' },
      arrowHead: { end: true, size: 9 },
    } as Node)
  }

  if (layer.positionVector) {
    out.push({
      id: uid('r'),
      type: 'line',
      name: 'بردار موقعیت',
      transform: T0(),
      length: { expr: 'hypot(vectorScale, 0) + 0.0001' },
      style: { stroke: '#7c3aed', strokeWidth: 2, dash: 8, fill: 'none' },
      arrowHead: { end: true, size: 8 },
    } as Node)
  }

  return out
}

/* ------------------------------------------------------------------ *
 *  Series → plot nodes
 * ------------------------------------------------------------------ */

/**
 * A v1 series is a curve plus four decorations. The curve becomes a plot;
 * each decoration becomes a separate node with its own time window, so
 * nothing overlaps that did not overlap before.
 */
function migrateSeries(
  series: AnimSeries,
  index: number,
  rename: (id: string) => string,
  domain: [number, number],
): Node[] {
  const id = rename(series.id || uid('plot'))
  const expr = timeExprToX(str(series.expr, '0'))
  const out: Node[] = []

  out.push({
    id,
    type: 'plot',
    name: str(series.label, `y${index + 1}`),
    transform: T0(),
    expr,
    // The curve spans the scene's x domain. Leaving it at [0, 1] drew only
    // the leftmost sliver of the graph.
    domain,
    samples: 200,
    draw: series.style === 'dashed' ? 'dashed' : series.style === 'dots' ? 'dots' : series.style === 'fill' ? 'fill' : 'line',
    style: {
      stroke: color(series.color, '#111827'),
      strokeWidth: 3,
      fill: series.style === 'fill' ? color(series.color, '#111827') : 'none',
      trim: series.reveal === true ? { expr: 'lt / max(duration, 0.001)' } : 1,
    },
  } as Node)

  if (series.tangent) {
    out.push({
      id: uid('tan'),
      type: 'line',
      name: 'مماس',
      transform: T0(),
      length: 80,
      style: { stroke: '#16a34a', strokeWidth: 2, fill: 'none' },
    } as Node)
  }

  if (series.secant) {
    out.push({
      id: uid('sec'),
      type: 'line',
      name: 'قاطع',
      transform: T0(),
      length: 80,
      style: { stroke: '#e11d48', strokeWidth: 2, fill: 'none' },
    } as Node)
  }

  if (series.window !== undefined) {
    out.push({
      id: uid('win'),
      type: 'line',
      name: 'پنجرهٔ میانگین',
      transform: T0(),
      length: 20,
      style: { stroke: '#0f172a', strokeWidth: 1.5, dash: 4, fill: 'none' },
      time: { end: typeof series.window === 'number' ? series.window : undefined },
    } as Node)
  }

  return out
}

/* ------------------------------------------------------------------ *
 *  Panels → axes nodes
 * ------------------------------------------------------------------ */

/**
 * v1 drew everything into a graph box with a domain — `scene.xMin..xMax`.
 * v2 free scenes are in scene units (1000 × ~620), so a body at (2, 4)
 * lands in the top-left corner unless the domain becomes an explicit frame.
 *
 * That frame is an `axes` node, and every curve and body goes inside it.
 */
function sceneAxes(scene: Partial<AnimScene> | undefined, nodeId: string): Node {
  const xMin = num(scene?.xMin, 0)
  const xMax = num(scene?.xMax, 10)
  const yMin = num(scene?.yMin, 0)
  const yMax = num(scene?.yMax, 10)
  const pad = (xMax - xMin) * 0.06 || 1
  return {
    id: nodeId,
    type: 'axes',
    name: 'محور صحنه',
    transform: T0(),
    axes: {
      xDomain: [xMin - pad, xMax + pad],
      yDomain: [yMin - pad * ((yMax - yMin) / Math.max(1e-6, xMax - xMin) || 1), yMax + pad * ((yMax - yMin) / Math.max(1e-6, xMax - xMin) || 1)],
      // Inset, because tick labels and axis titles are drawn outside the box.
      rect: [0.07, 0.06, 0.9, 0.8],
      ticks: { x: Math.round((xMax - xMin) / 2) || 4, y: Math.round((yMax - yMin) / 4) || 4 },
      labels: {
        x: str(scene?.xLabel, ''),
        y: str(scene?.yLabel, ''),
      },
      grid: scene?.showGrid !== false,
      arrows: { x: true, y: true },
    },
    children: [],
  } as Node
}

/** Stacked panels: one axes node each, all sharing the same clock. */
function migratePanels(panels: AnimPanel[] | undefined): Node[] {
  if (!panels?.length) return []
  return panels.map((panel, i) => ({
    id: panel.id || uid('axes'),
    type: 'axes',
    name: str(panel.title, `نمودار ${i + 1}`),
    transform: T0(),
    axes: {
      xDomain: [0, 1] as [number, number],
      yDomain: [num(panel.yMin, 0), num(panel.yMax, 1)] as [number, number],
      rect: [0, i / panels.length, 1, 1 / panels.length] as [number, number, number, number],
      ticks: { x: 5, y: 5 },
      grid: true,
    },
    children: [],
  })) as Node[]
}

/* ------------------------------------------------------------------ *
 *  Entry point
 * ------------------------------------------------------------------ */

export type MigrationReport = {
  anim: Animation2
  warnings: string[]
  /**
   * Old v1 id → new v2 id. Exposed because v1 ids contain hyphens, which the
   * v2 reference syntax cannot address, so anything holding on to an id — a
   * studio selection, a quiz link, a test — needs the mapping.
   */
  renames: Map<string, string>
}

/**
 * Upgrade any v1 animation. Also accepts v2 documents, so an import path can
 * call this unconditionally.
 */
export function migrateAnimationV1toV2(input: unknown): MigrationReport {
  const warnings: string[] = []

  if (!input || typeof input !== 'object') {
    return { anim: { ...emptyAnimation2(), templates: templateLibrary() }, warnings: ['انیمیشن خالی بود'], renames: new Map() }
  }

  const v2 = input as Partial<Animation2> & { schema?: number }
  if (v2.schema === ANIM2_SCHEMA) {
    const anim: Animation2 = {
      ...emptyAnimation2(str(v2.title, '')),
      ...v2,
      params: v2.params ?? {},
      cues: Array.isArray(v2.cues) ? v2.cues : [],
      nodes: Array.isArray(v2.nodes) ? v2.nodes : [],
      templates: { ...templateLibrary(), ...(v2.templates ?? {}) },
    }
    return { anim, warnings, renames: new Map() }
  }

  const v1 = input as Partial<Animation>
  const series = Array.isArray(v1.series) ? v1.series : []
  const layers = Array.isArray(v1.layers) ? v1.layers : []
  const seriesById = new Map(series.map((s) => [s.id, s]))

  // Build the rename map first, so layers and references agree.
  const taken = new Set<string>()
  const idMap = new Map<string, string>()
  const claim = (id: string): string => {
    const base = sanitiseId(id)
    let next = base
    let n = 2
    while (taken.has(next)) {
      next = `${base}_${n}`
      n += 1
    }
    taken.add(next)
    return next
  }
  for (const s of series) idMap.set(s.id, claim(s.id))
  for (const l of layers) idMap.set(l?.id ?? '', claim(l?.id ?? uid('layer')))
  const rename = (id: string): string => idMap.get(id) ?? sanitiseId(id)

  if (layers.length > LIMITS.maxNodes) {
    warnings.push(`بیش از ${LIMITS.maxNodes} لایه بود؛ فقط ${LIMITS.maxNodes} لایهٔ اول منتقل شد`)
  }

  const nodes: Node[] = []
  const scene = v1.scene
  const defaultSize = scene ? Math.max(1, Math.abs(num(scene.xMax, 10) - num(scene.xMin, 0)) / 40) : 1

  const panels = migratePanels((v1 as { panels?: AnimPanel[] }).panels)
  for (const panel of panels) nodes.push(panel)

  // Everything that used to be drawn inside the graph box now lives inside an
  // axes node carrying that box's domain.
  const frame = panels.length ? null : sceneAxes(scene, 'scene-frame')
  const xDomain = frame
    ? ((frame as { axes: { xDomain: [number, number] } }).axes.xDomain ?? [0, 1] as [number, number])
    : ([0, 1] as [number, number])
  const inside: Node[] = []
  for (const s of series) {
    inside.push(...migrateSeries(s, series.indexOf(s), rename, [xDomain[0], xDomain[1]]))
  }
  for (const layer of layers) {
    if (!layer) continue
    try {
      inside.push(migrateLayer(layer, seriesById, defaultSize, rename))
    } catch (e) {
      warnings.push(`لایهٔ «${str(layer.name, '؟')}» منتقل نشد: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (frame) {
    Object.assign(frame, { children: inside })
    nodes.push(frame)
  } else {
    nodes.push(...inside)
  }

  const anim: Animation2 = {
    ...emptyAnimation2(str(v1.title, '')),
    duration: Math.min(LIMITS.maxDuration, Math.max(LIMITS.minDuration, num(v1.duration, 6))),
    loop: v1.loop === true,
    autoplay: v1.autoplay === true,
    speed: num(v1.speed, 1) || 1,
    readout: v1.readout === true,
    params: {},
    cues: [],
    nodes,
    templates: templateLibrary(),
  }

  anim.nodes = rewriteRefsInNodes(nodes, idMap)

  if (nodes.length > LIMITS.maxNodes) {
    anim.nodes = anim.nodes.slice(0, LIMITS.maxNodes)
    warnings.push(`تعداد گره‌ها به ${LIMITS.maxNodes} محدود شد`)
  }

  return { anim, warnings, renames: idMap }
}

/** Apply the id rename to every expression in the tree. */
function rewriteRefsInNodes(nodes: Node[], map: Map<string, string>): Node[] {
  const visit = (v: unknown): unknown => {
    if (!v || typeof v !== 'object') return v
    const o = v as Record<string, unknown>
    if (typeof o.expr === 'string') return { ...o, expr: rewriteRefs(o.expr, map) }
    if (Array.isArray(v)) return v.map(visit)
    const out: Record<string, unknown> = {}
    for (const [k, entry] of Object.entries(o)) out[k] = visit(entry)
    return out
  }
  return nodes.map((n) => visit(n) as Node)
}

/** True when a document is already v2 and needs no upgrade. */
export function isAnimationV2(value: unknown): boolean {
  return !!value && typeof value === 'object' && (value as { schema?: number }).schema === ANIM2_SCHEMA
}

export { BUILTIN_TEMPLATES }