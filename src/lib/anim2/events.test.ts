import { describe, expect, it } from 'vitest'
import type { EvalEnv } from './expr'
import { evalPoint, planEvents, resetEvents, stepEvents, type AnimEventDef } from './events'
import { MAX_PARTICLES, ParticleSystem, particleFade } from './particles'

const env = (over: Partial<EvalEnv> = {}): EvalEnv => ({
  t: 0, lt: 0, x: 0, u: 0, duration: 10, v: { r: 5 }, ...over,
})

describe('event rising-edge detection', () => {
  const defs: AnimEventDef[] = [
    { id: 'close', when: 'r < 1.5', actions: [{ type: 'log', message: 'spark' }] },
  ]

  it('does not fire while the condition stays true', () => {
    const plan = planEvents(defs, ['r'])
    // True at 0.5, still true at 0.6 — one burst, not two.
    expect(stepEvents(plan, 0.5, env({ t: 0.5, v: { r: 1 } })).fired).toEqual(['close'])
    expect(stepEvents(plan, 0.6, env({ t: 0.6, v: { r: 1 } })).fired).toEqual([])
    expect(stepEvents(plan, 0.7, env({ t: 0.7, v: { r: 1 } })).fired).toEqual([])
  })

  it('fires again after the condition goes false and true again', () => {
    const plan = planEvents([{ ...defs[0]!, once: false }], ['r'])
    expect(stepEvents(plan, 0.5, env({ t: 0.5, v: { r: 1 } })).fired).toHaveLength(1)
    expect(stepEvents(plan, 0.6, env({ t: 0.6, v: { r: 9 } })).fired).toHaveLength(0)
    expect(stepEvents(plan, 0.7, env({ t: 0.7, v: { r: 1 } })).fired).toHaveLength(1)
  })

  it('fires exactly once by default', () => {
    const plan = planEvents(defs, ['r'])
    stepEvents(plan, 0.5, env({ t: 0.5, v: { r: 1 } }))
    stepEvents(plan, 0.6, env({ t: 0.6, v: { r: 9 } }))
    expect(stepEvents(plan, 0.7, env({ t: 0.7, v: { r: 1 } })).fired).toHaveLength(0)
  })

  it('honours a cooldown', () => {
    const plan = planEvents([{ id: 'e', when: 'r < 1.5', once: false, cooldown: 2, actions: [] }], ['r'])
    expect(stepEvents(plan, 1, env({ t: 1, v: { r: 1 } })).fired).toHaveLength(1)
    // Re-arms immediately, but the cooldown blocks it for two seconds.
    expect(stepEvents(plan, 1.1, env({ t: 1.1, v: { r: 9 } })).fired).toHaveLength(0)
    // Edge at t = 2, but only 1 s since the last fire, so the cooldown blocks it.
    expect(stepEvents(plan, 2, env({ t: 2, v: { r: 1 } })).fired).toHaveLength(0)
    expect(stepEvents(plan, 2.2, env({ t: 2.2, v: { r: 9 } })).fired).toHaveLength(0)
    expect(stepEvents(plan, 3.1, env({ t: 3.1, v: { r: 1 } })).fired).toHaveLength(1)
  })

  it('fires once when entering an already-true region, then stays quiet', () => {
    const plan = planEvents(defs, ['r'])
    // The first frame sees false → true, which is a legitimate edge.
    expect(stepEvents(plan, 5, env({ t: 5, v: { r: 1 } })).fired).toEqual(['close'])
    // Scrubbing deeper into the same true region must not fire again.
    expect(stepEvents(plan, 5.1, env({ t: 5.1, v: { r: 1 } })).fired).toEqual([])
    expect(stepEvents(plan, 5.9, env({ t: 5.9, v: { r: 1 } })).fired).toEqual([])
  })

  it('fires when seeking backwards across the edge', () => {
    const plan = planEvents([{ ...defs[0]!, once: false }], ['r'])
    stepEvents(plan, 5, env({ t: 5, v: { r: 9 } }))
    expect(stepEvents(plan, 4.9, env({ t: 4.9, v: { r: 1 } })).fired).toHaveLength(1)
  })

  it('re-arms after a reset', () => {
    const plan = planEvents(defs, ['r'])
    stepEvents(plan, 0.5, env({ t: 0.5, v: { r: 1 } }))
    resetEvents(plan)
    expect(stepEvents(plan, 0.6, env({ t: 0.6, v: { r: 1 } })).fired).toEqual(['close'])
  })

  it('collects every action of a fired event in order', () => {
    const plan = planEvents(
      [{ id: 'e', when: 'r < 1', actions: [{ type: 'log', message: 'a' }, { type: 'pause' }] }],
      ['r'],
    )
    expect(stepEvents(plan, 1, env({ t: 1, v: { r: 0.5 } })).actions.map((a) => a.type)).toEqual(['log', 'pause'])
  })

  it('reports a condition it cannot compile rather than dropping it silently', () => {
    const plan = planEvents([{ id: 'bad', when: 'r <', actions: [] }, { id: 'ok', when: 'r < 2', actions: [] }], ['r'])
    expect(plan.broken).toEqual(['bad'])
    expect(plan.events.map((e) => e.id)).toEqual(['ok'])
  })

  it('handles no events at all', () => {
    expect(planEvents(undefined, []).events).toEqual([])
    expect(planEvents([], []).events).toEqual([])
    expect(stepEvents(planEvents(undefined, []), 1, env()).fired).toEqual([])
  })
})

