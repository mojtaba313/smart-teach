/**
 * Keyframe sampling.
 *
 * v1 interpolated keyframes with `linear | ease | hold` per key and had no
 * option for a smooth curve across the whole track, so an acceleration graph
 * derived by finite differences showed a −500 spike at every keyframe
 * boundary. `smooth` (monotone cubic / PCHIP) fixes that, and — this is the
 * part that matters — it is differentiable in closed form, so velocity and
 * acceleration come from the derivative rather than from sampling noise.
 */

import type { Ease, Key } from '../../types/anim2'

/* ------------------------------------------------------------------ *
 *  Cubic bezier
 * ------------------------------------------------------------------ */

type Bezier = {
  ax: number; bx: number; cx: number
  ay: number; by: number; cy: number
  dx: number; dy: number
  x1: number; y1: number; x2: number; y2: number
}

/**
 * The named eases are the *quadratic* curves v1 used, deliberately, not the
 * CSS cubic-beziers of the same names.
 *
 * This matters: 23 animations already exist in the product, and swapping
 * `ease` from easeInOutQuad to cubic-bezier(0.25, 0.1, 0.25, 1) changes the
 * speed of every one of them — a body that reached a point at 50% of the way
 * would suddenly arrive at 80%. Parity won. Anyone who wants a CSS curve
 * writes `cubic-bezier(0.25, 0.1, 0.25, 1)` explicitly.
 *
 * They are also exactly differentiable, which is not true of a bezier solved
 * per frame.
 */
export type NamedEase = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'hold'

export function easeValue(kind: string, u: number): number {
  const x = Math.min(1, Math.max(0, u))
  switch (kind) {
    case 'hold':
      return 0
    case 'easeIn':
      return x * x
    case 'easeOut':
      return 1 - (1 - x) * (1 - x)
    case 'ease':
      return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x)
    case 'linear':
    default:
      return x
  }
}

export function easeDerivative(kind: string, u: number): number {
  const x = Math.min(1, Math.max(0, u))
  switch (kind) {
    case 'hold':
      return 0
    case 'easeIn':
      return 2 * x
    case 'easeOut':
      return 2 * (1 - x)
    case 'ease':
      return x < 0.5 ? 4 * x : 4 * (1 - x)
    case 'linear':
    default:
      return 1
  }
}

function makeBezier(x1: number, y1: number, x2: number, y2: number): Bezier {
  // Polynomial coefficients of the parametric curve, so evaluation is cheap.
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  return {
    ax, bx, cx, ay, by, cy,
    dx: 3 * ax, dy: 3 * ay,
    x1, y1, x2, y2,
  }
}

const bezierCache = new Map<string, Bezier>()

export function bezierOf(ease: string): Bezier | null {
  if (ease.startsWith('cubic-bezier(')) {
    const hit = bezierCache.get(ease)
    if (hit) return hit
    const parts = ease.slice(12, -1).split(',').map((s) => Number(s.trim()))
    if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) return null
    const b = makeBezier(parts[0], parts[1], parts[2], parts[3])
    bezierCache.set(ease, b)
    return b
  }
  return null
}

function bezierX(b: Bezier, t: number): number {
  return ((b.ax * t + b.bx) * t + b.cx) * t
}

function bezierY(b: Bezier, t: number): number {
  return ((b.ay * t + b.by) * t + b.cy) * t
}

/**
 * Solve x(t) = x for t. Newton converges in a couple of steps for the
 * well-behaved curves authors write; bisection is the safety net for the
 * pathological ones.
 */
function bezierT(b: Bezier, x: number): number {
  let t = x
  for (let i = 0; i < 8; i += 1) {
    const err = bezierX(b, t) - x
    if (Math.abs(err) < 1e-9) return t
    const slope = b.dx * t * t + 2 * b.bx * t + b.cx
    if (Math.abs(slope) < 1e-9) break
    t -= err / slope
  }
  let lo = 0
  let hi = 1
  t = x
  for (let i = 0; i < 40; i += 1) {
    const v = bezierX(b, t)
    if (Math.abs(v - x) < 1e-9) break
    if (v > x) hi = t
    else lo = t
    t = (lo + hi) / 2
  }
  return t
}

/* ------------------------------------------------------------------ *
 *  Track preparation
 * ------------------------------------------------------------------ */

/** A track with its keys sorted and, if asked, its PCHIP tangents solved. */
export type Track = {
  keys: Key[]
  /** Tangents for `smooth`, one per key. */
  tangents: number[] | null
  smooth: boolean
}

export function prepareTrack(keys: readonly Key[]): Track {
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const smooth = sorted.some((k) => k.ease === 'smooth')
  if (!smooth || sorted.length < 3) return { keys: sorted, tangents: null, smooth: false }
  return { keys: sorted, tangents: pchipTangents(sorted), smooth: true }
}

