import { describe, expect, it } from 'vitest'
import {
  BASE_VARS,
  clearExprCache,
  compileExpr,
  ExprError,
  evalExpr,
  exprCacheSize,
  type EvalEnv,
  type Scope,
  validateExpr,
} from './expr'

/** A scope with everything a demo scene could plausibly bind. */
const SCOPE: Scope = {
  vars: new Set([...BASE_VARS, 'a', 'k', 'w', 'v0', 'شتاب']),
  refIds: new Set(['body', 'plot']),
}

function env(over: Partial<EvalEnv> = {}): EvalEnv {
  return {
    t: 0,
    lt: 0,
    x: 0,
    u: 0,
    duration: 10,
    v: { a: 2, k: 3, w: 4, v0: 10, شتاب: 9.8 },
    ...over,
  }
}

const at = (src: string, e: Partial<EvalEnv> = {}): number => evalExpr(src, SCOPE, env(e))

describe('lexer and parser', () => {
  it('reads Persian digits and Persian identifiers', () => {
    expect(at('۲ + ۳')).toBe(5)
    expect(at('شتاب * 2', { t: 0 })).toBeCloseTo(19.6, 12)
  })

  it('is case sensitive', () => {
    const scope: Scope = { vars: new Set(['a', 'A']), refIds: new Set() }
    const e = env({ v: { a: 1, A: 100 } })
    expect(evalExpr('a', scope, e)).toBe(1)
    expect(evalExpr('A', scope, e)).toBe(100)
  })

  it('treats ^ as right associative', () => {
    expect(at('2^3^2')).toBe(512) // 2^(3^2), not (2^3)^2
  })

  it('binds unary minus below the power', () => {
    expect(at('-2^2')).toBe(-4)
    expect(at('2^-1')).toBe(0.5)
  })

  it('supports implicit multiplication', () => {
    expect(at('2t', { t: 3 })).toBe(6)
    expect(at('3(t+1)', { t: 1 })).toBe(6)
    expect(at('2pi')).toBeCloseTo(2 * Math.PI, 12)
    expect(at('(t+1)(t+2)', { t: 0 })).toBe(2)
  })

  it('still reads subtraction after a complete operand', () => {
    // `2 - 3t` is 2 − 3t, not an error caused by the minus looking unary.
    expect(at('2 - 3t', { t: 2 })).toBe(-4)
  })

  it('parses scientific notation', () => {
    expect(at('1.5e3')).toBe(1500)
    expect(at('2e-2')).toBe(0.02)
  })

  it('keeps `2e` as two multiplied by the constant e', () => {
    expect(at('2e')).toBeCloseTo(2 * Math.E, 12)
  })

  it('evaluates comparisons and logic as numbers', () => {
    expect(at('t > 1 && t < 3', { t: 2 })).toBe(1)
    expect(at('t > 1 && t < 3', { t: 4 })).toBe(0)
    expect(at('t == 2 || 0', { t: 2 })).toBe(1)
    expect(at('t != 2', { t: 2 })).toBe(0)
  })

  it('gives && higher precedence than ||', () => {
    // 1 || (0 && 0) -> 1
    expect(at('1 || 0 && 0')).toBe(1)
    // (1 || 0) && 0 -> 0
    expect(at('(1 || 0) && 0')).toBe(0)
  })
})

describe('functions', () => {
  it('provides the conditional and clamping set', () => {
    expect(at('if(t > 1, 10, 20)', { t: 2 })).toBe(10)
    expect(at('clamp(t, 0, 1)', { t: 5 })).toBe(1)
    expect(at('lerp(0, 10, t)', { t: 0.25 })).toBe(2.5)
    expect(at('step(1, t)', { t: 0.5 })).toBe(0)
    expect(at('step(1, t)', { t: 1 })).toBe(1)
    expect(at('smoothstep(0, 1, 0.5)')).toBe(0.5)
    expect(at('sign(-3)')).toBe(-1)
  })

  it('uses true mathematical mod, not the remainder operator', () => {
    expect(at('mod(-1, 3)')).toBe(2)
    expect(at('-1 % 3')).toBe(2)
    expect(at('5 % -3')).toBe(-1)
  })

  it('min and max take two arguments', () => {
    expect(at('max(t, 5)', { t: 2 })).toBe(5)
    expect(at('min(t, 5)', { t: 2 })).toBe(2)
  })
})

describe('errors', () => {
  it('reports an unknown name in Persian with a position', () => {
    const r = validateExpr('2 * nope', SCOPE)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.pos).toBe(5)
      expect(r.message).toContain('شناسهٔ ناشناخته')
    }
  })

  it('rejects an unbalanced parenthesis', () => {
    expect(() => compileExpr('(2 + 3', SCOPE)).toThrow(ExprError)
  })

  it('rejects a bad function arity', () => {
    const r = validateExpr('sin(1, 2)', SCOPE)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('یک آرگومان')
  })

  it('refuses references when the scope forbids them', () => {
    const scope: Scope = { vars: new Set(BASE_VARS) }
    const r = validateExpr('@body.x', scope)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('ارجاع')
  })

  it('rejects a reference to a node that does not exist', () => {
    const r = validateExpr('@ghost.x', SCOPE)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('ghost')
  })

  it('rejects a bare @node with no property', () => {
    const r = validateExpr('@body', SCOPE)
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown character', () => {
    const r = validateExpr('t # 2', SCOPE)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('ناشناخته')
  })
})

