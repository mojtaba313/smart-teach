import type { Animation, AnimLayer, AnimPath, AnimSeries } from '../../types'
import { newKey, newLayer, newSeries, uid } from '../../types'

const SERIES_COLORS = ['#2563eb', '#e11d48', '#059669', '#c026d3', '#d97706', '#0891b2']

function series(label: string, expr: string, i: number, style: AnimSeries['style'] = 'line'): AnimSeries {
  return newSeries({ id: uid('s'), label, expr, color: SERIES_COLORS[i % SERIES_COLORS.length], style })
}

type SceneOpts = Partial<Animation['scene']>

function scene(opts: SceneOpts = {}): Animation['scene'] {
  return {
    plotSpace: 'time',
    xMin: 0,
    xMax: 10,
    yMin: -5,
    yMax: 30,
    aspect: 0.62,
    showAxes: true,
    showGrid: true,
    xLabel: 't (s)',
    yLabel: 'y',
    xTicks: 8,
    yTicks: 6,
    ...opts,
  }
}

export type Preset = {
  id: string
  label: string
  blurb: string
  build: () => Animation
}

/* ------------------------------------------------------------------ *
 *  Graph presets — the kinematics workhorses
 * ------------------------------------------------------------------ */

const vtUniform = (): Animation => ({
  title: 'نمودار سرعت-زمان با شتاب ثابت',
  duration: 8,
  loop: true,
  autoplay: true,
  speed: 1,
  scene: scene({ yLabel: 'v (m/s)', yMin: -4, yMax: 30 }),
  layers: [],
  series: [
    series('v(t) = ۲ + ۳t', '2 + 3*t', 0),
    series('x(t) = ۲t + ۱٫۵t²', '2*t + 1.5*t^2', 1, 'dashed'),
  ],
  readout: false,
})

const xtUniform = (): Animation => ({
  title: 'نمودار مکان-زمان',
  duration: 8,
  loop: true,
  autoplay: true,
  speed: 1,
  scene: scene({ yLabel: 'x (m)', yMin: -4, yMax: 40 }),
  layers: [],
  series: [
    series('x(t) = ۴t', '4*t', 0),
    series('x(t) = ۲t + t²', '2*t + t^2', 1, 'dashed'),
  ],
  readout: false,
})

const projectile = (): Animation => ({
  title: 'پرتابه — مؤلفه‌های سرعت و ارتفاع',
  duration: 4,
  loop: true,
  autoplay: true,
  speed: 1,
  scene: scene({ yLabel: 'v (m/s)', yMin: -22, yMax: 24, yTicks: 8 }),
  layers: [],
  series: [
    series('v_y = ۲۰ − ۹٫۸t', '20 - 9.8*t', 0),
    series('v_x = ۱۵', '15', 1, 'dashed'),
    series('y = ۲۰t − ۴٫۹t²', '20*t - 4.9*t^2', 2, 'fill'),
  ],
  readout: false,
})

const shm = (): Animation => ({
  title: 'نوسان ساده هماهنگ',
  duration: 6,
  loop: true,
  autoplay: true,
  speed: 1,
  scene: scene({ yLabel: 'x (m)', yMin: -14, yMax: 14 }),
  layers: [],
  series: [
    series('x = ۱۰ sin(t)', '10*sin(t)', 0),
    series('v = ۱۰ cos(t)', '10*cos(t)', 1, 'dashed'),
  ],
  readout: false,
})

const rideTheGraph = (): Animation => {
  const curve = series('x(t) = ۲t + t²', '2*t + t^2', 0)
  const ball: AnimLayer = newLayer({
    id: uid('layer'),
    name: 'نقطهٔ روی نمودار',
    shape: 'ball',
    color: curve.color,
    mode: 'follow',
    follow: curve.id,
    showTrail: false,
    showVelocity: false,
    showAcceleration: false,
  })
  ball.tracks.size = [newKey(0, 14), newKey(8, 14)]
  ball.label = '(t, x)'
  return {
    title: 'نقطه روی نمودار مکان-زمان',
    duration: 8,
    loop: true,
    autoplay: true,
    speed: 1,
    scene: scene({ yLabel: 'x (m)', yMin: -4, yMax: 90 }),
    layers: [ball],
    series: [curve],
    readout: true,
  }
}

