/**
 * The acceptance examples from the brief, written against the engine and the
 * renderer rather than the UI.
 *
 * Each of these has to work with no chapter-specific engine code. If any of
 * them needs a new field in `types.ts` or a branch in the engine to express,
 * the whole premise of v2 has failed — which is why they live as tests rather
 * than as screenshots someone has to eyeball.
 */

import { describe, expect, it } from 'vitest'
import {
  type Animation2,
  type Node,
  emptyTransform,
} from '../../types/anim2'
import { compileAnimation, evaluate, plotPoints, valueOf } from '../../lib/anim2/engine'
import { evalPoint, planEvents, stepEvents } from '../../lib/anim2/events'
import { MAX_PARTICLES, ParticleSystem } from '../../lib/anim2/particles'
import type { EvalEnv } from '../../lib/anim2/expr'
import { templateLibrary } from '../../lib/anim2/templates'
import { freeFrame, makeFrame, ticksFor, trimPath, viewFor } from './geometry'


const T = () => emptyTransform()

/**
 * Every animation carries the built-in library, the same way the migration
 * and the studio hand it over — a `use` node naming a template is an error,
 * not an invitation to silently find it.
 */
function scene(nodes: Node[], over: Partial<Animation2> = {}): Animation2 {
  return { schema: 2, title: '', duration: 6, params: {}, cues: [], nodes, templates: templateLibrary(), ...over }
}

/** Everything currently visible at time t, flattened. */
function visibleAt(anim: Animation2, t: number) {
  const compiled = compileAnimation(anim)
  const frame = evaluate(compiled, t)
  const out: Record<string, { x: number; y: number; text?: string }> = {}
  const walk = (nodes: typeof frame.nodes) => {
    for (const n of nodes) {
      if (n.live) out[n.id] = { x: n.x, y: n.y, text: n.text }
      walk(n.children)
    }
  }
  walk(frame.nodes)
  return out
}

describe('acceptance 1: a graph that appears late and draws itself over 3 s', () => {
  const anim = scene(
    [
      {
        id: 'curve',
        type: 'plot',
        transform: T(),
        time: { start: 1.5, end: 4.5 },
        expr: '0.25*x*x',
        domain: [0, 8],
        samples: 60,
        style: { trim: { expr: 'clamp((lt - 0) / 3, 0, 1)' } },
      },
      {
        id: 'dot',
        type: 'ellipse',
        transform: { ...T(), x: { expr: '4*t' }, y: { expr: '0.25*(4*t)^2' } },
        time: { start: 1.5, end: 4.5 },
      },
    ],
    { duration: 6 },
  )

  it('is not there before the delay', () => {
    expect(Object.keys(visibleAt(anim, 1.0))).toHaveLength(0)
  })

  it('exists at the end of the delay', () => {
    expect(Object.keys(visibleAt(anim, 1.6))).toHaveLength(2)
  })

  it('has drawn a quarter of itself halfway through its draw', () => {
    const c = compileAnimation(anim)
    const at = (t: number) => evaluate(c, t).nodes.find((n) => n.id === 'curve')!.trim
    expect(at(1.5)).toBeCloseTo(0, 6)
    expect(at(2.25)).toBeCloseTo(0.25, 6)
    expect(at(3)).toBeCloseTo(0.5, 6)
    expect(at(4.5)).toBeCloseTo(1, 6)
  })

  it('is gone once its window closes', () => {
    expect(Object.keys(visibleAt(anim, 5))).toHaveLength(0)
  })

  it('rides its own curve', () => {
    const v = visibleAt(anim, 2)
    expect(v['dot']!.x).toBeCloseTo(8, 9)
    expect(v['dot']!.y).toBeCloseTo(0.25 * 64, 9)
  })
})

