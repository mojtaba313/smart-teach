/* ------------------------------------------------------------------ *
 *  Domain model — Smart Teach Studio
 *  Pure data types + a little metadata. No React, no DOM.
 * ------------------------------------------------------------------ */

/** How much horizontal room a block occupies inside its slide grid. */
export type BlockSpan = 'full' | 'half' | 'third'

export const SPAN_ORDER: BlockSpan[] = ['full', 'half', 'third']

export const SPAN_LABEL: Record<BlockSpan, string> = {
  full: 'تمام‌عرض',
  half: 'نصف‌عرض',
  third: 'یک‌سوم',
}

/* ------------------------------------------------------------------ *
 *  Animation
 * ------------------------------------------------------------------ */

export type Interp = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'step'

export const INTERP_LABEL: Record<Interp, string> = {
  linear: 'خطی',
  ease: 'نرم',
  easeIn: 'تدریجی',
  easeOut: 'توقفی',
  step: 'پله‌ای',
}

/** Which scalar property of a layer a keyframe list drives. */
export type AnimProp = 'x' | 'y' | 'size' | 'rotation' | 'opacity'

export const ANIM_PROPS: AnimProp[] = ['x', 'y', 'size', 'rotation', 'opacity']

export const ANIM_PROP_LABEL: Record<AnimProp, string> = {
  x: 'افقی x',
  y: 'عمودی y',
  size: 'اندازه',
  rotation: 'چرخش',
  opacity: 'شفافیت',
}

export type AnimKey = {
  id: string
  /** seconds */
  t: number
  v: number
  /** easing of the segment that *starts* at this keyframe */
  interp: Interp
}

export type AnimShape = 'circle' | 'square' | 'triangle' | 'arrow' | 'car' | 'ball'

export const ANIM_SHAPES: AnimShape[] = ['circle', 'square', 'triangle', 'arrow', 'car', 'ball']

export const ANIM_SHAPE_LABEL: Record<AnimShape, string> = {
  circle: 'دایره',
  square: 'مربع',
  triangle: 'مثلث',
  arrow: 'پیکان',
  car: 'خودرو',
  ball: 'توپ',
}

/**
 * A moving object. Position is either hand-keyframed, driven by an
 * expression of `t` (what physics lessons actually need), or slaved to a
 * curve so the object rides along the graph being drawn.
 */
export type AnimLayer = {
  id: string
  name: string
  shape: AnimShape
  color: string
  visible: boolean
  mode: 'key' | 'expr' | 'follow'
  /** expression of t used when mode === 'expr' */
  exprX: string
  exprY: string
  /** series id used when mode === 'follow' */
  follow?: string
  /** panel id, or '*' to draw the object in every panel */
  panel?: string
  /** keyframes used when mode === 'key' */
  tracks: Partial<Record<AnimProp, AnimKey[]>>
  showTrail: boolean
  showVelocity: boolean
  showAcceleration: boolean
  /** view-box pixels per (unit / second) — keeps arrows a readable length */
  vectorScale: number
  label?: string
  /**
   * Position vector: an arrow from a fixed point to the object. `from` is the
   * anchor in scene units (`origin` means (0, 0)); the arrow is drawn without
   * hand-rotating anything, so it cannot end up mirrored below the axis.
   */
  positionVector?: PositionVector
  /**
   * Velocity/acceleration arrows, drawn from the object's edge outward so the
   * object never hides them.
   */
  vectors?: {
    velocity?: boolean
    acceleration?: boolean
    /** px per (unit / second); falls back to `vectorScale` */
    scale?: number
    /** draw the acceleration split into tangential + normal parts */
    decomposition?: boolean
  }
}

/** An arrow anchored to a fixed point and pointing at a moving object. */
export type PositionVector = {
  /** anchor in scene units; `origin` is (0, 0) */
  from: 'origin' | { x: number; y: number }
  color?: string
  label?: string
  /** px per scene unit; falls back to a sensible auto length */
  scale?: number
  /** dashed line, used for reference vectors rather than measurements */
  dashed?: boolean
  /** only draw while the object is inside this panel (default true) */
  visible?: boolean
}

export type SeriesStyle = 'line' | 'dashed' | 'dots' | 'fill'