describe('action positions', () => {
  it('resolves an [expr, expr] pair against the live namespace', () => {
    const p = evalPoint(['(x1 + x2) / 2', '(y1 + y2) / 2'], env({ v: { x1: -3, x2: 3, y1: 0, y2: 4 } }))
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(2, 9)
  })

  it('falls back to zero rather than throwing on a broken pair', () => {
    expect(evalPoint(['nope + 1', '2'], env())).toEqual({ x: 0, y: 2 })
  })
})

describe('particles', () => {
  it('spawns the requested count', () => {
    const sys = new ParticleSystem()
    expect(sys.spawn({ x: 0, y: 0 }, { count: 20, color: '#fbbf24', speed: 3, lifetime: 0.8 })).toBe(20)
    expect(sys.count).toBe(20)
    expect(sys.live).toHaveLength(20)
  })

  it('never exceeds the cap, recycling the oldest', () => {
    const sys = new ParticleSystem()
    for (let i = 0; i < 10; i += 1) {
      sys.spawn({ x: 0, y: 0 }, { count: 100, color: '#fff', speed: 1, lifetime: 10 })
    }
    expect(sys.count).toBeLessThanOrEqual(MAX_PARTICLES)
    expect(sys.live.length).toBeLessThanOrEqual(MAX_PARTICLES)
  })

  it('retires particles when their life runs out', () => {
    const sys = new ParticleSystem()
    sys.spawn({ x: 0, y: 0 }, { count: 10, color: '#fff', speed: 1, lifetime: 0.5 })
    sys.step(0.3)
    expect(sys.live).toHaveLength(10)
    sys.step(0.3)
    expect(sys.live).toHaveLength(0)
  })

  it('clamps the timestep so a stalled tab does not teleport everything', () => {
    const sys = new ParticleSystem()
    sys.spawn({ x: 0, y: 0 }, { count: 1, color: '#fff', speed: 10, lifetime: 10 })
    const before = sys.live[0]!.x
    sys.step(5)
    // Clamped to a quarter second, so a five-second stall advances 0.25 s.
    expect(sys.live[0]!.x - before).toBeLessThanOrEqual(10 * 0.25 + 1e-9)
    expect(sys.live[0]!.x - before).toBeGreaterThan(0)
  })

  it('moves particles outward from the burst', () => {
    const sys = new ParticleSystem()
    sys.spawn({ x: 0, y: 0 }, { count: 8, color: '#fff', speed: 4, lifetime: 5, seed: 1 })
    sys.step(0.2)
    const moved = sys.live.filter((p) => Math.hypot(p.x, p.y) > 0.1)
    expect(moved.length).toBeGreaterThan(4)
  })

  it('is deterministic, so scrubbing replays the same burst', () => {
    const a = new ParticleSystem()
    const b = new ParticleSystem()
    const o = { count: 12, color: '#f00', speed: 2, lifetime: 1, seed: 7 }
    a.spawn({ x: 1, y: 2 }, o)
    b.spawn({ x: 1, y: 2 }, o)
    expect(JSON.stringify(a.live)).toBe(JSON.stringify(b.live))
  })

  it('skips the spawn when the frame is already late', () => {
    const sys = new ParticleSystem()
    expect(sys.spawn({ x: 0, y: 0 }, { count: 50, color: '#fff', speed: 1, lifetime: 1, budgetMs: 20 })).toBe(0)
    expect(sys.count).toBe(0)
    // Just inside the budget it still spawns.
    expect(sys.spawn({ x: 0, y: 0 }, { count: 50, color: '#fff', speed: 1, lifetime: 1, budgetMs: 15 })).toBe(50)
  })

  it('applies gravity and drag', () => {
    const sys = new ParticleSystem()
    sys.spawn({ x: 0, y: 0 }, { count: 1, color: '#fff', speed: 0, lifetime: 5 })
    const p = sys.live[0]!
    const y0 = p.y
    sys.step(0.5, 9.8, 1)
    expect(sys.live[0]!.y).toBeGreaterThan(y0)
  })

  it('clears everything on demand', () => {
    const sys = new ParticleSystem()
    sys.spawn({ x: 0, y: 0 }, { count: 30, color: '#fff', speed: 1, lifetime: 5 })
    sys.clear()
    expect(sys.count).toBe(0)
    expect(sys.live).toHaveLength(0)
  })

  it('fades from one to zero across its life', () => {
    const sys = new ParticleSystem()
    sys.spawn({ x: 0, y: 0 }, { count: 1, color: '#fff', speed: 0, lifetime: 1 })
    expect(particleFade(sys.live[0]!)).toBeCloseTo(1, 9)
    // Fade is a function of remaining life, so it is checked at the values the
    // simulation actually reaches rather than at ideal halves.
    sys.step(0.25)
    expect(particleFade(sys.live[0]!)).toBeCloseTo(0.75, 6)
    sys.step(0.25)
    expect(particleFade(sys.live[0]!)).toBeCloseTo(0.5, 6)
    // Past the end: each step is clamped to 0.25 s, so it takes two of them.
    sys.step(0.25)
    expect(sys.live).toHaveLength(1)
    sys.step(0.25)
    expect(sys.live).toHaveLength(0)
  })

  it('bumps a version so a renderer can subscribe cheaply', () => {
    const sys = new ParticleSystem()
    const v0 = sys.version
    sys.spawn({ x: 0, y: 0 }, { count: 1, color: '#fff', speed: 1, lifetime: 1 })
    expect(sys.version).toBeGreaterThan(v0)
  })
})