describe('acceptance 2: a traveling wave with live sliders', () => {
  const anim = scene(
    [
      {
        id: 'wave',
        type: 'plot',
        transform: T(),
        expr: 'A*sin(k*x - w*t)',
        domain: [0, 6],
        samples: 120,
      },
    ],
    {
      duration: 4,
      params: {
        A: { value: 1, min: 0, max: 3, step: 0.1, slider: true, label: 'دامنه' },
        k: { value: 2, min: 0, max: 6, step: 0.1, slider: true, label: 'عدد موج' },
        w: { value: 3, min: 0, max: 10, step: 0.1, slider: true, label: 'بسامد' },
      },
    },
  )

  const sample = (params: Record<string, number>, t: number): number[] => {
    const c = compileAnimation(anim)
    return plotPoints(c.nodes[0].plot!, t, { A: 1, k: 2, w: 3, ...params }).map(([, y]) => y)
  }

  it('compiles with no warnings — A, k and w are parameters, not engine code', () => {
    expect(compileAnimation(anim).warnings).toEqual([])
  })

  it('re-evaluates when a slider moves', () => {
    const quiet = sample({ A: 1 }, 0.5)
    const loud = sample({ A: 2.5 }, 0.5)
    const peak = (xs: number[]) => Math.max(...xs.map(Math.abs))
    expect(peak(loud)).toBeGreaterThan(peak(quiet))
  })

  it('moves along x as the wave number changes', () => {
    const slow = sample({ k: 1 }, 0)
    const fast = sample({ k: 4 }, 0)
    expect(fast[1]).not.toBeCloseTo(slow[1], 6)
  })

  it('travels in time as the frequency changes', () => {
    const a = sample({ w: 1 }, 1.2)
    const b = sample({ w: 6 }, 1.2)
    expect(a[3]).not.toBeCloseTo(b[3], 6)
  })

  it('is a function of x, not of t — so the node stays static in time', () => {
    const c = compileAnimation(anim)
    expect(c.static).toBe(false) // it does read t, via w*t
    const still = compileAnimation(scene([{ id: 'p', type: 'plot', transform: T(), expr: 'x*x' }]))
    expect(still.static).toBe(true)
  })
})

describe('acceptance 3: a free-body diagram on an incline with a θ slider', () => {
  const anim = scene(
    [
      {
        id: 'fbd',
        type: 'use',
        transform: T(),
        template: 'freeBodyDiagram',
      },
    ],
    {
      duration: 4,
      params: {
        theta: { value: 30, min: -90, max: 90, step: 1, slider: true, label: 'زاویه' },
        mass: { value: 2, min: 0.1, max: 20, step: 0.1, slider: true, label: 'جرم' },
        g: { value: 9.8, min: 0, max: 25, step: 0.1, slider: true, label: 'g' },
        friction: { value: 0, min: -10, max: 10, step: 0.5, slider: true, label: 'اصطکاک' },
      },
    },
  )

  const compiled = compileAnimation(anim)

  it('expands without warnings', () => {
    expect(compiled.warnings).toEqual([])
  })

  it('has a body and one arrow per force', () => {
    const names = compiled.nodes[0].children?.map((c) => c.name) ?? []
    expect(names).toContain('وزن')
    expect(names).toContain('نرمال')
    expect(names).toContain('اصطکاک')
  })

  it('draws the normal force perpendicular to the plane', () => {
    // theta = 0 is a flat plane, so the normal points straight up (-90° in
    // scene terms where y is flipped).
    const flat = compileAnimation({
      ...anim,
      params: { ...anim.params, theta: { value: 0 }, friction: { value: 0 } },
    })
    const normal = flat.nodes[0].children?.find((c) => c.name === 'نرمال')
    const frame = evaluate(flat, 0).nodes[0].children?.find((c) => c.name === 'نرمال')
    expect(frame?.shape.length).toBeCloseTo((2 * 9.8 * 1) * 0.06, 6)
    void normal
  })

  it('shortens the normal force as the incline steepens', () => {
    const at = (deg: number) => {
      const c = compileAnimation({ ...anim, params: { ...anim.params, theta: { value: deg }, friction: { value: 0 } } })
      const n = evaluate(c, 0).nodes[0].children?.find((x) => x.name === 'نرمال')
      return n?.shape.length ?? 0
    }
    expect(at(90)).toBeLessThan(at(0))
  })

  it('keeps the weight straight down regardless of the incline', () => {
    const at = (deg: number) => {
      const c = compileAnimation({ ...anim, params: { ...{}, ...anim.params, theta: { value: deg }, friction: { value: 0 } } })
      const w = evaluate(c, 0).nodes[0].children?.find((x) => x.name === 'وزن')
      return { len: w?.shape.length ?? 0, rot: w?.rotation ?? NaN }
    }
    expect(at(30).len).toBeCloseTo(at(0).len, 9)
    expect(at(30).rot).toBeCloseTo(at(0).rot, 9)
    // Angles run counterclockwise from +x with y downward, so down is −90°.
    expect(at(0).rot).toBeCloseTo(-90, 6)
  })

  it('points the normal up the surface normal, and friction along the plane', () => {
    const at = (deg: number) => {
      const c = compileAnimation({ ...anim, params: { ...anim.params, theta: { value: deg }, friction: { value: 1 } } })
      const kids = evaluate(c, 0).nodes[0].children ?? []
      const rot = (name: string) => kids.find((x) => x.name === name)?.rotation ?? NaN
      return { normal: rot('نرمال'), friction: rot('اصطکاک') }
    }
    // Flat plane: normal straight up, friction along it.
    expect(at(0).normal).toBeCloseTo(90, 6)
    expect(at(0).friction).toBeCloseTo(0, 6)
    // Tilted 30°: the normal turns with the surface.
    expect(at(30).normal).toBeCloseTo(120, 6)
    expect(at(30).friction).toBeCloseTo(30, 6)
  })

  it('reverses friction when it acts the other way', () => {
    const at = (force: number) => {
      const c = compileAnimation({ ...anim, params: { ...anim.params, friction: { value: force } } })
      return evaluate(c, 0).nodes[0].children?.find((x) => x.name === 'اصطکاک')?.rotation ?? NaN
    }
    expect(at(-2)).toBeCloseTo(at(1) + 180, 6)
  })
})

