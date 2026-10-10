/**
 * Animation schema v2.
 *
 * The whole point of this file is that it knows nothing about kinematics.
 * There is no velocity, no acceleration, no secant: those are *templates*
 * (data) built out of lines, arrows and expressions that happen to mention
 * `d()`. A dynamics chapter is a new template library, not new engine code.
 *
 * Everything a teacher animates is one of four primitives:
 *   - a number that changes with time  → {@link NumProp}
 *   - a shape that sits somewhere      → {@link Node}
 *   - a coordinate frame to sit in     → an `axes` node
 *   - a curve                         → a `plot` node
 */

/** Discriminator stamped on every v2 animation. */
export const ANIM2_SCHEMA = 2 as const

/* ------------------------------------------------------------------ *
 *  Interpolation
 * ------------------------------------------------------------------ */

/** Named eases. `cubic-bezier(...)` is written inline as a string. */
export type EaseName = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'hold'

/**
 * How to leave a keyframe and reach the next one.
 * `smooth` is monotone cubic (PCHIP) across the whole track, which is what
 * stops acceleration graphs from spiking at keyframe boundaries.
 */
export type Ease = EaseName | `cubic-bezier(${number},${number},${number},${number})` | 'smooth'

export type Key = {
  /** Unique across the whole animation — not per track. */
  id: string
  /** Seconds. */
  t: number
  v: number
  ease?: Ease
}

/**
 * A number that can be constant, computed, or keyed.
 *
 * `number` is the cheap case and the one you should reach for by default;
 * anything else exists for motion you cannot write a formula for.
 */
export type NumProp = number | { expr: string } | { keys: Key[] }

/** Non-numeric props only interpolate with `hold`, except `interp`. */
export type ColorKey = { id: string; t: number; v: string; ease?: EaseName | 'smooth' }
export type ColorProp = string | { keys: ColorKey[] }

/**
 * Text may be literal, held across keys, computed from a formula, or built
 * by interpolating other values into a template:
 *
 *   { interp: 'v = {round(v0 + a*t, 2)} m/s' }
 */
export type TextProp =
  | string
  | { keys: ColorKey[]; format?: (v: string) => string }
  | { expr: string; format?: string }
  | { interp: string }

/* ------------------------------------------------------------------ *
 *  Parameters — the knobs a viewer may turn
 * ------------------------------------------------------------------ */

export type Param = {
  value: number
  min?: number
  max?: number
  step?: number
  /** Shown next to the slider. Defaults to the parameter name. */
  label?: string
  /** When true the presenter/viewer shows a live slider for it. */
  slider?: boolean
}

/* ------------------------------------------------------------------ *
 *  Timeline
 * ------------------------------------------------------------------ */

/**
 * A named moment. `pause` stops playback there; Space resumes, which is how
 * a lesson asks a question without leaving the animation.
 */
export type Cue = {
  t: number
  label: string
  pause?: boolean
}

/**
 * Per-node time window. The node exists only inside it, and `lt` — local
 * time — runs from 0 at `start`, so a delayed animation is written against
 * its own clock rather than the scene's.
 */
export type NodeTime = {
  start?: number
  end?: number
}

export type Transform = {
  x: NumProp
  y: NumProp
  scaleX: NumProp
  scaleY: NumProp
  rotation: NumProp
  opacity: NumProp
}

/**
 * Travel along a drawn path instead of free coordinates.
 *
 * `progress` defaults to `lt / duration`, measured in *arc length*, so the
 * object moves at a constant speed rather than racing through corners.
 */
export type MotionPath = {
  points: Point2[]
  closed?: boolean
  /** Centripetal Catmull-Rom: a "circle" stays a circle. */
  smooth?: boolean
  progress?: NumProp
}

export type Point2 = [number, number]

export type NodeStyle = {
  fill?: ColorProp
  stroke?: ColorProp
  strokeWidth?: NumProp
  /** Dash pattern length in px; 0 or undefined is solid. */
  dash?: NumProp
  /**
   * 0..1 draw progress of the stroke. This is the generic "reveal" — it
   * works on a path, a plot, a line, a polygon, anything with an outline,
   * and unlike a boolean it can be delayed, ramped or keyed.
   */
  trim?: NumProp
}

/* ------------------------------------------------------------------ *
 *  Nodes
 * ------------------------------------------------------------------ */

export type NodeType =
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'path'
  | 'text'
  | 'image'
  | 'plot'
  | 'group'
  | 'axes'
  | 'use'

export type NodeBase = {
  id: string
  name?: string
  visible?: boolean
  /** Locked nodes are not selectable and cannot be dragged in the studio. */
  locked?: boolean
  time?: NodeTime
  transform: Transform
  motionPath?: MotionPath
  style?: NodeStyle
  /** Summary line for the scene tree and for accessibility. */
  description?: string
}

export type RectNode = NodeBase & {
  type: 'rect'
  w?: NumProp
  h?: NumProp
  /** Corner radius. */
  rx?: NumProp
}

export type EllipseNode = NodeBase & {
  type: 'ellipse'
  rx?: NumProp
  ry?: NumProp
}

export type LineNode = NodeBase & {
  type: 'line'
  /** The line runs from transform (x,y) to (x2,y2) if given, else +length. */
  length?: NumProp
  arrowHead?: { start?: boolean; end?: boolean; size?: NumProp }
}

