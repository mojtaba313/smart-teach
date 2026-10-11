/**
 * The built-in template library.
 *
 * This file is the whole point of the v2 rewrite. `velocityArrow`,
 * `freeBodyDiagram`, `averageWindow` and the rest used to be engine features
 * with their own types, their own inspector sections and their own renderer
 * branches. Here they are *data*: a subtree of generic nodes that any teacher
 * can read, copy and edit.
 *
 * Two rules keep this honest:
 *
 * 1. A template never names a concept the types do not have. There is no
 *    "acceleration" field anywhere below — there is a line whose length is an
 *    expression, and `d()` in that expression.
 * 2. Nothing here is special-cased by the engine. Expanding a template is the
 *    same substitution as expanding any other `use` node.
 */

import {
  type Animation2,
  type AxesNode,
  type EllipseNode,
  type GroupNode,
  type LineNode,
  type Node,
  type NumProp,
  type Param,
  type Point2,
  type RectNode,
  type Template,
  type TextNode,
  type Transform,
  emptyAnimation2,
  emptyTransform,
  uid,
} from '../../types/anim2'

const T = emptyTransform()

/* ------------------------------------------------------------------ *
 *  Small builders, so the templates below read as diagrams
 * ------------------------------------------------------------------ */

/**
 * Transform overrides may be written as plain numbers or as bare formula
 * strings, so a template reads like a diagram rather than like type
 * declarations: `{ rotation: 'deg(atan2(vy, vx))' }`.
 */
type LooseTransform = Partial<Record<keyof Transform, number | string>>

type Over<T> = Omit<Partial<T>, 'id' | 'transform'> & {
  id?: string
  transform?: LooseTransform
}

function withTransform(t?: LooseTransform): Transform {
  const out = { ...T } as Transform
  for (const [key, value] of Object.entries(t ?? {})) {
    if (typeof value === 'string') (out as unknown as Record<string, NumProp>)[key] = { expr: value }
    else if (typeof value === 'number') (out as unknown as Record<string, number>)[key] = value
  }
  return out
}

function rect(over: Over<RectNode>): Node {
  // `...over` first: spreading after would put the loose transform back and
  // throw away the conversion from formula strings to `{expr}`.
  return { ...over, id: over.id ?? uid('n'), type: 'rect', transform: withTransform(over.transform) } as Node
}

function ellipse(over: Over<EllipseNode>): Node {
  return { ...over, id: over.id ?? uid('n'), type: 'ellipse', transform: withTransform(over.transform) } as Node
}

function line(over: Over<LineNode>): Node {
  return { ...over, id: over.id ?? uid('n'), type: 'line', transform: withTransform(over.transform) } as Node
}

function text(over: Over<TextNode>): Node {
  return { ...over, id: over.id ?? uid('n'), type: 'text', transform: withTransform(over.transform), text: over.text ?? '' } as Node
}

function group(children: Node[], over: Over<GroupNode>): Node {
  return {
    ...over,
    id: over.id ?? uid('n'),
    type: 'group',
    children,
    transform: withTransform(over.transform),
  } as Node
}

function axes(over: Over<AxesNode>): Node {
  return {
    ...over,
    id: over.id ?? uid('n'),
    type: 'axes',
    children: [],
    transform: withTransform(over.transform),
  } as Node
}

/** A filled arrow whose length is a plain number, scaled by `lengthScale`. */
function arrow(over: {
  id?: string
  color?: string
  width?: number
  lengthScale?: number
  rotationExpr?: string
}): Node {
  const colour = over.color ?? '#111827'
  return group(
    [
      line({
        transform: {x: 0, y: 0, rotation: over.rotationExpr ?? 0 },
        length: { expr: `lengthScale * ${over.lengthScale ?? 1}` },
        style: { stroke: colour, strokeWidth: over.width ?? 3 },
        arrowHead: { end: true, size: 9 },
      }),
      line({
        transform: {x: 0, y: 0, rotation: 'atan2(2, 1)' },
        length: 4,
        style: { stroke: colour, strokeWidth: over.width ?? 2 },
      }),
    ],
    { id: over.id, style: { fill: colour } },
  )
}

/**
 * Inputs a template needs from its context. Declaring them is what makes the
 * template's formulas legal: an undeclared name is a compile warning, not a
 * silent zero.
 */
function inputParam(label: string): Param {
  return { value: 0, label }
}