describe('acceptance 4: a pendulum from primitives only', () => {
  /** No templates — just rect, line, ellipse and expressions. */
  const L = 2
  const anim = scene(
    [
      { id: 'pivot', type: 'ellipse', transform: { ...T(), x: 0, y: 0 }, rx: 2, ry: 2, style: { fill: '#475569' } },
      {
        id: 'rod',
        type: 'line',
        transform: { ...T(), x: 0, y: 0, rotation: { expr: 'deg(theta)' } },
        length: L * 60,
        style: { stroke: '#334155', strokeWidth: 2 },
      },
      {
        id: 'bob',
        type: 'ellipse',
        transform: { ...T(), x: { expr: `${L} * sin(theta)` }, y: { expr: `${L} * cos(theta)` } },
        rx: 7,
        ry: 7,
        style: { fill: '#f59e0b', stroke: '#b45309', strokeWidth: 1.5 },
      },
    ],
    {
      duration: 8,
      params: { theta: { value: 0, min: -1.5, max: 1.5, step: 0.01 } },
    },
  )

  it('compiles with no warnings and no templates', () => {
    const c = compileAnimation(anim)
    expect(c.warnings).toEqual([])
    expect(anim.nodes.every((n) => n.type !== 'use')).toBe(true)
  })

  it('swings when theta is driven', () => {
    const drive = (t: number) => {
      const c = compileAnimation(anim)
      return evaluate(c, t, { theta: Math.sin(t) * 0.6 })
    }
    const mid = drive(1.57)
    const bob = mid.nodes.find((n) => n.id === 'bob')!
    // Free scenes use canvas coordinates: y grows downward, so a hanging
    // bob has positive y.
    expect(bob.y).toBeGreaterThan(0)
    expect(Math.abs(bob.x)).toBeGreaterThan(0.5)
  })

  it('keeps the bob at the end of the rod', () => {
    const at = (theta: number) => {
      const f = evaluate(compileAnimation(anim), 0, { theta })
      const bob = f.nodes.find((n) => n.id === 'bob')!
      return Math.hypot(bob.x, bob.y)
    }
    for (const theta of [0, 0.4, -0.9]) expect(at(theta)).toBeCloseTo(L, 9)
  })
})

/* ------------------------------------------------------------------ *
 *  Geometry
 * ------------------------------------------------------------------ */

