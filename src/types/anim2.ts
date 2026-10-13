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

export type AnimAction =
  | { type: 'show'; target: string }
  | { type: 'hide'; target: string }
  | { type: 'fadeIn'; target: string; duration: number }
  | { type: 'fadeOut'; target: string; duration: number }
  | { type: 'setVar'; name: string; expr: string }
  | { type: 'playSound'; href: string; volume?: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'jumpTo'; t: number }
  | {
      type: 'spawnParticles'
      at: [string, string]
      count: number
      color: string
      speed: number
      lifetime: number
      shape?: 'dot' | 'spark' | 'star'
    }
  | { type: 'shake'; target: string; amplitude: number; duration: number }
  | { type: 'flash'; target: string; color: string; duration: number }
  | { type: 'log'; message: string }

/* ------------------------------------------------------------------ *
 *  Parameters — the knobs a viewer may turn
 * ------------------------------------------------------------------ */

export type Param = {
  /**
   * The knob's current reading. A slider, toggle, select and button all write
   * back to this one number, so an expression can mix them freely: `q` is a
   * slider in one scene and a toggle in the next without the formula changing.
   *
   * A select indexes into `options`; a toggle uses 0 and 1.
   */
  value: number
  min?: number
  max?: number
  step?: number
  /** Shown next to the control. Defaults to the parameter name. */
  label?: string
  /**
   * Which control to draw. `slider` is the default and the only one v1
   * understood, so an old document keeps working untouched.
   */
  control?: 'slider' | 'toggle' | 'select' | 'button'
  /** Choice labels for `control: 'select'`, indexed by value. */
  options?: string[]
  /**
   * What a button or toggle does. Omitted means "just change the value", which
   * is right for a toggle that gates a `when` condition. Set it to run scene
   * actions — the same list an event carries — when pressed.
   */
  actions?: AnimAction[]
  /**
   * Seconds a button holds its value before it resets to `resetTo`. This is how
   * a single "apply" button can kick one simulation step and fall back to
   * neutral, instead of latching forever.
   */
  pulseFor?: number
  /** Where a pulsed control returns. Defaults to its starting value. */
  resetTo?: number
  /** When true the presenter/viewer shows a live control for it. */
  slider?: boolean
}

/* ------------------------------------------------------------------ *
 *  Timeline
 * ------------------------------------------------------------------ */

/**
 * A named moment. `pause` stops playback there; Space resumes, which is how
 * a lesson asks a question without leaving the animation.
 */
export type AnimEventDef = {
  id: string
  /** A boolean expression, e.g. `"r < 1.5"`. */
  when: string
  actions: AnimAction[]
  /** Fire only the first time. Defaults to true. */
  once?: boolean
  /** Seconds before it may fire again. Defaults to 0. */
  cooldown?: number
}

/**
 * A named slice of the timeline. A lesson often has to stop at the question and
 * resume on demand, and re-authoring the whole animation as three separate
 * blocks to achieve that loses the continuity between them.
 */
export type Segment = {
  id: string
  label?: string
  /** Seconds from the start of the animation. Defaults to 0. */
  from?: number
  /** Seconds from the start. Defaults to the animation duration. */
  to?: number
}

export type Playback = {
  /** Restrict playback to these slices. Empty or absent means the whole thing. */
  segments?: Segment[]
  /**
   * Reverse at the end of each segment and go again. The natural way to show
   * an oscillation or a return stroke without a duplicate.
   */
  pingPong?: boolean
  /** Begin at this second rather than 0. */
  startAt?: number
  /** Stop at this second; the clock clamps rather than looping past it. */
  stopAt?: number
  /** Playback rate multiplier applied on top of `speed`. */
  rate?: number
}

export type Cue = {
  t: number
  label: string
  pause?: boolean
}

/* ------------------------------------------------------------------ *
 *  Drawings — annotation geometry that is not a scene node
 * ------------------------------------------------------------------ */

/**
 * A point in the scene's own coordinates, so a drawing means the same thing
 * with or without an `axes` node. Both components may be expressions, which is
 * what lets a force arrow follow a moving charge.
 */