/* ------------------------------------------------------------------ *
 *  Scene presets — objects moving through a world
 * ------------------------------------------------------------------ */

const motionDiagram = (): Animation => {
  const car: AnimLayer = newLayer({
    id: uid('layer'),
    name: 'خودرو',
    shape: 'car',
    color: '#e11d48',
    mode: 'expr',
    exprX: '4*t',
    exprY: '0',
    showTrail: true,
    showVelocity: true,
    vectorScale: 14,
  })
  car.tracks.size = [newKey(0, 7), newKey(8, 7)]
  return {
    title: 'نمودار حرکتی — سرعت ثابت',
    duration: 8,
    loop: true,
    autoplay: true,
    speed: 1,
    scene: scene({ plotSpace: 'free', xMin: 0, xMax: 40, yMin: -6, yMax: 18, yTicks: 4, xLabel: 'x (m)', yLabel: '', xTicks: 8 }),
    layers: [car],
    series: [],
    readout: true,
  }
}

const throwBall = (): Animation => {
  const ball: AnimLayer = newLayer({
    id: uid('layer'),
    name: 'توپ',
    shape: 'ball',
    color: '#f97316',
    mode: 'expr',
    exprX: '12*t',
    exprY: '12*t - 4.9*t^2',
    showTrail: true,
    showVelocity: true,
    showAcceleration: false,
    vectorScale: 11,
  })
  ball.tracks.size = [newKey(0, 4.5), newKey(4, 4.5)]
  const ground: AnimLayer = newLayer({
    id: uid('layer'),
    name: 'زمین',
    shape: 'square',
    color: '#64748b',
    mode: 'key',
    exprX: '0',
    exprY: '0',
    showTrail: false,
    showVelocity: false,
    showAcceleration: false,
  })
  ground.tracks.x = [newKey(0, 0), newKey(4, 90)]
  ground.tracks.y = [newKey(0, -1), newKey(4, -1)]
  ground.tracks.size = [newKey(0, 54), newKey(4, 54)]
  ground.tracks.opacity = [newKey(0, 0.16), newKey(4, 0.16)]
  return {
    title: 'پرتاب توپ با فرمول جابه‌جایی',
    duration: 4,
    loop: true,
    autoplay: true,
    speed: 1,
    scene: scene({ plotSpace: 'free', xMin: -2, xMax: 52, yMin: -4, yMax: 14, xLabel: 'x (m)', yLabel: 'y (m)', xTicks: 6, yTicks: 4, aspect: 0.5 }),
    layers: [ball, ground],
    series: [],
    readout: true,
  }
}

const oscillation = (): Animation => {
  const dot: AnimLayer = newLayer({
    id: uid('layer'),
    name: 'نوسانگر',
    shape: 'circle',
    color: '#2563eb',
    mode: 'expr',
    exprX: '25 + 15*sin(t*1.5)',
    exprY: '0',
    showTrail: true,
    showVelocity: true,
    vectorScale: 9,
  })
  dot.tracks.size = [newKey(0, 4), newKey(6, 4)]
  return {
    title: 'نوسان گلوگاهی',
    duration: 6,
    loop: true,
    autoplay: true,
    speed: 1,
    scene: scene({ plotSpace: 'free', xMin: 0, xMax: 50, yMin: -10, yMax: 10, xLabel: 'x (m)', yLabel: '', xTicks: 10, yTicks: 4, aspect: 0.45 }),
    layers: [dot],
    series: [],
    readout: true,
  }
}

