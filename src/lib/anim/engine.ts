import type { AnimKey, AnimLayer, AnimPanel, AnimPath, AnimProp, AnimScene, Animation, AnimSeries, Interp } from '../../types'
import { evalExpr } from './expr'
import { clamp } from '../utils'

/* ------------------------------------------------------------------ *
 *  Easing
 * ------------------------------------------------------------------ */

export function easeFactor(kind: Interp, u: number): number {
  const x = clamp(u, 0, 1)
  switch (kind) {
    case 'step':
      return x >= 1 ? 1 : 0
    case 'ease':
      return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
    case 'easeIn':
      return x * x
    case 'easeOut':
      return 1 - (1 - x) ** 2
    case 'linear':
    default:
      return x
  }
}

/* ------------------------------------------------------------------ *
 *  Keyframes
 * ------------------------------------------------------------------ */

export function sortKeys(keys: AnimKey[]): AnimKey[] {
  return [...keys].sort((a, b) => a.t - b.t)
}

/**
 * Sample a keyframe list at time `t`. Outside the range the value is held.
 */
export function sampleKeys(keys: AnimKey[] | undefined, t: number, fallback = 0): number {
  if (!keys || keys.length === 0) return fallback
  if (keys.length === 1) return keys[0].v
  if (t <= keys[0].t) return keys[0].v
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.v
  let lo = keys[0]
  let hi = last
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (t >= keys[i].t && t <= keys[i + 1].t) {
      lo = keys[i]
      hi = keys[i + 1]
      break
    }
  }
  const span = hi.t - lo.t
  if (span <= 0) return hi.v
  const u = easeFactor(lo.interp, (t - lo.t) / span)
  return lo.v + (hi.v - lo.v) * u
}

/* ------------------------------------------------------------------ *
 *  Series lookup
 * ------------------------------------------------------------------ */

/** Resolves a series id to its value at `t`, or `undefined` when unknown. */
export type SeriesLookup = (id: string, t: number) => number | undefined

export function seriesLookupOf(anim: Animation): SeriesLookup {
  const map = new Map(anim.series.map((s) => [s.id, s]))
  return (id, t) => {
    const s = map.get(id)
    if (!s) return undefined
    return evalExpr(s.expr, t, NaN)
  }
}

/* ------------------------------------------------------------------ *
 *  Layer state
 * ------------------------------------------------------------------ */

export type LayerState = {
  x: number
  y: number
  size: number
  rotation: number
  opacity: number
}

const DEFAULT_SIZE = 6

/**
 * Point at fraction `u` of a path's arc length.
 *
 * Constant arc-length speed, not constant vertex speed: without this a shape
 * with unevenly spaced points would visibly speed up on the long segments,
 * and that single artefact makes an otherwise clean loop look broken.
 */
export function pathPointAt(path: AnimPath, u: number): { x: number; y: number } | null {
  const pts = path.points ?? []
  if (pts.length === 0) return null
  if (pts.length === 1) return { ...pts[0] }
  const segs = path.closed ? pts.length : pts.length - 1
  const lens: number[] = []
  let total = 0
  for (let i = 0; i < segs; i += 1) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    lens.push(d)
    total += d
  }
  if (total <= 0) return { ...pts[0] }
  let want = Math.min(Math.max(u, 0), 1) * total
  for (let i = 0; i < segs; i += 1) {
    if (want <= lens[i] || i === segs - 1) {
      const f = lens[i] > 0 ? want / lens[i] : 0
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
    }
    want -= lens[i]
  }
  return { ...pts[pts.length - 1] }
}

/** Pixels per scene unit on the horizontal axis — what a click radius means. */
export function sceneUnit(anim: Animation): number {
  const duration = animationDuration(anim)
  const spanX = Math.max(1e-6, (anim.scene.plotSpace === 'time' ? duration : anim.scene.xMax) - (anim.scene.plotSpace === 'time' ? 0 : anim.scene.xMin))
  return 1000 / spanX
}

/**
 * The path as an SVG path, in **view-box pixels**.
 *
 * The mapping has to be the panel's: scene units mean something different in
 * every panel, and a raw data-space polyline would land wherever the origin
 * happens to be.
 */