/** The scale knob every arrow template shares. */
function scaleParam(): Param {
  return { value: 1, min: 0.1, max: 4, step: 0.1, slider: true, label: 'ضریب طول' }
}

/* ------------------------------------------------------------------ *
 *  Kinematics
 * ------------------------------------------------------------------ */

/**
 * Velocity is `d()` of position. The template does not know that; it just
 * draws a line whose length is whatever expression the node supplies.
 */
export const velocityArrow: Template = {
  id: 'velocityArrow',
  name: 'پیکان سرعت',
  description: 'خطی از جسم در راستای سرعت، با طول متناسب با d(مختصات)',
  params: {
    lengthScale: scaleParam(),
    vx: inputParam('سرعت افقی'),
    vy: inputParam('سرعت عمودی'),
  },
  nodes: [
    group(
      [
        line({
          transform: {x: 0, y: 0, rotation: 'deg(atan2(vy, vx))' },
          length: { expr: 'lengthScale * hypot(vx, vy)' },
          style: { stroke: '#0ea5e9', strokeWidth: 3 },
          arrowHead: { end: true, size: 9 },
        }),
        text({
          transform: {x: 'lengthScale * hypot(vx, vy) + 8', y: -6 },
          text: 'v',
          fontSize: 13,
        }),
      ],
      { id: 'velocityArrow' },
    ),
  ],
}

export const accelerationArrow: Template = {
  id: 'accelerationArrow',
  name: 'پیکان شتاب',
  description: 'پیکان شتاب، از d(d(مختصات))',
  params: { lengthScale: scaleParam(), ax: inputParam('شتاب افقی'), ay: inputParam('شتاب عمودی') },
  nodes: [
    group(
      [
        line({
          transform: {x: 0, y: 0, rotation: 'atan2(ay, ax)' },
          length: { expr: 'lengthScale * hypot(ax, ay)' },
          style: { stroke: '#dc2626', strokeWidth: 3 },
          arrowHead: { end: true, size: 9 },
        }),
        text({
          transform: {x: 'lengthScale * hypot(ax, ay) + 8', y: -6 },
          text: 'a',
          fontSize: 13,
        }),
      ],
      { id: 'accelerationArrow' },
    ),
  ],
}

/** The arrow from the origin to the body — drawn, not stored as a flag. */
export const positionVector: Template = {
  id: 'positionVector',
  name: 'بردار موقعیت',
  description: 'خطی از مبدأ تا جسم',
  params: { px: inputParam('مختصات افقی'), py: inputParam('مختصات عمودی') },
  nodes: [
    line({
      transform: {x: 0, y: 0, rotation: 'deg(atan2(py, px))' },
      length: { expr: 'hypot(px, py)' },
      style: { stroke: '#7c3aed', strokeWidth: 2.5, dash: 8 },
      arrowHead: { end: true, size: 8 },
    }),
  ],
}

/** Tangential and normal components of one acceleration, side by side. */
export const accelDecomposition: Template = {
  id: 'accelDecomposition',
  name: 'تجزیهٔ شتاب',
  description: 'دو پیکان a_T و a_N',
  params: {
    aT_x: inputParam('a_T افقی'),
    aT_y: inputParam('a_T عمودی'),
    aN_x: inputParam('a_N افقی'),
    aN_y: inputParam('a_N عمودی'),
  },
  nodes: [
    line({
      transform: {x: 0, y: 0, rotation: 'deg(atan2(aT_y, aT_x))' },
      length: { expr: 'hypot(aT_x, aT_y)' },
      style: { stroke: '#dc2626', strokeWidth: 2.5 },
      arrowHead: { end: true, size: 8 },
    }),
    line({
      transform: {x: 'aT_x', y: 'aT_y', rotation: 'deg(atan2(aN_y, aN_x))' },
      length: { expr: 'hypot(aN_x, aN_y)' },
      style: { stroke: '#f59e0b', strokeWidth: 2.5 },
      arrowHead: { end: true, size: 8 },
    }),
  ],
}

/** The tangent at a moving playhead. Slope comes from `d()` on the plot. */
export const tangentLine: Template = {
  id: 'tangentLine',
  name: 'خط مماس',
  description: 'مماس منحنی در نقطهٔ فعلی',
  params: { m: inputParam('شیب مماس') },
  nodes: [
    line({
      transform: {x: 0, y: 0, rotation: 'deg(atan2(m, 1))' },
      length: 120,
      style: { stroke: '#16a34a', strokeWidth: 2 },
    }),
  ],
}

