/**
 * The property schema that generates the inspector.
 *
 * v1's inspector was 1211 lines of hand-written forms, one block per node
 * type, and a second divergent copy of half of it in the block editor. Every
 * new node type meant writing new forms.
 *
 * Here a node type is *described*, and the inspector is generated from the
 * description. Adding a shape means adding one entry below, not a new
 * component.
 */

import type { Node, Point2 } from '../../types/anim2'

export type PropKind = 'number' | 'text' | 'color' | 'select' | 'boolean'

export type PropSpec = {
  /** Dotted path into the node, e.g. `transform.x`. */
  path: string
  label: string
  kind: PropKind
  /** Used when the node omits the value entirely. */
  fallback: number | string | boolean
  min?: number
  max?: number
  step?: number
  /**
   * Whether this property can be constant, keyed or a formula. Colours hold
   * rather than blend, and a name is neither.
   */
  animatable?: boolean
  options?: { value: string; label: string }[]
  hint?: string
  /** Group headings in the inspector. */
  group?: string
}

export const GROUPS = {
  identity: 'هویت',
  motion: 'حرکت',
  shape: 'شکل',
  look: 'ظاهر',
  time: 'زمان',
} as const

/* ------------------------------------------------------------------ *
 *  Shared blocks
 * ------------------------------------------------------------------ */

const identity = (): PropSpec[] => [
  { path: 'name', label: 'نام', kind: 'text', fallback: '', group: GROUPS.identity },
  { path: 'visible', label: 'نمایش', kind: 'boolean', fallback: true, group: GROUPS.identity },
  { path: 'locked', label: 'قفل', kind: 'boolean', fallback: false, group: GROUPS.identity },
]

const transform = (): PropSpec[] => [
  { path: 'transform.x', label: 'x', kind: 'number', fallback: 0, step: 0.5, animatable: true, group: GROUPS.motion },
  { path: 'transform.y', label: 'y', kind: 'number', fallback: 0, step: 0.5, animatable: true, group: GROUPS.motion },
  { path: 'transform.rotation', label: 'چرخش', kind: 'number', fallback: 0, step: 1, animatable: true, hint: 'درجه، پادساعت از محور x', group: GROUPS.motion },
  { path: 'transform.scaleX', label: 'پهنا', kind: 'number', fallback: 1, step: 0.05, animatable: true, group: GROUPS.motion },
  { path: 'transform.scaleY', label: 'بلندی', kind: 'number', fallback: 1, step: 0.05, animatable: true, group: GROUPS.motion },
  { path: 'transform.opacity', label: 'شفافیت', kind: 'number', fallback: 1, min: 0, max: 1, step: 0.05, animatable: true, group: GROUPS.motion },
]

const timing = (): PropSpec[] => [
  { path: 'time.start', label: 'از ثانیه', kind: 'number', fallback: 0, step: 0.1, group: GROUPS.time },
  { path: 'time.end', label: 'تا ثانیه', kind: 'number', fallback: 0, step: 0.1, group: GROUPS.time },
]

const look = (): PropSpec[] => [
  { path: 'style.fill', label: 'پرکننده', kind: 'color', fallback: 'none', group: GROUPS.look },
  { path: 'style.stroke', label: 'خط', kind: 'color', fallback: '#111827', group: GROUPS.look },
  { path: 'style.strokeWidth', label: 'ضخامت خط', kind: 'number', fallback: 2, min: 0, step: 0.5, animatable: true, group: GROUPS.look },
  { path: 'style.dash', label: 'خط‌چین', kind: 'number', fallback: 0, min: 0, step: 1, animatable: true, group: GROUPS.look },
  { path: 'style.trim', label: 'رسم تدریجی', kind: 'number', fallback: 1, min: 0, max: 1, step: 0.05, animatable: true, hint: '۰ تا ۱؛ جایگزین reveal', group: GROUPS.look },
]

/* ------------------------------------------------------------------ *
 *  Per type
 * ------------------------------------------------------------------ */