export const SERIES_STYLE_LABEL: Record<SeriesStyle, string> = {
  line: 'خط ممتد',
  dashed: 'خط‌چین',
  dots: 'نقطه‌ای',
  fill: 'ناحیه',
}

/** A curve plotted against time — e.g. x(t), v(t), a(t). */
export type AnimSeries = {
  id: string
  label: string
  /** expression in `t`, e.g. `4*t + 0.5*2*t*t` */
  expr: string
  color: string
  style: SeriesStyle
  visible: boolean
  /** animate the curve being drawn from t=0 to the current time */
  reveal: boolean
  /**
   * Draw the tangent at the playhead. On an x–t graph its slope *is* the
   * instantaneous velocity — the single most important idea these lectures
   * are built around, so it deserves to be drawn rather than described.
   */
  tangent?: boolean
  /** Draw the chord from t=0 to the playhead: its slope is the average velocity. */
  secant?: boolean
  /**
   * Width of the averaging window, in seconds. Draws the chord from
   * `t − window` to the playhead and labels its slope — the bridge from
   * average velocity to instantaneous velocity. `window → 0` collapses it
   * onto the tangent, which is the whole point of the demo.
   *
   * A string is evaluated as a formula of `t`, so the window can shrink while
   * the animation plays: `"1.2*exp(-2*t) + 0.02"`.
   */
  window?: number | string
  /** panel id; defaults to the first panel */
  panel?: string
}

/**
 * One stacked plot inside a scene.
 *
 * A kinematics lecture wants `x(t)`, `v(t)` and `a(t)` visible at the same
 * instant, sharing one clock. That is three panels of one scene, not three
 * scenes — the eye has to compare them vertically at a single time.
 */
export type AnimPanel = {
  id: string
  /** caption in the panel's top-left corner, e.g. `x (m)` */
  title?: string
  yMin: number
  yMax: number
  yLabel?: string
  yTicks?: number
}

export type AnimScene = {
  /**
   * `time` puts the clock on the horizontal axis — the natural frame for
   * x(t), v(t), a(t). `free` is a plain world for objects in motion.
   */
  plotSpace: 'time' | 'free'
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  /** height / width of the drawing box */
  aspect: number
  showAxes: boolean
  showGrid: boolean
  xLabel: string
  yLabel: string
  xTicks: number
  yTicks: number
  /**
   * Optional stacked panels. When present each one gets its own vertical
   * domain and label; `yMin`/`yMax`/`yLabel`/`yTicks` are then ignored.
   * Absent = a single panel spanning the whole box (the original behaviour).
   */
  panels?: AnimPanel[]
  /** horizontal gap between panels, in view-box units */
  panelGap?: number
}

export type Animation = {
  title: string
  duration: number
  loop: boolean
  autoplay: boolean
  speed: number
  scene: AnimScene
  layers: AnimLayer[]
  series: AnimSeries[]
  /** live x / v / a readout while playing */
  readout: boolean
}

export function newKey(t: number, v: number, interp: Interp = 'ease'): AnimKey {
  return { id: `k-${Math.round(t * 1000)}-${Math.abs(Math.round(v * 100))}`, t, v, interp }
}

export function newLayer(patch: Partial<AnimLayer> = {}): AnimLayer {
  return {
    id: uid('layer'),
    name: 'جسم',
    shape: 'ball',
    color: '#f97316',
    visible: true,
    mode: 'key',
    exprX: 't * 20',
    exprY: '0',
    tracks: {
      x: [newKey(0, 0)],
      y: [newKey(0, 0)],
      size: [newKey(0, 6)],
    },
    showTrail: true,
    showVelocity: false,
    showAcceleration: false,
    vectorScale: 12,
    ...patch,
  }
}

export function newSeries(patch: Partial<AnimSeries> = {}): AnimSeries {
  return {
    id: uid('s'),
    label: 'y(t)',
    expr: 't',
    color: '#2563eb',
    style: 'line',
    visible: true,
    reveal: true,
    ...patch,
  }
}