export function pathPolyline(
  path: AnimPath,
  sx: (v: number) => number,
  sy: (v: number) => number,
): string {
  const pts = path.points ?? []
  if (pts.length < 2) return ''
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`).join(' ')
  return path.closed ? `${d} L ${sx(pts[0].x).toFixed(2)} ${sy(pts[0].y).toFixed(2)} Z` : d
}

/** Position of a layer — keyframed, formula-driven, riding a curve or a path. */
export function layerPos(layer: AnimLayer, t: number, lookup?: SeriesLookup, duration = 0): { x: number; y: number } {
  if (layer.mode === 'path' && layer.path) {
    const p = pathPointAt(layer.path, duration > 0 ? t / duration : 0)
    if (p) return p
  }
  if (layer.mode === 'follow' && layer.follow && lookup) {
    const v = lookup(layer.follow, t)
    return { x: t, y: Number.isFinite(v ?? NaN) ? (v as number) : 0 }
  }
  if (layer.mode === 'expr') {
    return { x: evalExpr(layer.exprX, t, 0), y: evalExpr(layer.exprY, t, 0) }
  }
  return { x: sampleKeys(layer.tracks.x, t, 0), y: sampleKeys(layer.tracks.y, t, 0) }
}

export function layerState(layer: AnimLayer, t: number, lookup?: SeriesLookup, duration = 0): LayerState {
  const props = layer.tracks
  const p = layerPos(layer, t, lookup, duration)
  return {
    ...p,
    size: sampleKeys(props.size, t, DEFAULT_SIZE),
    rotation: sampleKeys(props.rotation, t, 0),
    opacity: sampleKeys(props.opacity, t, 1),
  }
}

const H = 0.005

/** Numerical first derivative of position, in units per second. */
export function layerVelocity(layer: AnimLayer, t: number, lookup?: SeriesLookup): { x: number; y: number } {
  const t0 = Math.max(0, t - H)
  const a = layerPos(layer, t0, lookup)
  const b = layerPos(layer, t + H, lookup)
  const dt = t + H - t0
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
}

/** Numerical second derivative. */
export function layerAcceleration(layer: AnimLayer, t: number, lookup?: SeriesLookup): { x: number; y: number } {
  const t0 = Math.max(0, t - H)
  const a = layerVelocity(layer, t0, lookup)
  const b = layerVelocity(layer, t + H, lookup)
  const dt = t + H - t0
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
}

export function speed(v: { x: number; y: number }): number {
  return Math.hypot(v.x, v.y)
}

export type Readout = {
  x: number
  y: number
  vx: number
  vy: number
  ax: number
  ay: number
  speed: number
}

export function readout(layer: AnimLayer, t: number, lookup?: SeriesLookup): Readout {
  const p = layerPos(layer, t, lookup)
  const v = layerVelocity(layer, t, lookup)
  const a = layerAcceleration(layer, t, lookup)
  return { x: p.x, y: p.y, vx: v.x, vy: v.y, ax: a.x, ay: a.y, speed: speed(v) }
}

/* ------------------------------------------------------------------ *
 *  Curves
 * ------------------------------------------------------------------ */

/** Sample a series into an SVG path across `[from, to]`, lifting the pen at breaks. */
export function seriesPath(
  series: AnimSeries,
  from: number,
  to: number,
  sx: (v: number) => number,
  sy: (v: number) => number,
  steps = 220,
): string {
  const span = to - from
  if (span <= 0) return ''
  const n = Math.max(2, Math.min(steps, Math.ceil(span * 60) + 2))
  let d = ''
  let penDown = false
  for (let i = 0; i <= n; i += 1) {
    const t = from + (span * i) / n
    const x = sx(t)
    const y = evalExpr(series.expr, t, NaN)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      penDown = false
      continue
    }
    const yy = sy(y)
    if (!Number.isFinite(yy)) {
      penDown = false
      continue
    }
    d += `${penDown ? 'L' : 'M'}${x.toFixed(2)} ${yy.toFixed(2)}`
    penDown = true
  }
  return d
}

export function seriesValue(series: AnimSeries, t: number): number {
  return evalExpr(series.expr, t, NaN)
}

/**
 * Instantaneous slope of a curve at `t`, by central difference.
 * This is d��y/dt — the quantity a tangent line has as its gradient.
 */
export function seriesSlope(series: AnimSeries, t: number): number {
  const h = 0.005
  const lo = Math.max(0, t - h)
  const hi = t + h
  const a = seriesValue(series, lo)
  const b = seriesValue(series, hi)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  return (b - a) / (hi - lo)
}

/** The series value nearest to `t`, looking backwards — used for the curve head. */
export function lastFinite(series: AnimSeries, t: number): number {
  for (let k = 0; k < 16; k += 1) {
    const v = seriesValue(series, Math.max(0, t - k * 0.01))
    if (Number.isFinite(v)) return v
  }
  return NaN
}

/** y-extent of a series over the animation duration — drives auto-framing. */
export function seriesExtent(series: AnimSeries, duration: number, steps = 120): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i <= steps; i += 1) {
    const v = seriesValue(series, (duration * i) / steps)
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [NaN, NaN]
  if (min === max) return [min - 1, max + 1]
  return [min, max]
}

/** History of a layer from 0 → `t` — the motion trail. */
export function trailPoints(
  layer: AnimLayer,
  t: number,
  lookup?: SeriesLookup,
  maxPoints = 100,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  const end = Math.max(0, t)
  const n = Math.min(maxPoints, Math.max(2, Math.ceil(end * 40)))
  for (let i = 0; i <= n; i += 1) pts.push(layerPos(layer, (end * i) / n, lookup))
  return pts
}

/* ------------------------------------------------------------------ *
 *  Axes
 * ------------------------------------------------------------------ */

/** Round to the nearest 1/2/5 × 10ⁿ so tick labels stay readable. */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const exp = Math.floor(Math.log10(raw))
  const base = 10 ** exp
  const norm = raw / base
  const mult = norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10
  return mult * base
}

export function ticksFor(lo: number, hi: number, target: number): number[] {
  const step = niceStep((hi - lo) / Math.max(1, target))
  const out: number[] = []
  const start = Math.ceil(lo / step - 1e-9) * step
  for (let i = 0; i < 240 && start + i * step <= hi + step * 1e-9; i += 1) {
    const v = start + i * step
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  }
  return out
}

/**
 * Domains that comfortably contain every curve and every object — the
 * "just works" framing so nobody hand-tunes axis bounds.
 */
export function fitDomains(anim: Animation): Pick<AnimScene, 'xMin' | 'xMax' | 'yMin' | 'yMax'> {
  const duration = Math.max(0.2, anim.duration)
  let yLo = 0
  let yHi = 0
  let any = false

  for (const s of anim.series) {
    if (!s.visible || !s.expr.trim()) continue
    const [lo, hi] = seriesExtent(s, duration)
    if (!Number.isFinite(lo)) continue
    yLo = Math.min(yLo, lo)
    yHi = Math.max(yHi, hi)
    any = true
  }

  const lookup = seriesLookupOf(anim)
  for (const layer of anim.layers) {
    if (!layer.visible) continue
    const limit = anim.scene.plotSpace === 'time' && layer.mode === 'follow' ? 40 : 60
    for (let i = 0; i <= limit; i += 1) {
      const p = layerPos(layer, (duration * i) / limit, lookup)
      yLo = Math.min(yLo, p.y)
      yHi = Math.max(yHi, p.y)
      any = true
    }
  }

  if (!any) {
    yLo = 0
    yHi = 10
  }
  if (yLo === yHi) {
    yLo -= 1
    yHi += 1
  }
  const pad = (yHi - yLo) * 0.08
  return {
    xMin: 0,
    xMax: anim.scene.plotSpace === 'time' ? duration : Math.max(Math.abs(yHi), Math.abs(yLo)) || 10,
    yMin: yLo - pad,
    yMax: yHi + pad,
  }
}

/* ------------------------------------------------------------------ *
 *  Panels
 * ------------------------------------------------------------------ */

/**
 * The panels a scene actually draws.
 *
 * A scene with no `panels` still has exactly one, described by the scene's own
 * `yMin`/`yMax` — that keeps every pre-panel deck byte-compatible while
 * letting a lecture stack `x(t)`, `v(t)` and `a(t)` in one clock.
 */
export function scenePanels(anim: Animation): AnimPanel[] {
  const { scene } = anim
  if (!scene.panels || scene.panels.length === 0) {
    return [{ id: '', title: scene.yLabel || undefined, yMin: scene.yMin, yMax: scene.yMax, yLabel: scene.yLabel, yTicks: scene.yTicks }]
  }
  return scene.panels
}

/** Index of the panel a series/layer belongs to; `*` means "all of them". */
export function panelIndexOf(panels: AnimPanel[], id: string | undefined): number {
  if (!id) return 0
  const i = panels.findIndex((p) => p.id === id)
  return i < 0 ? 0 : i
}

export function panelTargets(panels: AnimPanel[], id: string | undefined): number[] {
  if (id === '*') return panels.map((_, i) => i)
  return [panelIndexOf(panels, id)]
}

/* ------------------------------------------------------------------ *
 *  Keyframe editing helpers (used by the studio)
 * ------------------------------------------------------------------ */

/** Value a property currently reads at time `t` — used by "add key here". */
export function currentValue(layer: AnimLayer, prop: AnimProp, t: number, lookup?: SeriesLookup): number {
  if (layer.mode === 'follow') {
    if (prop === 'x') return t
    if (prop === 'y') {
      const v = lookup?.(layer.follow ?? '', t)
      return Number.isFinite(v ?? NaN) ? (v as number) : 0
    }
  }
  if (layer.mode === 'expr') {
    if (prop === 'x') return evalExpr(layer.exprX, t, 0)
    if (prop === 'y') return evalExpr(layer.exprY, t, 0)
  }
  const keys = layer.tracks[prop]
  if (!keys || keys.length === 0) {
    return prop === 'size' ? DEFAULT_SIZE : prop === 'opacity' ? 1 : 0
  }
  return sampleKeys(keys, t, keys[0].v)
}

/** Upsert a keyframe at `t` (within `tol` of an existing one, overwrite it). */
export function withKey(
  layer: AnimLayer,
  prop: AnimProp,
  t: number,
  lookup?: SeriesLookup,
  patch: Partial<AnimKey> = {},
): AnimLayer {
  const keys = sortKeys(layer.tracks[prop] ?? [])
  const idx = keys.findIndex((k) => Math.abs(k.t - t) < 1e-3)
  const key: AnimKey =
    idx >= 0
      ? { ...keys[idx], ...patch }
      : {
          id: `k-${prop}-${Math.round(t * 10000)}`,
          t,
          v: currentValue(layer, prop, t, lookup),
          interp: 'ease',
          ...patch,
        }
  const next = idx >= 0 ? keys.map((k, i) => (i === idx ? key : k)) : [...keys, key]
  return { ...layer, tracks: { ...layer.tracks, [prop]: sortKeys(next) } }
}

export function withoutKey(layer: AnimLayer, prop: AnimProp, keyId: string): AnimLayer {
  const keys = (layer.tracks[prop] ?? []).filter((k) => k.id !== keyId)
  return { ...layer, tracks: { ...layer.tracks, [prop]: keys } }
}

/** Every keyframe across all tracks, time-ordered — powers the ◀ ▶ stepper. */
export function allKeyframes(anim: Animation): { t: number; prop: AnimProp; layerId: string; keyId: string }[] {
  const out: { t: number; prop: AnimProp; layerId: string; keyId: string }[] = []
  for (const layer of anim.layers) {
    for (const [prop, keys] of Object.entries(layer.tracks)) {
      for (const k of keys ?? []) out.push({ t: k.t, prop: prop as AnimProp, layerId: layer.id, keyId: k.id })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

export function animationDuration(anim: Animation): number {
  return Math.max(0.2, anim.duration)
}

export function wrapTime(t: number, anim: Animation): number {
  const d = animationDuration(anim)
  if (!anim.loop) return clamp(t, 0, d)
  const w = t % d
  return w < 0 ? w + d : w
}

/** Largest time referenced by any keyframe — used to warn about short durations. */
export function keyframeExtent(anim: Animation): number {
  let max = 0
  for (const layer of anim.layers) {
    for (const keys of Object.values(layer.tracks)) {
      for (const k of keys ?? []) max = Math.max(max, k.t)
    }
  }
  return max
}

/**
 * Is this animation really just a picture?
 *
 * A diagram that happens to be built out of shapes has nothing to animate: no
 * keyframes, no moving series, no formula. Playback chrome and a transport
 * bar around it are noise, so such a block should present itself as an image —
 * the same block type either way, so existing decks keep working and an
 * animation that later gains a keyframe becomes a player again by itself.
 */
export function isStaticAnimation(anim: Animation): boolean {
  const hasSeries = anim.series.some((s) => s.visible && s.expr.trim())
  if (hasSeries) return false
  const layers = anim.layers.filter((l) => l.visible)
  if (layers.length === 0) return false
  return layers.every((l) => {
    if (l.mode !== 'key') return false
    if (l.showVelocity || l.showAcceleration) return false
    // A track is static when every key in it holds the same value. Two keys
    // at the same number is still a picture; two keys at different numbers is
    // motion, however small.
    return Object.values(l.tracks ?? {}).every((keys) => {
      const list = (keys ?? []) as AnimKey[]
      if (list.length === 0) return true
      return list.every((k) => k.v === list[0].v)
    })
  })
}