const byType: Record<Node['type'], PropSpec[]> = {
  rect: [
    { path: 'w', label: 'پهنا', kind: 'number', fallback: 10, step: 1, animatable: true, group: GROUPS.shape },
    { path: 'h', label: 'بلندی', kind: 'number', fallback: 10, step: 1, animatable: true, group: GROUPS.shape },
    { path: 'rx', label: 'گردی گوشه', kind: 'number', fallback: 0, min: 0, step: 1, animatable: true, group: GROUPS.shape },
  ],
  ellipse: [
    { path: 'rx', label: 'شعاع افقی', kind: 'number', fallback: 5, min: 0, step: 0.5, animatable: true, group: GROUPS.shape },
    { path: 'ry', label: 'شعاع عمودی', kind: 'number', fallback: 5, min: 0, step: 0.5, animatable: true, group: GROUPS.shape },
  ],
  line: [
    { path: 'length', label: 'طول', kind: 'number', fallback: 10, step: 1, animatable: true, group: GROUPS.shape },
    { path: 'arrowHead.start', label: 'پیکان ابتدا', kind: 'boolean', fallback: false, group: GROUPS.shape },
    { path: 'arrowHead.end', label: 'پیکان انتها', kind: 'boolean', fallback: true, group: GROUPS.shape },
    { path: 'arrowHead.size', label: 'اندازهٔ پیکان', kind: 'number', fallback: 8, min: 0, step: 1, animatable: true, group: GROUPS.shape },
  ],
  path: [
    { path: 'closed', label: 'بسته', kind: 'boolean', fallback: false, group: GROUPS.shape },
    { path: 'parametric.xExpr', label: 'x(u)', kind: 'text', fallback: 'u', group: GROUPS.shape },
    { path: 'parametric.yExpr', label: 'y(u)', kind: 'text', fallback: '0', group: GROUPS.shape },
  ],
  text: [
    { path: 'text', label: 'متن', kind: 'text', fallback: '', group: GROUPS.shape },
    { path: 'fontSize', label: 'اندازهٔ قلم', kind: 'number', fallback: 14, min: 1, step: 1, animatable: true, group: GROUPS.shape },
    { path: 'latex', label: 'فرمول ریاضی', kind: 'boolean', fallback: false, group: GROUPS.shape },
    {
      path: 'anchor',
      label: 'تراز',
      kind: 'select',
      fallback: 'start',
      options: [
        { value: 'start', label: 'شروع' },
        { value: 'middle', label: 'وسط' },
        { value: 'end', label: 'پایان' },
      ],
      group: GROUPS.shape,
    },
  ],
  image: [
    { path: 'href', label: 'نشانی', kind: 'text', fallback: '', group: GROUPS.shape },
    { path: 'w', label: 'پهنا', kind: 'number', fallback: 10, step: 1, animatable: true, group: GROUPS.shape },
    { path: 'h', label: 'بلندی', kind: 'number', fallback: 10, step: 1, animatable: true, group: GROUPS.shape },
  ],
  plot: [
    { path: 'expr', label: 'y برحسب x', kind: 'text', fallback: '0', hint: 'x متغیر محور است', group: GROUPS.shape },
    { path: 'parametric.xExpr', label: 'x برحسب u', kind: 'text', fallback: 'u', group: GROUPS.shape },
    { path: 'parametric.yExpr', label: 'y برحسب u', kind: 'text', fallback: '0', group: GROUPS.shape },
    { path: 'domain.0', label: 'از x', kind: 'number', fallback: 0, step: 0.5, group: GROUPS.shape },
    { path: 'domain.1', label: 'تا x', kind: 'number', fallback: 1, step: 0.5, group: GROUPS.shape },
    { path: 'samples', label: 'نمونه', kind: 'number', fallback: 160, min: 2, max: 2000, step: 10, group: GROUPS.shape },
    {
      path: 'draw',
      label: 'شیوهٔ رسم',
      kind: 'select',
      fallback: 'line',
      options: [
        { value: 'line', label: 'خط' },
        { value: 'dashed', label: 'خط‌چین' },
        { value: 'dots', label: 'نقطه' },
        { value: 'fill', label: 'پرکننده' },
      ],
      group: GROUPS.shape,
    },
  ],
  group: [],
  axes: [
    { path: 'axes.xDomain.0', label: 'x از', kind: 'number', fallback: 0, step: 0.5, group: GROUPS.shape },
    { path: 'axes.xDomain.1', label: 'x تا', kind: 'number', fallback: 1, step: 0.5, group: GROUPS.shape },
    { path: 'axes.yDomain.0', label: 'y از', kind: 'number', fallback: 0, step: 0.5, group: GROUPS.shape },
    { path: 'axes.yDomain.1', label: 'y تا', kind: 'number', fallback: 1, step: 0.5, group: GROUPS.shape },
    { path: 'axes.labels.x', label: 'برچسب x', kind: 'text', fallback: '', group: GROUPS.shape },
    { path: 'axes.labels.y', label: 'برچسب y', kind: 'text', fallback: '', group: GROUPS.shape },
    { path: 'axes.ticks.x', label: 'تیک x', kind: 'number', fallback: 5, min: 0, max: 40, step: 1, group: GROUPS.shape },
    { path: 'axes.ticks.y', label: 'تیک y', kind: 'number', fallback: 5, min: 0, max: 40, step: 1, group: GROUPS.shape },
    { path: 'axes.grid', label: 'شبکه', kind: 'boolean', fallback: true, group: GROUPS.shape },
  ],
  shape: [
    { path: 'shape', label: 'شکل', kind: 'text', fallback: '', hint: 'نام یک شکل از جدول شکل‌ها', group: GROUPS.shape },
  ],
  use: [
    { path: 'template', label: 'قالب', kind: 'text', fallback: '', hint: 'نام یک قالب از کتابخانه', group: GROUPS.shape },
  ],
}

