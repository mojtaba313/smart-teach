/**
 * Timeline layout, as pure functions.
 *
 * The reason this is not a component: every interesting question about a
 * timeline — does this key land on a cue, where does the playhead go, what
 * does the row list look like — is arithmetic, and arithmetic can be tested
 * without a browser.
 *
 * One rule worth stating because it was a v1 bug: **time always runs
 * left to right**, even though the interface is Persian. The chrome is RTL;
 * the axis is not. Arrow Right means forward, everywhere, always.
 */

import type { Animation2, Key, Node, NumProp } from '../../types/anim2'
import { animatedPaths, labelFor, modeOf, propsFor, readPath } from './schema'

/* ------------------------------------------------------------------ *
 *  View
 * ------------------------------------------------------------------ */

export type TimeView = {
  start: number
  end: number
}

export const MIN_SPAN = 0.1

/**
 * Keep the window inside `[0, duration]`. The span is preserved unless it is
 * wider than the whole animation, in which case the animation wins.
 */
export function clampView(view: TimeView, duration: number): TimeView {
  const limit = Math.max(MIN_SPAN, duration)
  const span = Math.min(Math.max(MIN_SPAN, view.end - view.start), limit)
  const start = Math.min(Math.max(0, view.start), limit - span)
  return { start, end: start + span }
}

export function fullView(duration: number): TimeView {
  return { start: 0, end: Math.max(MIN_SPAN, duration) }
}

export const timeToX = (t: number, view: TimeView, width: number): number =>
  ((t - view.start) / Math.max(1e-9, view.end - view.start)) * width

export const xToTime = (x: number, view: TimeView, width: number): number =>
  view.start + (x / Math.max(1, width)) * (view.end - view.start)

export function zoomAt(view: TimeView, anchor: number, factor: number, duration: number): TimeView {
  const span = view.end - view.start
  const limit = Math.max(MIN_SPAN, duration)
  const nextSpan = Math.min(Math.max(MIN_SPAN, span * factor), limit)
  const ratio = (anchor - view.start) / Math.max(1e-9, span)
  // Built from the span rather than from two endpoints, so the width is
  // exactly what was asked for instead of losing a digit to cancellation.
  return clampView({ start: anchor - ratio * nextSpan, end: anchor - ratio * nextSpan + nextSpan }, duration)
}

export function panBy(view: TimeView, dxPixels: number, width: number, duration: number): TimeView {
  const dt = (dxPixels / Math.max(1, width)) * (view.end - view.start)
  return clampView({ start: view.start + dt, end: view.end + dt }, duration)
}

/* ------------------------------------------------------------------ *
 *  Snapping
 * ------------------------------------------------------------------ */

/** Everything a dragged time might reasonably stick to. */
export type SnapPoints = {
  keys: number[]
  cues: number[]
  clips: number[]
}

export function snapPointsOf(anim: Animation2, nodes: readonly Node[]): SnapPoints {
  const keys: number[] = []
  const clips: number[] = []
  for (const node of nodes) {
    const start = readPath(node, 'time.start')
    const end = readPath(node, 'time.end')
    if (typeof start === 'number') clips.push(start)
    if (typeof end === 'number') clips.push(end)
    for (const spec of propsFor(node.type)) {
      if (!spec.animatable) continue
      const value = readPath(node, spec.path)
      if (value && typeof value === 'object' && 'keys' in (value as object)) {
        for (const k of (value as { keys: Key[] }).keys) keys.push(k.t)
      }
    }
  }
  return { keys, cues: (anim.cues ?? []).map((c) => c.t), clips }
}

/**
 * Pull a dragged time to the nearest candidate within `tolerance` seconds.
 * Cues win over keys, and keys over clips, because a cue is where a lesson
 * actually stops.
 */
export function snapTime(
  t: number,
  points: SnapPoints,
  tolerance: number,
  ignore?: { keys?: number[]; cues?: number[]; clips?: number[] },
): number {
  const near = (list: number[] | undefined, skip?: number[]): number | null => {
    let best: number | null = null
    let bestDist = tolerance
    for (const v of list ?? []) {
      if (skip?.includes(v)) continue
      const d = Math.abs(v - t)
      if (d <= bestDist) {
        best = v
        bestDist = d
      }
    }
    return best
  }
  return (
    near(points.cues, ignore?.cues) ??
    near(points.keys, ignore?.keys) ??
    near(points.clips, ignore?.clips) ??
    t
  )
}

/* ------------------------------------------------------------------ *
 *  Rows
 * ------------------------------------------------------------------ */