/** Fritsch–Carlson monotone tangents: no overshoot between keys. */
function pchipTangents(keys: Key[]): number[] {
  const n = keys.length
  const h: number[] = []
  const delta: number[] = []
  for (let i = 0; i < n - 1; i += 1) {
    const step = keys[i + 1].t - keys[i].t
    h.push(step || 1e-9)
    delta.push((keys[i + 1].v - keys[i].v) / (step || 1e-9))
  }

  const m: number[] = new Array(n)
  m[0] = delta[0]
  m[n - 1] = delta[n - 2]
  for (let i = 1; i < n - 1; i += 1) {
    const d0 = delta[i - 1]
    const d1 = delta[i]
    if (d0 * d1 <= 0) {
      // A local extremum: a zero tangent is what keeps it from overshooting.
      m[i] = 0
    } else {
      const w1 = 2 * h[i] + h[i - 1]
      const w2 = h[i] + 2 * h[i - 1]
      m[i] = (w1 + w2) / (w1 / d0 + w2 / d1)
    }
  }
  return m
}

/* ------------------------------------------------------------------ *
 *  Sampling
 * ------------------------------------------------------------------ */

/** Index of the last key at or before `t`, or -1 when `t` is before them all. */
function segmentIndex(keys: Key[], t: number): number {
  let lo = 0
  let hi = keys.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (keys[mid].t <= t) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

/** Value of a prepared track at `t`, clamped outside its key range. */
export function sampleTrack(track: Track, t: number): number {
  const { keys } = track
  const n = keys.length
  if (n === 0) return 0
  if (n === 1 || t <= keys[0].t) return keys[0].v
  if (t >= keys[n - 1].t) return keys[n - 1].v

  const i = segmentIndex(keys, t)
  const a = keys[i]
  const b = keys[i + 1]
  const h = b.t - a.t
  const u = (t - a.t) / h

  if (track.smooth && track.tangents) {
    const m0 = track.tangents[i]
    const m1 = track.tangents[i + 1]
    const u2 = u * u
    const u3 = u2 * u
    return (
      (2 * u3 - 3 * u2 + 1) * a.v +
      (u3 - 2 * u2 + u) * h * m0 +
      (-2 * u3 + 3 * u2) * b.v +
      (u3 - u2) * h * m1
    )
  }

  const ease = a.ease ?? 'linear'
  if (ease === 'smooth') return a.v + (b.v - a.v) * u
  if (ease.startsWith('cubic-bezier(')) {
    const bez = bezierOf(ease)
    if (!bez) return a.v + (b.v - a.v) * u
    const bt = bezierT(bez, u)
    return a.v + (b.v - a.v) * bezierY(bez, bt)
  }
  return a.v + (b.v - a.v) * easeValue(ease, u)
}

/**
 * d/dt of a prepared track. Exact for `smooth` and for beziers (the ratio of
 * the parametric derivatives), constant for `hold`.
 */
export function sampleTrackDerivative(track: Track, t: number): number {
  const { keys } = track
  const n = keys.length
  if (n === 0) return 0
  if (n === 1 || t <= keys[0].t || t >= keys[n - 1].t) return 0

  const i = segmentIndex(keys, t)
  const a = keys[i]
  const b = keys[i + 1]
  const h = b.t - a.t
  const u = (t - a.t) / h

  if (track.smooth && track.tangents) {
    const m0 = track.tangents[i]
    const m1 = track.tangents[i + 1]
    const u2 = u * u
    return (
      ((6 * u2 - 6 * u) * a.v) / h +
      (3 * u2 - 4 * u + 1) * m0 +
      ((-6 * u2 + 6 * u) * b.v) / h +
      (3 * u2 - 2 * u) * m1
    )
  }

  const ease = a.ease ?? 'linear'
  if (ease === 'smooth') return (b.v - a.v) / h
  if (ease.startsWith('cubic-bezier(')) {
    const bez = bezierOf(ease)
    if (!bez) return (b.v - a.v) / h
    const bt = bezierT(bez, u)
    const dy = bez.dy * bt * bt + 2 * bez.by * bt + bez.cy
    const dx = bez.dx * bt * bt + 2 * bez.bx * bt + bez.cx
    return Math.abs(dx) < 1e-12 ? 0 : ((b.v - a.v) * dy) / (dx * h)
  }
  return (b.v - a.v) * easeDerivative(ease, u) / h
}

/** Convenience for one-off evaluation without keeping a Track around. */
export function sampleKeys(keys: readonly Key[], t: number): number {
  return sampleTrack(prepareTrack(keys), t)
}

export function sampleKeysDerivative(keys: readonly Key[], t: number): number {
  return sampleTrackDerivative(prepareTrack(keys), t)
}

/** True when any key on the track asks for a whole-track smooth curve. */
export function trackIsSmooth(keys: readonly Key[]): boolean {
  return keys.some((k) => k.ease === 'smooth')
}

export type { Ease }