export const NODE_TYPES: { type: Node['type']; label: string }[] = [
  { type: 'rect', label: 'مستطیل' },
  { type: 'ellipse', label: 'دایره' },
  { type: 'line', label: 'خط' },
  { type: 'path', label: 'مسیر' },
  { type: 'shape', label: 'شکل' },
  { type: 'text', label: 'متن' },
  { type: 'image', label: 'تصویر' },
  { type: 'plot', label: 'نمودار' },
  { type: 'axes', label: 'محور' },
  { type: 'group', label: 'گروه' },
  { type: 'use', label: 'قالب' },
]

/** Every property of a node type, in inspector order. */
export function propsFor(type: Node['type']): PropSpec[] {
  return [...identity(), ...transform(), ...(byType[type] ?? []), ...look(), ...timing()]
}

/** Properties grouped by their heading, in a stable order. */
export function groupedProps(type: Node['type']): { group: string; props: PropSpec[] }[] {
  const out: { group: string; props: PropSpec[] }[] = []
  for (const spec of propsFor(type)) {
    const group = spec.group ?? GROUPS.identity
    const last = out[out.length - 1]
    if (last && last.group === group) last.props.push(spec)
    else out.push({ group, props: [spec] })
  }
  return out
}

/* ------------------------------------------------------------------ *
 *  Reading and writing by path
 * ------------------------------------------------------------------ */

export function readPath(node: unknown, path: string): unknown {
  let current: unknown = node
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/** Immutably set a dotted path, creating intermediate objects. */
export function writePath<T>(target: T, path: string, value: unknown): T {
  const parts = path.split('.')
  const clone = { ...(target as Record<string, unknown>) }
  let cursor = clone
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]
    const next = cursor[part]
    cursor[part] = next && typeof next === 'object' && !Array.isArray(next) ? { ...(next as object) } : {}
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]] = value
  return clone as T
}

/**
 * Current value of a spec on a node. A property in `expr` or `keys` mode is
 * returned as the prop object itself, because the inspector needs to show
 * which mode it is in — not just a number.
 */
export function valueOf(node: Node, spec: PropSpec): unknown {
  const raw = readPath(node, spec.path)
  if (raw === undefined || raw === null) return spec.fallback
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'object') return raw
  if (typeof raw === 'number' && !Number.isFinite(raw)) return spec.fallback
  return raw
}

/* ------------------------------------------------------------------ *
 *  Which properties are animated
 * ------------------------------------------------------------------ */

export type PropMode = 'const' | 'expr' | 'keys'

export function modeOf(value: unknown): PropMode {
  if (value && typeof value === 'object' && 'expr' in (value as object)) return 'expr'
  if (value && typeof value === 'object' && 'keys' in (value as object)) return 'keys'
  return 'const'
}

/**
 * The properties that actually change over time, in the order the timeline
 * shows them. A node with no animated property gets one summary row rather
 * than six empty ones.
 */
export function animatedPaths(node: Node, type = node.type): string[] {
  return propsFor(type)
    .filter((spec) => {
      if (!spec.animatable) return false
      const value = readPath(node, spec.path)
      if (value && typeof value === 'object') return modeOf(value) !== 'const'
      // An expression in the node's own text or plot also counts.
      return false
    })
    .map((spec) => spec.path)
}

/** Path → the label the timeline row shows. */
export function labelFor(path: string, node: Node): string {
  const spec = propsFor(node.type).find((p) => p.path === path)
  return spec?.label ?? path
}

/** A fresh node of a type, with the schema's own defaults filled in. */
export function newNodeOfType(type: Node['type'], id: string): Node {
  const base: Record<string, unknown> = {
    id,
    type,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  }
  for (const spec of propsFor(type)) {
    if (spec.group === GROUPS.look || spec.group === GROUPS.time) continue
    if (spec.path === 'name' || spec.path === 'visible' || spec.path === 'locked') continue
    // Only set defaults the type genuinely needs (a line needs a length; a
    // plot needs a domain). Everything else stays absent and uses `fallback`.
    if (spec.path === 'length' || spec.path === 'w' || spec.path === 'h') base[spec.path] = spec.fallback
  }
  if (type === 'plot') base['domain'] = [0, 1]
  return base as Node
}

/** Points of a path node, whichever way it was authored. */
export function pathPoints(node: Node): Point2[] {
  return (node as { points?: Point2[] }).points ?? []
}