export type TimelineRow = {
  id: string
  /** Node id, or `nodeId:path` for a property row. */
  nodeId: string
  path?: string
  label: string
  color?: string
  depth: number
  kind: 'node' | 'prop' | 'plot' | 'text'
  keys: Key[]
  /** Time window, when the node has one. */
  start?: number
  end?: number
  /** True when the property is a formula rather than keys. */
  formula?: boolean
}

const PROP_COLOUR = '#64748b'

/** One row per node, plus a row per animated property under the ones that have any. */
export function buildRows(anim: Animation2, expanded: ReadonlySet<string>): TimelineRow[] {
  const rows: TimelineRow[] = []
  const walk = (nodes: readonly Node[], depth: number) => {
    for (const node of nodes) {
      const paths = animatedPaths(node)
      const start = readPath(node, 'time.start')
      const end = readPath(node, 'time.end')
      rows.push({
        id: node.id,
        nodeId: node.id,
        label: node.name || node.type,
        color: typeof readPath(node, 'style.stroke') === 'string' ? (readPath(node, 'style.stroke') as string) : undefined,
        depth,
        kind: node.type === 'plot' ? 'plot' : node.type === 'text' ? 'text' : 'node',
        keys: [],
        start: typeof start === 'number' ? start : undefined,
        end: typeof end === 'number' ? end : undefined,
      })

      if (expanded.has(node.id)) {
        for (const path of paths) {
          const value = readPath(node, path)
          const isKeys = modeOf(value) === 'keys'
          rows.push({
            id: `${node.id}:${path}`,
            nodeId: node.id,
            path,
            label: labelFor(path, node),
            color: PROP_COLOUR,
            depth: depth + 1,
            kind: 'prop',
            keys: isKeys ? ((value as { keys: Key[] }).keys ?? []) : [],
            formula: modeOf(value) === 'expr',
          })
        }
      }

      if (node.type === 'group' || node.type === 'axes') {
        walk(node.children ?? [], depth + 1)
      }
    }
  }
  walk(anim.nodes, 0)
  return rows
}

/** A curve row has no keys of its own; show the ones its formula rides. */
export function plotKeysOf(anim: Animation2, node: Node): Key[] {
  const keys: Key[] = []
  for (const other of anim.nodes) {
    for (const spec of propsFor(other.type)) {
      const value = readPath(other, spec.path)
      if (value && typeof value === 'object' && 'keys' in (value as object)) {
        for (const k of (value as { keys: Key[] }).keys) keys.push(k)
      }
    }
  }
  void node
  return keys
}

/* ------------------------------------------------------------------ *
 *  Ticks
 * ------------------------------------------------------------------ */

export function timelineTicks(view: TimeView, width: number, minPx = 56): number[] {
  const span = view.end - view.start
  if (span <= 0 || width <= 0) return []
  const target = (span / width) * minPx
  const mag = 10 ** Math.floor(Math.log10(target))
  const norm = target / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const out: number[] = []
  const first = Math.ceil(view.start / step) * step
  // Hard cap: a tiny span with a pathological step must not spin the browser.
  for (let v = first; v <= view.end + step * 1e-9 && out.length < 200; v += step) {
    out.push(Number(v.toFixed(10)))
  }
  return out
}

/* ------------------------------------------------------------------ *
 *  Editing helpers
 * ------------------------------------------------------------------ */

export type PropEdit =
  | { kind: 'const'; value: number }
  | { kind: 'expr'; expr: string }
  | { kind: 'keys'; keys: Key[] }

/** Build a prop from an edit, dropping keys whose id already exists. */
export function propFromEdit(edit: PropEdit): NumProp {
  switch (edit.kind) {
    case 'const':
      return Number.isFinite(edit.value) ? edit.value : 0
    case 'expr':
      return { expr: edit.expr }
    case 'keys':
      return { keys: dedupeKeys(edit.keys) }
  }
}

export function dedupeKeys(keys: Key[]): Key[] {
  const seen = new Set<string>()
  return keys.map((k, i) => {
    let id = k.id || `k${i}`
    while (seen.has(id)) id = `${id}_`
    seen.add(id)
    return { ...k, id }
  })
}

const byTime = (a: Key, b: Key): number => a.t - b.t

export function insertKey(keys: Key[], t: number, v: number, id: string): Key[] {
  const existing = keys.find((k) => Math.abs(k.t - t) < 1e-9)
  if (existing) return keys.map((k) => (k.id === existing.id ? { ...k, v } : k)).sort(byTime)
  return dedupeKeys([...keys, { id, t, v }]).sort(byTime)
}

export function moveKey(keys: Key[], keyId: string, t: number): Key[] {
  return dedupeKeys(keys.map((k) => (k.id === keyId ? { ...k, t } : k))).sort(byTime)
}

export function removeKey(keys: Key[], keyId: string): Key[] {
  return keys.filter((k) => k.id !== keyId)
}