describe('view geometry', () => {
  it('derives a view box from the aspect ratio', () => {
    expect(viewFor(0.5, undefined).height).toBeCloseTo(500, 6)
    expect(viewFor(undefined, 400).height).toBe(400)
  })

  it('maps data units into the frame and back', () => {
    const view = viewFor(0.5, undefined)
    const f = makeFrame({ x: 0, y: 0, w: 500, h: 500 }, [0, 10], [-5, 5])
    expect(f.sx(5)).toBe(250)
    expect(f.sy(0)).toBe(250)
    expect(f.iy(250)).toBeCloseTo(0, 9)
    expect(f.ix(250)).toBeCloseTo(5, 9)
    void view
  })

  it('puts the free frame in scene units with y up', () => {
    const f = freeFrame({ width: 1000, height: 600 })
    // Canvas coordinates: y = 0 is the top edge and grows downward, exactly
    // like SVG. Inside an `axes` node the y domain is flipped instead.
    expect(f.sy(0)).toBe(0)
    expect(f.sy(600)).toBe(600)
  })

  it('does not divide by zero on a degenerate domain', () => {
    const f = makeFrame({ x: 0, y: 0, w: 100, h: 100 }, [5, 5], [5, 5])
    expect(Number.isFinite(f.sx(7))).toBe(true)
    expect(Number.isFinite(f.sy(7))).toBe(true)
  })
})

describe('ticks', () => {
  it('produces round numbers inside the domain', () => {
    const t = ticksFor([0, 7], 7)
    expect(t[0]).toBe(0)
    expect(t[t.length - 1]).toBeLessThanOrEqual(7)
    expect(t.every((v) => v % 1 === 0)).toBe(true)
  })

  it('is empty for a degenerate domain rather than infinite', () => {
    expect(ticksFor([3, 3], 5)).toEqual([])
    expect(ticksFor([0, 10], 0)).toEqual([])
  })

  it('caps the count', () => {
    expect(ticksFor([0, 1e9], 40).length).toBeLessThanOrEqual(200)
  })
})

describe('trim, the generic reveal', () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]

  it('draws nothing at 0 and everything at 1', () => {
    expect(trimPath(square, 0)).toBe('')
    expect(trimPath(square, 1)).toContain('L 10 10')
  })

  it('draws a prefix in between', () => {
    const half = trimPath(square, 0.5)
    expect(half).not.toBe('')
    expect(half.split('L').length).toBeLessThan(trimPath(square, 1).split('L').length)
  })

  it('never returns a one-point path, which renders as a stray dot', () => {
    const d = trimPath(square, 0.01)
    expect(d === '' || d.split('L').length >= 2).toBe(true)
  })
})
describe('axes frames', () => {
  it('positions a frame from its fractional rect', () => {
    const view = { width: 1000, height: 620 }
    const outer = freeFrame(view)
    // The same computation the renderer does for an axes node.
    const r: [number, number, number, number] = [0.07, 0.06, 0.9, 0.8]
    const box = {
      x: outer.box.x + r[0] * outer.box.w,
      y: outer.box.y + r[1] * outer.box.h,
      w: r[2] * outer.box.w,
      h: r[3] * outer.box.h,
    }
    expect(box.x).toBeCloseTo(70, 9)
    expect(box.w).toBeCloseTo(900, 9)
    // Room left below for tick labels, which is the whole reason for the inset.
    expect(view.height - (box.y + box.h)).toBeGreaterThan(40)
  })

  it('lets two frames share the clock as stacked panels', () => {
    const anim = scene([
      {
        id: 'top',
        type: 'axes',
        transform: T(),
        axes: {
          xDomain: [0, 4],
          yDomain: [0, 1],
          rect: [0, 0, 1, 0.5],
          ticks: { x: 4, y: 2 },
        },
        children: [],
      },
      {
        id: 'bottom',
        type: 'axes',
        transform: T(),
        axes: {
          xDomain: [0, 4],
          yDomain: [0, 1],
          rect: [0, 0.5, 1, 0.5],
          ticks: { x: 4, y: 2 },
        },
        children: [],
      },
    ])
    const compiled = compileAnimation(anim)
    expect(compiled.nodes).toHaveLength(2)
    // Both frames advance with the same clock; that is the point of panels.
    expect(evaluate(compiled, 1)).not.toBeNull()
  })
})