export type PathNode = NodeBase & {
  type: 'path'
  points?: Point2[]
  /** Alternative to `points`: sample the curve instead of listing it. */
  parametric?: { xExpr: string; yExpr: string; samples?: number }
  closed?: boolean
}

export type TextNode = NodeBase & {
  type: 'text'
  text: TextProp
  fontSize?: NumProp
  anchor?: 'start' | 'middle' | 'end'
  /** Render through KaTeX when available. */
  latex?: boolean
}

export type ImageNode = NodeBase & {
  type: 'image'
  href: string
  w?: NumProp
  h?: NumProp
}

export type PlotNode = NodeBase & {
  type: 'plot'
  /** y as a function of the axis variable `x`. */
  expr?: string
  /** Or a parametric curve over `u`, for things x is not a function of. */
  parametric?: { xExpr: string; yExpr: string }
  domain?: [number, number]
  samples?: number
  /**
   * How to draw. Named `draw` rather than `style` to avoid colliding with
   * {@link NodeStyle}, which is about ink, not about what the curve is.
   */
  draw?: 'line' | 'dashed' | 'dots' | 'fill'
}

/** A plain group: children share the parent's transform, in canvas units. */
export type GroupNode = NodeBase & {
  type: 'group'
  children: Node[]
}

/**
 * A coordinate frame. Children are positioned in *data units* of this frame,
 * so `x: 2` means "2 on this axis", not "2 pixels". Several axes nodes in
 * one scene give stacked panels that still share a single clock.
 */
export type AxesNode = NodeBase & {
  type: 'axes'
  axes: AxesSpec
  children: Node[]
}

export type AxesSpec = {
  xDomain: [number, number]
  yDomain: [number, number]
  /** Fractional [x, y, w, h] of the scene, 0..1. */
  rect: [number, number, number, number]
  /** Tick counts; capped at import so a bad number cannot hang the browser. */
  ticks?: { x?: number; y?: number }
  labels?: { x?: string; y?: string }
  grid?: boolean
  arrows?: { x?: boolean; y?: boolean }
}

/** An instance of a template, with optional overrides of its parameters. */
export type UseNode = NodeBase & {
  type: 'use'
  template: string
  props?: Record<string, NumProp>
}

export type Node =
  | RectNode
  | EllipseNode
  | LineNode
  | PathNode
  | TextNode
  | ImageNode
  | PlotNode
  | GroupNode
  | AxesNode
  | UseNode

/* ------------------------------------------------------------------ *
 *  Templates
 * ------------------------------------------------------------------ */

export type Template = {
  id: string
  name: string
  description?: string
  /** Parameters the template expects; a `use` node may override any of them. */
  params?: Record<string, Param>
  nodes: Node[]
}

/* ------------------------------------------------------------------ *
 *  Scene
 * ------------------------------------------------------------------ */

export type Scene2 = {
  /** View-box size. `aspect` is derived from these when omitted. */
  width?: number
  height?: number
  aspect?: number
  background?: ColorProp
  /** Free mode: no coordinate frame is assumed anywhere. */
  free?: boolean
}

export type Animation2 = {
  schema: typeof ANIM2_SCHEMA
  title: string
  /** Seconds. Clamped to LIMITS on import. */
  duration: number
  loop?: boolean
  autoplay?: boolean
  speed?: number
  /** Live knobs. Available by name in every expression. */
  params: Record<string, Param>
  cues: Cue[]
  /** Top-level nodes, in canvas units. */
  nodes: Node[]
  /** Template library available to `use` nodes in this animation. */
  templates?: Record<string, Template>
  readout?: boolean
  scene?: Scene2
}

/* ------------------------------------------------------------------ *
 *  Limits — enforced at import, never assumed at render
 * ------------------------------------------------------------------ */

export const LIMITS = {
  maxNodes: 500,
  maxExprLength: 500,
  maxTemplateDepth: 8,
  maxPlotSamples: 2000,
  minDuration: 0.2,
  maxDuration: 600,
  maxTicks: 40,
  maxKeysPerProp: 500,
  maxTemplates: 200,
} as const

/* ------------------------------------------------------------------ *
 *  Small helpers shared by the compiler, studio and validators
 * ------------------------------------------------------------------ */

let uidCounter = 0

/**
 * Ids must be unique across the whole animation, not per track — v1 derived
 * them from `t` and `|v|`, so "move to (0,1) then back" collided.
 */
export function uid(prefix = 'n'): string {
  uidCounter += 1
  return `${prefix}${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function isExpr(p: NumProp | undefined): p is { expr: string } {
  return !!p && typeof p === 'object' && 'expr' in p
}

export function isKeyed(p: NumProp | undefined): p is { keys: Key[] } {
  return !!p && typeof p === 'object' && 'keys' in p
}

export function numOf(p: NumProp | undefined, fallback = 0): number {
  if (typeof p === 'number') return Number.isFinite(p) ? p : fallback
  if (isExpr(p)) return fallback
  if (isKeyed(p)) return p.keys.length ? p.keys[p.keys.length - 1].v : fallback
  return fallback
}

export function emptyTransform(): Transform {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }
}

export function emptyAnimation2(title = ''): Animation2 {
  return {
    schema: ANIM2_SCHEMA,
    title,
    duration: 6,
    loop: false,
    autoplay: false,
    speed: 1,
    params: {},
    cues: [],
    nodes: [],
  }
}