/**
 * A bare string is an expression, matching every other numeric field in the
 * schema — `{ "x": "(px+1)/2" }` is the form a hand-written drawing uses.
 */
export type DrawPoint = { x: NumProp | string; y: NumProp | string }

export type DrawStyle = {
  stroke?: string
  width?: NumProp | string
  opacity?: NumProp | string
  dashed?: boolean
  /** `end` is the default; `both` suits dimensions, `start` a tail. */
  head?: 'none' | 'end' | 'start' | 'both'
  /** Arrow head size in scene units. */
  headSize?: NumProp | string
}

export type ArrowDrawing = {
  id: string
  kind: 'arrow'
  from: DrawPoint
  to: DrawPoint
  /** Bows the shaft. 0 is straight; sign picks the side. */
  curvature?: NumProp | string
  label?: string
  /** Place the label at the middle of a curved shaft instead of the chord. */
  labelOnCurve?: boolean
  style?: DrawStyle
  time?: NodeTime
}

export type DimensionDrawing = {
  id: string
  kind: 'dimension'
  from: DrawPoint
  to: DrawPoint
  /** Perpendicular distance the witness lines and arrow row are pushed out. */
  offset?: NumProp | string
  label?: string
  style?: DrawStyle
  time?: NodeTime
}

export type ProtractorDrawing = {
  id: string
  kind: 'protractor'
  center: DrawPoint
  radius: NumProp | string
  /** Degrees, counter-clockwise from the +x axis. */
  startDeg: NumProp | string
  endDeg: NumProp | string
  /** Degrees between tick marks. Set 0 for none. */
  tickDeg?: NumProp | string
  /** Major tick every n ticks, labelled. */
  labelEvery?: number
  style?: DrawStyle
  time?: NodeTime
}

export type LabelDrawing = {
  id: string
  kind: 'label'
  at: DrawPoint
  text: string | { expr: string } | { keys: { id: string; t: number; v: string }[] }
  size?: NumProp | string
  rotation?: NumProp | string
  /** Where the box sits relative to the point. */
  anchor?: 'start' | 'middle' | 'end'
  baseline?: 'auto' | 'middle' | 'hanging' | 'alphabetic'
  color?: string
  background?: string
  padding?: NumProp
  style?: DrawStyle
  time?: NodeTime
}

export type Drawing = ArrowDrawing | DimensionDrawing | ProtractorDrawing | LabelDrawing

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
  /**
   * 0..1 opacity of the fill, separate from the node's overall `opacity`. A
   * shape can be faint without also fading its label or its children.
   */
  fillOpacity?: NumProp
  /** Gaussian blur in scene units; a cheap depth or glow cue. */
  blur?: NumProp
  /**
   * Tint by hue rotation in degrees, 0..360, without touching saturation or
   * lightness. Lets one colour serve a family of states while keeping the
   * contrast the author chose.
   */
  hueRotate?: NumProp
  /** Multiply the fill's lightness; 1 leaves it alone, 0.5 darkens it. */
  brightness?: NumProp
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
  | 'shape'
  | 'group'
  | 'axes'
  | 'use'

export type NodeBase = {
  id: string
  name?: string
  visible?: boolean
  /**
   * Named attachment points, in the node's **own** units relative to its
   * transform. This is what makes a force arrow attachable: a spring anchored
   * at a bob's top reads the node's position *and* its rotation, so the hook
   * stays put while the body swings.
   *
   * ```json
   * "anchors": { "top": { "x": 0, "y": "-r" } }
   * ```
   *
   * Expressions inside an anchor may read the node's own properties, which the
   * engine supplies as `self.x`, `self.y`, `self.angle` — but *not* another
   * node's, which would need a cycle check per pair.
   */
  anchors?: Record<string, Anchor>
  /** Locked nodes are not selectable and cannot be dragged in the studio. */
  locked?: boolean
  time?: NodeTime
  transform: Transform
  motionPath?: MotionPath
  style?: NodeStyle
  /** Summary line for the scene tree and for accessibility. */
  description?: string
}