/** The chord between the current instant and one dt earlier. */
export const secantLine: Template = {
  id: 'secantLine',
  name: 'خط قاطع',
  description: 'خط واصلهٔ دو لحظهٔ نزدیک',
  params: { dx: inputParam('Δx'), dy: inputParam('Δy') },
  nodes: [
    line({
      transform: {x: 0, y: 0, rotation: 'deg(atan2(dy, dx))' },
      length: { expr: 'hypot(dx, dy)' },
      style: { stroke: '#e11d48', strokeWidth: 2.5 },
    }),
  ],
}

/** A shrinking window: the whole point of the secant→tangent lesson. */
export const averageWindow: Template = {
  id: 'averageWindow',
  name: 'پنجرهٔ میانگین',
  description: 'بازهٔ [t − Δt, t] که به‌تدریج کوچک می‌شود',
  params: { dt: { value: 1, min: 0.01, max: 5, step: 0.01, slider: true, label: 'Δt' } },
  nodes: [
    line({
      transform: {x: 0, y: 0 },
      length: 0,
      style: { stroke: '#111827', strokeWidth: 2 },
      visible: false,
      name: 'پنجرهٔ زمانی',
    }),
  ],
}

export const motionTrail: Template = {
  id: 'motionTrail',
  name: 'رد حرکت',
  description: 'نقطه‌های جا مانده پشت جسم',
  params: {
    vx: inputParam('سرعت افقی'),
    vy: inputParam('سرعت عمودی'),
    trailTime: { value: 0.4, min: 0.05, max: 3, step: 0.05, slider: true, label: 'طول رد (ثانیه)' },
  },
  nodes: [
    line({
      transform: { x: 0, y: 0, rotation: 'deg(atan2(vy, vx))' },
      length: { expr: 'hypot(vx, vy) * trailTime' },
      style: { stroke: '#64748b', strokeWidth: 2, dash: 6 },
    }),
  ],
}

/**
 * A number that updates itself. Nothing about it is kinematics — it just
 * reads another node and formats it.
 */
export const valueReadout: Template = {
  id: 'valueReadout',
  name: 'نمایش عدد',
  description: 'خواندن مقدار یک گره و نمایش آن کنار شکل',
  params: { value: inputParam('مقدار') },
  nodes: [
    text({
      transform: {x: 14, y: -14 },
      text: { interp: 'v = {round(value, 2)}' },
      fontSize: 14,
    }),
  ],
}

/**
 * A graph that appears after a delay and draws itself over its own duration.
 * v1 could only do this with a boolean tied to the global clock, which is why
 * "draw the graph, then draw the tangent" needed two overlapping animations.
 */
export const graphReveal: Template = {
  id: 'graphReveal',
  name: 'رسم تدریجی نمودار',
  description: 'نموداری که با تأخیر و در مدت مشخص رسم می‌شود',
  params: {
    delay: { value: 0, min: 0, max: 10, step: 0.1, label: 'تأخیر (ثانیه)' },
    drawTime: { value: 2, min: 0.1, max: 10, step: 0.1, label: 'مدت رسم (ثانیه)' },
  },
  nodes: [
    line({
      transform: {x: 0, y: 0 },
      length: 100,
      style: {
        stroke: '#111827',
        strokeWidth: 3,
        trim: { expr: 'clamp((lt - delay) / drawTime, 0, 1)' },
      },
    }),
  ],
}

/* ------------------------------------------------------------------ *
 *  Dynamics — the chapter that never had to touch the engine
 * ------------------------------------------------------------------ */

export const forceArrow: Template = {
  id: 'forceArrow',
  name: 'پیکان نیرو',
  description: 'نیرویی که از یک فرمول می‌آید',
  params: { Fx: inputParam('نیروی افقی'), Fy: inputParam('نیروی عمودی') },
  nodes: [
    line({
      transform: {x: 0, y: 0, rotation: 'atan2(Fy, Fx)' },
      length: { expr: 'hypot(Fx, Fy)' },
      style: { stroke: '#b91c1c', strokeWidth: 3 },
      arrowHead: { end: true, size: 9 },
    }),
  ],
}

/** An inclined plane with a block on it, drawn in generic shapes. */
export const inclinePlane: Template = {
  id: 'inclinePlane',
  name: 'سطح شیب‌دار',
  description: 'صفحهٔ شیب‌دار و جسمی روی آن',
  nodes: [
    line({ transform: {x: -80, y: 40 }, length: 180, style: { stroke: '#334155', strokeWidth: 4 } }),
    rect({
      transform: {x: 0, y: 10 },
      w: 26,
      h: 26,
      style: { fill: '#f59e0b', stroke: '#b45309', strokeWidth: 2 },
    }),
  ],
}