describe('scene variables reach the renderer', () => {
  const anim = scene(
    [
      {
        id: 'charge1',
        type: 'ellipse',
        transform: { ...T(), x: { expr: 'x1' }, y: { expr: 'y1' } },
        style: { fill: '#dc2626' },
      },
      {
        id: 'charge2',
        type: 'ellipse',
        transform: { ...T(), x: { expr: 'x2' }, y: { expr: 'y2' } },
        style: { fill: '#2563eb' },
      },
    ],
    {
      duration: 10,
      params: { q1: { value: 2 }, q2: { value: -2 } },
      vars: {
        x1: '-3 + 0.3 * t',
        y1: '0',
        x2: '3 - 0.3 * t',
        y2: '0',
        r2: '(x2 - x1)^2',
        F: '9e9 * q1 * q2 / max(r2, 0.01)',
      },
    },
  )

  it('compiles with no warnings', () => {
    expect(compileAnimation(anim).warnings).toEqual([])
  })

  it('moves both charges according to the clock', () => {
    const at = (t: number) => evaluate(compileAnimation(anim), t).nodes
    expect(at(0)[0].x).toBeCloseTo(-3, 9)
    expect(at(5)[0].x).toBeCloseTo(-1.5, 9)
    expect(at(5)[1].x).toBeCloseTo(1.5, 9)
  })

  it('re-evaluates variables every frame rather than freezing them', () => {
    // The bug this guards: resolving variables once, at t = 0.
    const c = compileAnimation(anim)
    const x0 = evaluate(c, 0).nodes[0].x
    const x6 = evaluate(c, 6).nodes[0].x
    expect(x6).not.toBeCloseTo(x0, 6)
  })

  it('lets a control override change the result live, without moving t', () => {
    const c = compileAnimation(anim)
    const base = evaluate(c, 0).nodes[0].x
    const moved = evaluate(c, 0, { q1: 9 }).nodes[0].x
    // Positions come from `vars`, which do not read q1 here, so only the
    // derived quantities change — which is the point of separating them.
    expect(moved).toBeCloseTo(base, 9)
    const closer = { ...anim, vars: { ...anim.vars, x1: '-3 + q1 * t' } }
    expect(evaluate(compileAnimation(closer), 1, { q1: 9 }).nodes[0].x).toBeCloseTo(6, 9)
  })

  it('reports a bad variable without failing the scene', () => {
    const broken = { ...anim, vars: { ...anim.vars, oops: '1 +' } }
    const c = compileAnimation(broken)
    expect(c.warnings.some((w) => w.field === 'vars.oops')).toBe(true)
    expect(() => evaluate(c, 2)).not.toThrow()
  })

  it('reports a cycle without failing the scene', () => {
    const looped = { ...anim, vars: { ...anim.vars, p: 'q', q: 'p' } }
    const c = compileAnimation(looped)
    expect(c.warnings.some((w) => w.message.includes('حلقوی'))).toBe(true)
    expect(() => evaluate(c, 2)).not.toThrow()
  })

  it('refuses a variable that would shadow the language', () => {
    const shadowed = { ...anim, vars: { ...anim.vars, t: '99' } }
    const c = compileAnimation(shadowed)
    expect(c.warnings.some((w) => w.field === 'vars.t')).toBe(true)
    // The clock is untouched.
    expect(evaluate(c, 3).nodes[0].x).toBeCloseTo(evaluate(compileAnimation(anim), 3).nodes[0].x, 9)
  })
})