const keyframeDemo = (): Animation => {
  const box: AnimLayer = newLayer({
    id: uid('layer'),
    name: 'مربع نمونه',
    shape: 'square',
    color: '#c026d3',
    mode: 'key',
    showTrail: true,
  })
  box.tracks.x = [newKey(0, 10), newKey(2, 48, 'easeOut'), newKey(4, 76, 'ease')]
  box.tracks.y = [newKey(0, 10), newKey(2, 10), newKey(4, 44)]
  box.tracks.size = [newKey(0, 6), newKey(4, 14)]
  box.tracks.rotation = [newKey(0, 0), newKey(4, 180)]
  return {
    title: 'کی‌فریم دستی',
    duration: 4,
    loop: true,
    autoplay: true,
    speed: 1,
    scene: scene({ plotSpace: 'free', xMin: 0, xMax: 100, yMin: 0, yMax: 60, xLabel: 'x', yLabel: 'y', xTicks: 10, yTicks: 6 }),
    layers: [box],
    series: [],
    readout: false,
  }
}

const emptyGraph = (): Animation => ({
  title: 'نمودار تازه',
  duration: 6,
  loop: true,
  autoplay: true,
  speed: 1,
  scene: scene({ yLabel: 'y', yMin: -3, yMax: 15 }),
  layers: [],
  series: [series('y(t) = ۲t', '2*t', 0)],
  readout: false,
})

const emptyScene = (): Animation => ({
  title: 'صحنهٔ تازه',
  duration: 6,
  loop: true,
  autoplay: true,
  speed: 1,
  scene: scene({ plotSpace: 'free', showAxes: false, xMin: 0, xMax: 60, yMin: 0, yMax: 40, xLabel: 'x', yLabel: 'y', aspect: 0.6 }),
  layers: [newLayer({ exprX: '10*t', exprY: '20' })],
  series: [],
  readout: true,
})

/**
 * Non-physics motions. The formula mode is great at `t*t` and pointless for a
 * loop or a figure-eight, so these carry a drawn path instead.
 */
export const PATH_PRESETS = [
  {
    label: 'دایرهٔ کامل',
    path: { closed: true, points: Array.from({ length: 13 }, (_, i) => ({ x: Math.cos((i / 12) * 2 * Math.PI) * 5, y: Math.sin((i / 12) * 2 * Math.PI) * 5 })) },
  },
  {
    label: 'رقم ۸',
    path: {
      closed: true,
      points: Array.from({ length: 33 }, (_, i) => {
        const t = (i / 32) * 2 * Math.PI
        return { x: Math.sin(t) * 5, y: Math.sin(2 * t) * 3 }
      }),
    },
  },
  {
    label: 'چرخ‌فلک عمودی',
    path: { closed: false, points: [{ x: -6, y: 0 }, { x: 0, y: 6 }, { x: 6, y: 0 }, { x: 0, y: -6 }] },
  },
] satisfies { label: string; path: AnimPath }[]

export const PRESETS: Preset[] = [
  { id: 'vt', label: 'سرعت-زمان', blurb: 'شتاب ثابت: v و x با هم', build: vtUniform },
  { id: 'xt', label: 'مکان-زمان', blurb: 'شیب نمودار = سرعت', build: xtUniform },
  { id: 'ride', label: 'نقطه روی نمودار', blurb: 'شیء سوار بر منحنی x(t)', build: rideTheGraph },
  { id: 'projectile', label: 'پرتابه', blurb: 'مؤلفه‌های سرعت و ارتفاع', build: projectile },
  { id: 'shm', label: 'نوسان ساده', blurb: 'x و v برای SHM', build: shm },
  { id: 'motion', label: 'نمودار حرکتی', blurb: 'خودرو با بردار سرعت', build: motionDiagram },
  { id: 'throw', label: 'پرتاب توپ', blurb: 'مسیر سهمی با فرمول', build: throwBall },
  { id: 'osc', label: 'نوسان گلوگاهی', blurb: 'حرکت رفت‌وبرگشتی', build: oscillation },
  { id: 'keys', label: 'کی‌فریم دستی', blurb: 'پنج ویژگی، بدون فرمول', build: keyframeDemo },
  { id: 'graph', label: 'نمودار خالی', blurb: 'یک منحنی ساده', build: emptyGraph },
  { id: 'scene', label: 'صحنهٔ خالی', blurb: 'جهان بدون محور', build: emptyScene },
]

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}