export type Anchor = {
  /** Offset along the node's local x axis, before rotation. */
  x: NumProp | string
  /** Offset along the node's local y axis. Positive is down, as in SVG. */
  y: NumProp | string
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

/**
 * A reusable shape, drawn from a parametric outline rather than a point list.
 *
 * This is the part that makes the engine a physics renderer instead of a
 * kinematics one: a ramp, a wedge and an incline are all `wedge(r)` at
 * different parameters, so a scene can name them instead of hard-coding paths
 * per body — which is what a lesson on inclined planes needs.
 *
 * ```json
 * "shapes": {
 *   "ramp": { "path": "M -w/2 h L w/2 h L w/2 0 Z",
 *             "params": { "w": 4, "h": 1 } }
 * }
 * ```
 *
 * `w`, `h`, `r`, `a`, `n` are bound before evaluation, so `params` may set
 * them to expressions and the outline follows the physics.
 */
export type ShapeDef = {
  /** SVG path data, with `w h r a n` as bare numbers in the arithmetic. */
  path: string
  /** Default parameter values; an expression here may read `t`. */
  params?: Record<string, NumProp>
  /** Centroid offset applied after the outline, in scene units. */
  offset?: { x?: NumProp; y?: NumProp }
}

export type ShapeNode = NodeBase & {
  type: 'shape'
  /** Key into the scene's `shapes` table. */
  shape: string
  params?: Record<string, NumProp>
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
  /**
   * Force one scene unit to the same length on both axes. Off by default
   * because a lesson panel is rarely square, but a pendulum or an orbit must
   * not be drawn on a stretched grid — with it on, the y domain widens to
   * match rather than the shapes being squashed.
   */
  equalAspect?: boolean
  /** Per-axis base-10 logarithm. Non-positive inputs are clamped. */
  logScale?: { x?: boolean; y?: boolean }
  /** Hide one axis without removing it; the other keeps its full layout. */
  visible?: { x?: boolean; y?: boolean }
  /**
   * Per-axis domain overrides, so a y axis can be zoomed to a detail while x
   * stays shared with a second plot. Applied after `logScale`.
   */
  xMin?: NumProp
  xMax?: NumProp
  yMin?: NumProp
  yMax?: NumProp
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
  | ShapeNode
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
 *  Actions — one vocabulary for events, control buttons and keyframes
 * ------------------------------------------------------------------ */

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
  /** Segments, ping-pong and start/stop bounds. */
  playback?: Playback
  /** Live knobs. Available by name in every expression. */
  params: Record<string, Param>
  /**
   * Derived quantities, written once and read by any expression: name →
   * expression. Resolved in dependency order, so order in the object does not
   * matter and a cycle is reported rather than silently mis-evaluated.
   *
   * ```json
   * "vars": { "r2": "(x2 - x1)^2", "F": "9e9 * q1 * q2 / max(r2, 0.01)" }
   * ```
   */
  vars?: Record<string, string>
  /**
   * Conditions that fire on the **rising edge** — on the frame a condition
   * becomes true, not on every frame it stays true. Each carries the same
   * actions a control button does.
   *
   * ```json
   * "events": [{ "id": "spark", "when": "r < 1.5",
   *   "actions": [{ "type": "spawnParticles", "at": ["(x1+x2)/2", "0"],
   *     "count": 20, "color": "#fbbf24", "speed": 3, "lifetime": 0.8 }] }]
   * ```
   */
  events?: AnimEventDef[]
  cues: Cue[]
  /** Top-level nodes, in canvas units. */
  nodes: Node[]
  /**
   * Annotation geometry drawn under the nodes: arrows, dimensions,
   * protractors and labels. Kept out of `nodes` because these are decoration
   * rather than physics — they never take part in selection handles, and a
   * hand-drawn force arrow should not get a bounding box in the timeline.
   */
  drawings?: Drawing[]
  /** Template library available to `use` nodes in this animation. */
  templates?: Record<string, Template>
  /** Named outlines available to `shape` nodes. */
  shapes?: Record<string, ShapeDef>
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