describe('references', () => {
  const withRef = (src: string, valueAt: (path: string, at: number) => number): number =>
    evalExpr(src, SCOPE, env({ t: 2, refAt: valueAt }))

  it('reads @node.prop at the current time', () => {
    expect(withRef('@body.x', (_p, t) => t * 10)).toBe(20)
  })

  it('reads @plot.at(x)', () => {
    const v = evalExpr('@plot.at(x)', SCOPE, env({ x: 3, plotAt: (_id, x) => x * x }))
    expect(v).toBe(9)
  })

  it('reports which references it uses', () => {
    const deps = compileExpr('@body.x + @plot.at(t)', SCOPE).refs
    expect(deps).toEqual(['body.x', 'plot.at'])
  })
})

describe('derivatives', () => {
  const d = (src: string, e: Partial<EvalEnv> = {}): number =>
    evalExpr(`d(${src})`, SCOPE, env(e))

  it('differentiates polynomials exactly', () => {
    expect(d('4*t - 2*t*t', { t: 3 })).toBeCloseTo(4 - 4 * 3, 10)
    expect(d('t^3', { t: 2 })).toBeCloseTo(12, 10)
  })

  it('applies the chain rule', () => {
    expect(d('sin(3*t)', { t: 0.5 })).toBeCloseTo(3 * Math.cos(1.5), 10)
    expect(d('exp(2*t)', { t: 1 })).toBeCloseTo(2 * Math.exp(2), 10)
  })

  it('differentiates a quotient by the reciprocal rule', () => {
    expect(d('t/t', { t: 2 })).toBeCloseTo(0, 10)
  })

  it('treats axis variables and parameters as constants', () => {
    expect(d('x^2 + a*t', { t: 5, x: 9 })).toBeCloseTo(2, 10)
  })

  it('returns zero for piecewise-constant functions', () => {
    expect(d('floor(t)')).toBe(0)
    expect(d('t > 1')).toBe(0)
  })

  it('falls back to a central difference over a reference', () => {
    // d(t^2) = 2t, resolved through the engine rather than symbolically
    const value = evalExpr('d(@body.x)', SCOPE, env({ t: 3, refAt: (_p, at) => at * at }))
    expect(value).toBeCloseTo(6, 3)
  })

  it('agrees with a numeric derivative on a mixed expression', () => {
    const src = '3*t*t - 2*t + 1'
    const numeric = (t: number): number => {
      const h = 1e-6
      return (at(src, { t: t + h }) - at(src, { t: t - h })) / (2 * h)
    }
    for (const t of [0.3, 1.7, 5]) {
      expect(d(src, { t })).toBeCloseTo(numeric(t), 6)
    }
  })
})

describe('dependency analysis', () => {
  it('knows when a value cannot change with time', () => {
    expect(compileExpr('x^2 + 3', SCOPE).timeDependent).toBe(false)
    expect(compileExpr('t*x', SCOPE).timeDependent).toBe(true)
    expect(compileExpr('@body.x', SCOPE).timeDependent).toBe(true)
  })

  it('lists the free names it reads', () => {
    expect([...compileExpr('2*a + k', SCOPE).deps].sort()).toEqual(['a', 'k'])
  })
})

describe('cache', () => {
  it('reuses compiled expressions and respects its cap', () => {
    clearExprCache()
    const a = compileExpr('t*2', SCOPE)
    const b = compileExpr('t*2', SCOPE)
    expect(a).toBe(b)

    for (let i = 0; i < 600; i += 1) compileExpr(`t*${i}`, SCOPE)
    expect(exprCacheSize()).toBeLessThanOrEqual(500)
    clearExprCache()
  })

  it('keys on the scope, so the same source can compile differently', () => {
    clearExprCache()
    const wide: Scope = { vars: new Set([...BASE_VARS, 'q']), refIds: new Set() }
    const narrow: Scope = { vars: new Set(BASE_VARS), refIds: new Set() }
    expect(validateExpr('q', wide).ok).toBe(true)
    expect(validateExpr('q', narrow).ok).toBe(false)
    expect(compileExpr('t', wide)).not.toBe(compileExpr('t', narrow))
    clearExprCache()
  })
})

describe('runtime safety', () => {
  it('turns NaN into nothing rather than poisoning the scene', () => {
    expect(at('t/0', { t: 0 })).toBe(0)
  })

  it('lets Infinity through so the renderer can clamp visibly', () => {
    expect(at('1/0')).toBe(Infinity)
  })
})
describe('derivative cross-check against numeric differences', () => {
  /**
   * The strongest guarantee we can make about `d()`: for every expression we
   * claim to differentiate, the symbolic result must match a high-resolution
   * central difference somewhere well inside the curve.
   */
  const cases: [string, number][] = [
    ['4*t - 2*t*t', 3],
    ['t^3', 2],
    ['sin(3*t)', 0.5],
    ['cos(t)', 1.1],
    ['exp(2*t)', 0.4],
    ['ln(t + 2)', 1.7],
    ['sqrt(t + 1)', 0.6],
    ['1/(t + 2)', 1.3],
    ['t/(t + 3)', 2.2],
    ['pow(t, 3)', 1.9],
    ['hypot(t, t)', 2.5],
    ['atan2(t, t + 1)', 1.2],
    ['t*t + 5*t*t*t', 0.8],
    ['(2*t + 1)^2', 1.1],
    ['2*t*sin(t)', 0.9],
    ['(t + 1)/(t + 2)', 1.4],
  ]

  it.each(cases)('d(%s) matches the numeric derivative', (src, t) => {
    const h = 1e-6
    const numeric = (at(src, { t: t + h }) - at(src, { t: t - h })) / (2 * h)
    expect(at(`d(${src})`, { t })).toBeCloseTo(numeric, 5)
  })

  it('returns zero without dividing by zero for a constant', () => {
    expect(at('d(x^2 + 3)', { x: 4 })).toBe(0)
    expect(at('d(7)')).toBe(0)
  })
})
