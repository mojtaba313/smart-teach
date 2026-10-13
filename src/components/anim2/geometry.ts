/**
 * View geometry for the v2 renderer.
 *
 * v1 had `plotSpace: 'time' | 'free'` and a `panels` array, which meant the
 * renderer had to know whether it was drawing a graph or a diagram. v2 has
 * neither: a scene is a box, an `axes` node is a rectangle inside that box
 * with two domains, and a node's transform is interpreted in whichever axes
 * node encloses it. No axes node means plain scene units.
 */

import type { Point2 } from '../../types/anim2'

export const SCENE_WIDTH = 1000

export type Box = { x: number; y: number; w: number; h: number }

export type View = {
  /** SVG view-box, y down. */
  width: number
  height: number
}

export function viewFor(aspect: number | undefined, height: number | undefined): View {
  const h = height && height > 0 ? height : SCENE_WIDTH * (aspect ?? 0.62)
  return { width: SCENE_WIDTH, height: h }
}

export function fracBox(rect: [number, number, number, number], view: View): Box {
  return { x: rect[0] * view.width, y: rect[1] * view.height, w: rect[2] * view.width, h: rect[3] * view.height }
}

/**
 * A coordinate frame. `sx`/`sy` map data units to scene units; `sy` is
 * flipped because SVG's y grows downward and an axis should grow upward.
 */
export type Frame = {
  box: Box
  xDomain: [number, number]
  yDomain: [number, number]
  sx(x: number): number
  sy(y: number): number
  /** Inverse maps, for hit-testing in the studio. */
  ix(px: number): number
  iy(py: number): number
  /**
   * A length in data units expressed in scene units. Annotation that has size
   * rather than position — a stroke width, an arrow head, a protractor radius
   * — has to go through this, or it stays the same size on screen while the
   * axes zoom underneath it.
   */
  scale(v: number): number
}

export function makeFrame(
  box: Box,
  xDomain: [number, number],
  yDomain: [number, number],
): Frame {
  const dx = xDomain[1] - xDomain[0]
  const dy = yDomain[1] - yDomain[0]
  const sx = (x: number): number => box.x + (dx === 0 ? 0 : ((x - xDomain[0]) / dx) * box.w)
  const sy = (y: number): number => box.y + box.h - (dy === 0 ? 0 : ((y - yDomain[0]) / dy) * box.h)
  return {
    box,
    xDomain,
    yDomain,
    sx,
    sy,
    ix: (px: number) => xDomain[0] + (box.w === 0 ? 0 : ((px - box.x) / box.w) * dx),
    iy: (py: number) => yDomain[0] + (box.y + box.h === py ? 0 : ((box.y + box.h - py) / box.h) * dy),
    scale: (v: number) => (dx === 0 ? v : (v * box.w) / dx),
  }
}

/** The identity frame: scene units, y up. */
export function freeFrame(view: View): Frame {
  return makeFrame({ x: 0, y: 0, w: view.width, h: view.height }, [0, view.width], [view.height, 0])
}

/**
 * Split a path's points into the drawn prefix and the remainder.
 *
 * `trim` is the generic reveal: 0 draws nothing, 1 draws everything. It works
 * on anything with an outline, which is what replaced `series.reveal` — a
 * boolean bound to the global clock could not be delayed and had no duration.
 */
export function trimPath(points: Point2[], trim: number): string {
  if (points.length === 0) return ''
  if (trim >= 0.999) return pointsToD(points, false)
  if (trim <= 0.001) return ''
  return pointsToD(points.slice(0, Math.max(2, Math.ceil(points.length * trim))), false)
}

export function pointsToD(points: Point2[], close: boolean): string {
  if (points.length === 0) return ''
  let d = `M ${round(points[0][0])} ${round(points[0][1])}`
  for (let i = 1; i < points.length; i += 1) d += ` L ${round(points[i][0])} ${round(points[i][1])}`
  if (close) d += ' Z'
  return d
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Polyline for a plot, skipping points where the expression was not finite. */
export function smoothStroke(points: Point2[], close: boolean): string {
  if (points.length === 0) return ''
  let d = `M ${round(points[0][0])} ${round(points[0][1])}`
  for (let i = 1; i < points.length; i += 1) d += ` L ${round(points[i][0])} ${round(points[i][1])}`
  if (close) d += ' Z'
  return d
}

/** Nice round tick positions covering a domain. */
export function ticksFor(domain: [number, number], count: number): number[] {
  const [lo, hi] = domain
  const span = hi - lo
  if (!Number.isFinite(span) || span <= 0 || count < 1) return []
  const rawStep = span / count
  const mag = 10 ** Math.floor(Math.log10(rawStep))
  const norm = rawStep / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const out: number[] = []
  const first = Math.ceil(lo / step) * step
  for (let v = first; v <= hi + step * 1e-9 && out.length < 200; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toFixed(10)))
  }
  return out
}

/** Human label for an axis tick, trimming the noise digits. */
export function tickLabel(v: number): string {
  if (v === 0) return '۰'
  const abs = Math.abs(v)
  const decimals = abs >= 100 ? 0 : abs >= 1 ? 1 : 2
  const text = v.toFixed(decimals)
  const trimmed = text.replace(/\.?0+$/, '')
  return trimmed.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}