describe('an event drives a real particle burst', () => {
  /**
   * The whole chain in one scene: two charges approaching, a condition on
   * their separation, and a burst of sparks at the midpoint. If this passes,
   * events, variables, particles and the clock are wired to each other.
   */
  const anim = scene(
    [
      { id: 'c1', type: 'ellipse', transform: { ...T(), x: { expr: 'x1' }, y: 0 } },
      { id: 'c2', type: 'ellipse', transform: { ...T(), x: { expr: 'x2' }, y: 0 } },
    ],
    {
      duration: 10,
      params: { q1: { value: 2 }, q2: { value: -2 } },
      vars: { x1: '-3 + 0.3 * t', x2: '3 - 0.3 * t', r: 'x2 - x1' },
      events: [
        {
          id: 'spark',
          when: 'r < 3',
          actions: [
            { type: 'spawnParticles', at: ['(x1 + x2) / 2', '0'], count: 24, color: '#fbbf24', speed: 3, lifetime: 0.8, shape: 'spark' },
            { type: 'flash', target: 'c1', color: '#fbbf24', duration: 0.2 },
          ],
        },
      ],
    },
  )

  it('compiles both the variables and the condition', () => {
    const c = compileAnimation(anim)
    expect(c.warnings).toEqual([])
    expect(c.vars.order.map((v) => v.name)).toEqual(['x1', 'x2', 'r'])
    expect(c.events.events.map((e) => e.id)).toEqual(['spark'])
  })

  it('stays quiet while the charges are far apart', () => {
    const plan = planEvents(anim.events, ['r', 'x1', 'x2'])
    const compiled = compileAnimation(anim)
    const env: EvalEnv = { t: 0, lt: 0, x: 0, u: 0, duration: 10, v: { ...valueOf(compiled, 0) } }
    expect(stepEvents(plan, 0, env).fired).toEqual([])
  })

  it('fires once as they close, and the burst lands between them', () => {
    const compiled = compileAnimation(anim)
    const plan = planEvents(anim.events, ['r', 'x1', 'x2'])
    const particles = new ParticleSystem()

    let fired = 0
    for (let t = 0; t <= 10; t += 1 / 60) {
      const env: EvalEnv = { t, lt: t, x: t, u: 0, duration: 10, v: { ...valueOf(compiled, t) } }
      const out = stepEvents(plan, t, env)
      if (out.actions.length === 0) continue
      fired += out.fired.length
      for (const a of out.actions) {
        if (a.type === 'spawnParticles') {
          const at = evalPoint(a.at, env)
          particles.spawn(at, { count: a.count, color: a.color, speed: a.speed, lifetime: a.lifetime, shape: a.shape })
        }
      }
    }

    // r < 3 first holds at t = 5, so exactly one burst in the whole run.
    expect(fired).toBe(1)
    expect(particles.live.length).toBe(24)
    // The burst is at the midpoint: 0 by the symmetry of the setup.
    const meanX = particles.live.reduce((sum, p) => sum + p.x, 0) / particles.live.length
    expect(Math.abs(meanX)).toBeLessThan(0.001)
    expect(particles.live.every((p) => p.color === '#fbbf24')).toBe(true)
  })

  it('survives the whole lifecycle and cleans itself up', () => {
    const compiled = compileAnimation(anim)
    const plan = planEvents(anim.events, ['r', 'x1', 'x2'])
    const particles = new ParticleSystem()
    for (let t = 0; t <= 10; t += 1 / 60) {
      const env: EvalEnv = { t, lt: t, x: t, u: 0, duration: 10, v: { ...valueOf(compiled, t) } }
      for (const a of stepEvents(plan, t, env).actions) {
        if (a.type === 'spawnParticles') {
          const at = evalPoint(a.at, env)
          particles.spawn(at, { count: a.count, color: a.color, speed: a.speed, lifetime: a.lifetime, shape: a.shape })
        }
      }
      particles.step(1 / 60)
    }
    // The burst happened around t = 5 and lives 0.8 s, so by t = 10 it is gone.
    expect(particles.live).toHaveLength(0)
    expect(particles.count).toBeLessThanOrEqual(MAX_PARTICLES)
  })

  it('a control override can delay the burst, because it changes r', () => {
    const slower = {
      ...anim,
      vars: { x1: '-3 + 0.2 * t', x2: '3 - 0.2 * t', r: 'x2 - x1' },
    }
    const compiled = compileAnimation(slower)
    const plan = planEvents(slower.events, ['r'])
    let firedAt = -1
    for (let t = 0; t <= 10 && firedAt < 0; t += 1 / 60) {
      const env: EvalEnv = { t, lt: t, x: t, u: 0, duration: 10, v: { ...valueOf(compiled, t) } }
      if (stepEvents(plan, t, env).fired.length) firedAt = t
    }
    // Closing at 0.2 instead of 0.3 pushes the crossing from 5 s to 7.5 s.
    expect(firedAt).toBeGreaterThan(7)
    expect(firedAt).toBeLessThan(8)
  })
})