export function emptyAnimation(): Animation {
  return {
    title: 'حرکت‌شناسی',
    duration: 6,
    loop: true,
    autoplay: true,
    speed: 1,
    scene: {
      plotSpace: 'time',
      xMin: 0,
      xMax: 6,
      yMin: 0,
      yMax: 30,
      aspect: 0.62,
      showAxes: true,
      showGrid: true,
      xLabel: 't (s)',
      yLabel: 'x (m)',
      xTicks: 6,
      yTicks: 6,
    },
    layers: [newLayer()],
    series: [],
    readout: true,
  }
}

/* ------------------------------------------------------------------ *
 *  Steps / blocks
 * ------------------------------------------------------------------ */

export type StepBase = {
  id: string
  span: BlockSpan
}

export type TextStep = StepBase & { kind: 'text'; value: string }
export type FormulaStep = StepBase & { kind: 'formula'; value: string }
export type ImageStep = StepBase & {
  kind: 'image'
  value: string
  alt?: string
  caption?: string
}
export type TrapStep = StepBase & { kind: 'trap'; value: string }
export type CalloutTone = 'info' | 'tip' | 'warn' | 'idea'

export const CALLOUT_TONE_LABEL: Record<CalloutTone, string> = {
  info: 'نکته',
  tip: 'ترفند',
  warn: 'هشدار',
  idea: 'ایده',
}

export type CalloutStep = StepBase & { kind: 'callout'; value: string; tone: CalloutTone }
export type ListStep = StepBase & { kind: 'list'; items: string[]; ordered?: boolean }
export type QuizStep = StepBase & {
  kind: 'quiz'
  question: string
  options: string[]
  answerIndex: number
  explanation?: string
  /** when set, the block mirrors a Question Bank entry */
  bankId?: string
}
export type VideoStep = StepBase & { kind: 'video'; value: string; caption?: string }
export type CodeStep = StepBase & { kind: 'code'; value: string; caption?: string }
export type AnimationStep = StepBase & { kind: 'animation'; anim: Animation }

export type SlideStep =
  | TextStep
  | FormulaStep
  | ImageStep
  | TrapStep
  | CalloutStep
  | ListStep
  | QuizStep
  | VideoStep
  | CodeStep
  | AnimationStep

export type StepKind = SlideStep['kind']

export const KIND_LABEL: Record<StepKind, string> = {
  text: 'متن',
  list: 'فهرست',
  formula: 'فرمول',
  callout: 'کادر',
  trap: 'تله',
  image: 'تصویر',
  video: 'ویدیو',
  code: 'کد',
  quiz: 'پرسش',
  animation: 'انیمیشن',
}

/** Accent hue per kind — drives the block chrome and the editor badge. */
export const KIND_ACCENT: Record<StepKind, string> = {
  text: '#64748b',
  list: '#f97316',
  formula: '#2563eb',
  callout: '#0891b2',
  trap: '#e11d48',
  image: '#7c3aed',
  video: '#0284c7',
  code: '#059669',
  quiz: '#c026d3',
  animation: '#ea580c',
}

export const KIND_HINT: Record<StepKind, string> = {
  text: 'متن ساده — **پررنگ**، خط جدید با Enter',
  list: 'چند نکته‌ی کوتاه',
  formula: 'فرمول LaTeX — بین $...$ هم می‌پذیرد',
  callout: 'کادر رنگی با لحن انتخابی',
  trap: 'دام رایج امتحانی',
  image: 'آدرس اینترنتی تصویر',
  video: 'لینک یوتیوب/آپارات یا فایل mp4',
  code: 'قطعه کد با دکمه‌ی کپی',
  quiz: 'پرسش چهارگزینه‌ای — از بانک سؤال هم می‌آید',
  animation: 'استودیوی انیمیشن با کی‌فریم و نمودار',
}

/** Can a block be rendered side-by-side (vs. needing the full row)? */
export const KIND_ALLOWS_NARROW: Record<StepKind, boolean> = {
  text: true,
  list: true,
  formula: true,
  callout: true,
  trap: true,
  image: true,
  video: true,
  code: true,
  quiz: true,
  animation: true,
}

/* ------------------------------------------------------------------ *
 *  Slide / Presentation
 * ------------------------------------------------------------------ */

export type Slide = {
  id: string
  title: string
  steps: SlideStep[]
  notes?: string
}

export type PresentationTheme = 'light' | 'dark' | 'paper'