/**
 * A free-body diagram. Every arrow is an expression, so this template is
 * reusable for any force law — nothing here knows what gravity is.
 */
export const freeBodyDiagram: Template = {
  id: 'freeBodyDiagram',
  name: 'نمودار نیروهای آزاد',
  description: 'جسم و پیکان نیروهای وارد بر آن؛ زاویه با لغزنده کنترل می‌شود',
  params: {
    theta: { value: 30, min: -90, max: 90, step: 1, slider: true, label: 'زاویهٔ سطح (درجه)' },
    mass: { value: 2, min: 0.1, max: 20, step: 0.1, slider: true, label: 'جرم (kg)' },
    g: { value: 9.8, min: 0, max: 25, step: 0.1, slider: true, label: 'g (m/s²)' },
    friction: { value: 0, min: -10, max: 10, step: 0.5, slider: true, label: 'نیروی اصطکاک' },
  },
  nodes: [
    rect({
      transform: {x: 0, y: 0 },
      w: 30,
      h: 30,
      style: { fill: '#e2e8f0', stroke: '#0f172a', strokeWidth: 2 },
    }),
    // weight, always straight down
    line({
      transform: { x: 0, y: 0, rotation: -90 },
      length: { expr: 'mass * g * 0.06' },
      style: { stroke: '#b91c1c', strokeWidth: 3 },
      arrowHead: { end: true, size: 9 },
      name: 'وزن',
    }),
    // normal, perpendicular to the plane: a rotation of 90° is straight up
    line({
      transform: { x: 0, y: 0, rotation: 'theta + 90' },
      length: { expr: 'mass * g * cos(deg(theta)) * 0.06' },
      style: { stroke: '#15803d', strokeWidth: 3 },
      arrowHead: { end: true, size: 9 },
      name: 'نرمال',
    }),
    // friction, along the plane
    line({
      transform: { x: 0, y: 0, rotation: 'theta + if(friction < 0, 180, 0)' },
      length: { expr: 'abs(friction) * 0.06' },
      style: { stroke: '#7c3aed', strokeWidth: 3 },
      arrowHead: { end: true, size: 9 },
      name: 'اصطکاک',
    }),
  ],
}

/** A mass on a spring. Also generic: a rectangle and a line. */
export const springOrBlock: Template = {
  id: 'springOrBlock',
  name: 'فنر و جسم',
  description: 'جسم متصل به فنر، با جابه‌جایی x',
  params: { x: { value: 0, min: -50, max: 50, step: 0.5, slider: true, label: 'جابه‌جایی' } },
  nodes: [
    line({ transform: {x: -60, y: 0 }, length: 40, style: { stroke: '#334155', strokeWidth: 4 } }),
    line({ transform: {x: -20, y: 0 }, length: { expr: 'abs(x)' }, style: { stroke: '#64748b', strokeWidth: 2 } }),
    rect({
      transform: { x: '20 + x', y: 0 },
      w: 26,
      h: 26,
      style: { fill: '#38bdf8', stroke: '#0369a1', strokeWidth: 2 },
    }),
  ],
}

/* ------------------------------------------------------------------ *
 *  Registry
 * ------------------------------------------------------------------ */

export const BUILTIN_TEMPLATES: Template[] = [
  velocityArrow,
  accelerationArrow,
  positionVector,
  accelDecomposition,
  tangentLine,
  secantLine,
  averageWindow,
  motionTrail,
  valueReadout,
  graphReveal,
  forceArrow,
  inclinePlane,
  freeBodyDiagram,
  springOrBlock,
]

export function templateLibrary(): Record<string, Template> {
  const out: Record<string, Template> = {}
  for (const t of BUILTIN_TEMPLATES) out[t.id] = t
  return out
}

/** A minimal complete animation, used as the starting point in the studio. */
export function blankScene(title = ''): Animation2 {
  return {
    ...emptyAnimation2(title),
    templates: templateLibrary(),
  }
}

/** Helper for tests and the AI import path: a circle drawn as a path. */
export function circlePoints(radius: number, segments = 24, cx = 0, cy = 0): Point2[] {
  const out: Point2[] = []
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2
    out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)])
  }
  return out
}

export { ellipse, rect, line, text, group, axes, arrow }