import { describe, expect, it } from 'vitest'
import { BASE_VARS, type EvalEnv } from './expr'
import { describeVars, isLegalName, planVars, resolveVars } from './vars'

const env = (over: Partial<EvalEnv> = {}): EvalEnv => ({
  t: 0,
  lt: 0,
  x: 0,
  u: 0,
  duration: 10,
  v: { q1: 1, q2: 1, k: 9e9 },
  ...over,
})

/** Mirrors the engine: a scene's vars may read its parameters. */
const evalAll = (vars: Record<string, string>, e: Partial<EvalEnv> = {}) => {
  const full = env(e)
  return resolveVars(planVars(vars, Object.keys(full.v)), full)
}

describe('variable resolution', () => {
  it('evaluates in dependency order, not declaration order', () => {
    // `F` is written before `r2` and still resolves.
    const out = evalAll({ F: '9e9 * q1 * q2 / max(r2, 0.01)', r2: '(x2 - x1)^2', x1: '-3', x2: '3' })
    expect(out['r2']).toBe(36)
    expect(out['F']).toBeCloseTo(9e9 / 36, 3)
  })

  it('chains through several levels', () => {
    const out = evalAll({ a: '2*t', b: 'a + 1', c: 'b * a', root: 'sqrt(c)' }, { t: 3 })
    expect(out['a']).toBe(6)
    expect(out['b']).toBe(7)
    expect(out['c']).toBe(42)
    expect(out['root']).toBeCloseTo(Math.sqrt(42), 12)
  })

  it('reads the clock like any other expression', () => {
    expect(evalAll({ v: '4*t - 2*t*t' }, { t: 3 })['v']).toBe(-6)
  })

  it('reads parameters bound on the environment', () => {
    expect(evalAll({ F: 'k*q1*q2' })['F']).toBeCloseTo(9e9, 3)
  })

  it('returns a fresh map so a caller cannot corrupt the next frame', () => {
    const plan = planVars({ a: 't' })
    const first = resolveVars(plan, env({ t: 1 }))
    first['a'] = 999
    expect(resolveVars(plan, env({ t: 1 }))['a']).toBe(1)
  })

  it('handles an empty or absent block', () => {
    expect(resolveVars(planVars(undefined), env())).toEqual({})
    expect(resolveVars(planVars({}), env())).toEqual({})
  })
})

describe('cycles', () => {
  it('detects a two-variable cycle and refuses to evaluate it', () => {
    const plan = planVars({ a: 'b + 1', b: 'a + 1' })
    expect(plan.cyclic.sort()).toEqual(['a', 'b'])
    expect(plan.order.map((v) => v.name)).toEqual([])
  })

  it('detects a longer cycle', () => {
    const plan = planVars({ a: 'b', b: 'c', c: 'a' })
    expect(plan.cyclic.sort()).toEqual(['a', 'b', 'c'])
  })

  it('detects a self-reference', () => {
    const plan = planVars({ a: 'a + 1' })
    expect(plan.cyclic).toContain('a')
  })

  it('still evaluates the healthy part of a scene', () => {
    const out = evalAll({ good: '2*t', a: 'b', b: 'a' }, { t: 5 })
    expect(out['good']).toBe(10)
  })
})

describe('broken and reserved entries', () => {
  it('reports a formula that does not parse but keeps going', () => {
    const plan = planVars({ bad: '1 +', good: '2*t' })
    expect(plan.broken).toEqual(['bad'])
    expect(plan.order.map((v) => v.name)).toEqual(['good'])
    const out = resolveVars(plan, env({ t: 4 }))
    expect(out['good']).toBe(8)
    expect('bad' in out).toBe(false)
  })

  it('refuses to shadow the language', () => {
    const plan = planVars({ t: '99', pi: '3', sin: '1', d: '1', clamp: '2', lt: '5' })
    expect(plan.reserved.sort()).toEqual(['clamp', 'd', 'lt', 'pi', 'sin', 't'])
    // And none of them can change the clock.
    expect(resolveVars(plan, env({ t: 7 }))['t']).toBeUndefined()
  })

  it('rejects names that are not identifiers', () => {
    expect(isLegalName('q1')).toBe(true)
    expect(isLegalName('_a9')).toBe(true)
    expect(isLegalName('1abc')).toBe(false)
    expect(isLegalName('a-b')).toBe(false)
    expect(isLegalName('a.b')).toBe(false)
    // Persian is allowed in expressions but not as a variable *name*, so that a
    // typo cannot silently become an undefined symbol.
    expect(isLegalName('شتاب')).toBe(false)
  })

  it('gives a readable reason when something was dropped', () => {
    const plan = planVars({ t: '1', bad: '@', a: 'b', b: 'a' })
    const why = describeVars(plan)
    expect(why).toContain('t')
    expect(why).toBeTruthy()
    expect(describeVars(planVars({ a: '1' }))).toBeNull()
  })
})

describe('the worked example from the specification', () => {
  it('reproduces a Coulomb force between two approaching charges', () => {
    const vars = {
      x1: '-3 + 0.3 * t',
      y1: '0',
      x2: '3 - 0.3 * t',
      y2: '0',
      dx: 'x2 - x1',
      dy: 'y2 - y1',
      r2: 'dx*dx + dy*dy',
      r: 'sqrt(r2)',
      F: '9e9 * q1 * q2 / max(r2, 0.01)',
      Fx: 'F * dx / max(r, 0.01)',
      Fy: 'F * dy / max(r, 0.01)',
    }
    const at = (t: number) => evalAll(vars, { t, v: { q1: 2, q2: -2 } })
    const early = at(0)
    // Charges 6 apart, approaching.
    expect(early['x1']).toBeCloseTo(-3, 9)
    expect(early['r']).toBeCloseTo(6, 9)
    expect(early['F']).toBeCloseTo(-36e9 / 36, 3)

    const later = at(5)
    expect(later['r']).toBeCloseTo(3, 9)
    // Opposite signs repel: they draw closer, so the magnitude grows as 1/r^2.
    expect(Math.abs(later['F'])).toBeGreaterThan(Math.abs(early['F']))
    // Both on the x axis, so the force has no y component.
    expect(later['Fy']).toBeCloseTo(0, 9)
  })
})

describe('guarding against the singularity', () => {
  it('stays finite when the charges touch', () => {
    // t = 5 puts them at 1.5 and 1.5 — coincident.
    const vars = { x1: '-3 + 0.3 * t', x2: '3 - 0.3 * t', F: '9e9 / max((x2 - x1)^2, 0.01)' }
    const out = evalAll(vars, { t: 5 })
    expect(Number.isFinite(out['F']!)).toBe(true)
  })

  it('turns a NaN result into 0 rather than poisoning the scene', () => {
    expect(evalAll({ bad: 'sqrt(-1)' })['bad']).toBe(0)
  })
})

describe('a variable may be read by an expression through the same names', () => {
  it('exposes them to the evaluator the engine already builds', () => {
    // The engine passes resolved variables in `env.v`, so a node expression
    // sees them exactly like a parameter.
    const plan = planVars({ r: 'dist(0, 0, 3, 4)' })
    const values = resolveVars(plan, env())
    expect(values['r']).toBe(5)
    expect(BASE_VARS.has('t')).toBe(true)
  })
})