export const THEME_LABEL: Record<PresentationTheme, string> = {
  light: 'روشن',
  paper: 'کاغذی',
  dark: 'تیره',
}

export type Presentation = {
  /** schema version — bump when the shape changes and add a migration */
  schema: number
  id: string
  title: string
  description?: string
  theme?: PresentationTheme
  /** `flow` honours per-block width, `stack` always uses the full row */
  layout?: 'flow' | 'stack'
  slides: Slide[]
  createdAt: number
  updatedAt: number
}

export const SCHEMA_VERSION = 2

/* ------------------------------------------------------------------ *
 *  Question Bank
 * ------------------------------------------------------------------ */

export type Difficulty = 1 | 2 | 3

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  1: 'آسان',
  2: 'متوسط',
  3: 'سخت',
}

export const TAG_SEP = ':'

/**
 * Questions are located by a hierarchical tag path, e.g.
 * `کنکور:حرکت شناسی:حرکت شتابدار:نمودار سرعت-زمان`
 */
export type BankQuestion = {
  id: string
  stem: string
  options: string[]
  answerIndex: number
  explanation?: string
  /** ordered path segments, root first */
  tags: string[]
  source?: string
  year?: number
  difficulty?: Difficulty
  starred?: boolean
  createdAt: number
  updatedAt: number
  used?: number
}

export type QuestionBank = {
  schema: number
  questions: BankQuestion[]
  updatedAt: number
}

/** `['کنکور','حرکت شناسی','حرکت شتابدار','x']` → `کنکور:حرکت شناسی:حرکت شتابدار:x` */
export function tagPath(tags: string[]): string {
  return tags.filter(Boolean).join(TAG_SEP)
}

/** `کنکور:حرکت‌شناسی:x` → `['کنکور','حرکت‌شناسی','x']` (trimmed, empties dropped) */
export function splitTags(path: string): string[] {
  return path
    .split(TAG_SEP)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}

/* ------------------------------------------------------------------ *
 *  Factories
 * ------------------------------------------------------------------ */

let uidCounter = 0

/** Short, collision-resistant id. Uses crypto when available. */
export function uid(prefix = 'id'): string {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c) return `${prefix}-${c.randomUUID().slice(0, 8)}`
  uidCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}`
}

export function emptyStep(kind: StepKind = 'text'): SlideStep {
  const base = { id: uid('step'), span: defaultSpanFor(kind) }
  switch (kind) {
    case 'list':
      return { ...base, kind, items: [''] }
    case 'quiz':
      return { ...base, kind, question: '', options: ['', ''], answerIndex: 0 }
    case 'callout':
      return { ...base, kind, value: '', tone: 'info' }
    case 'animation':
      return { ...base, kind, anim: emptyAnimation() }
    default:
      return { ...base, kind, value: '' } as SlideStep
  }
}

/**
 * Sensible opening width per kind. A new deck should already look composed:
 * prose and quizzes want the measure, short callouts want a third, and
 * formulas/figures pair up two to a row.
 */
const KIND_DEFAULT_SPAN: Record<StepKind, BlockSpan> = {
  text: 'full',
  list: 'half',
  formula: 'half',
  callout: 'third',
  trap: 'half',
  image: 'half',
  video: 'half',
  code: 'half',
  quiz: 'full',
  animation: 'full',
}

export function defaultSpanFor(kind: StepKind): BlockSpan {
  return KIND_ALLOWS_NARROW[kind] ? KIND_DEFAULT_SPAN[kind] : 'full'
}

export function emptySlide(n: number): Slide {
  return { id: uid('slide'), title: `بخش ${n}`, steps: [emptyStep('text')], notes: '' }
}

export function blankPresentation(): Presentation {
  return {
    schema: SCHEMA_VERSION,
    id: uid('pres'),
    title: 'ارائه‌ی تازه',
    description: '',
    theme: 'light',
    layout: 'flow',
    slides: [emptySlide(1)],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function emptyQuestion(patch: Partial<BankQuestion> = {}): BankQuestion {
  return {
    id: uid('q'),
    stem: '',
    options: ['', '', '', ''],
    answerIndex: 0,
    explanation: '',
    tags: [],
    source: '',
    difficulty: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    used: 0,
    ...patch,
  }
}
