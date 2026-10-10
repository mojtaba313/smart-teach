import { describe, expect, it } from 'vitest'
import { emptyAnimation2, isExpr, isKeyed, LIMITS, numOf, uid } from './anim2'

describe('uid', () => {
  /**
   * v1 derived key ids from `t` and `|v|`, so a body that moved to (0, 1) and
   * came back collided, and two layers hitting the same pose collided too.
   * Ids must be unique for the whole animation.
   */
  it('never repeats, however many are asked for', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20000; i += 1) seen.add(uid('k'))
    expect(seen.size).toBe(20000)
  })

  it('keeps the prefix so ids stay readable in JSON', () => {
    expect(uid('seg')).toMatch(/^seg[0-9a-z]+$/)
  })
})

describe('prop accessors', () => {
  it('recognises the three shapes of a numeric prop', () => {
    expect(isExpr({ expr: 't' })).toBe(true)
    expect(isKeyed({ keys: [{ id: 'a', t: 0, v: 1 }] })).toBe(true)
    expect(isExpr(3)).toBe(false)
    expect(isKeyed(undefined)).toBe(false)
  })

  it('reads a constant, and falls back for the others', () => {
    expect(numOf(5)).toBe(5)
    expect(numOf({ expr: 't' })).toBe(0)
    expect(numOf({ keys: [{ id: 'a', t: 0, v: 2 }] })).toBe(2)
    expect(numOf({ keys: [] })).toBe(0)
  })
})

describe('schema defaults', () => {
  it('produces a usable empty animation at schema 2', () => {
    const a = emptyAnimation2('t')
    expect(a.schema).toBe(2)
    expect(a.nodes).toEqual([])
    expect(a.cues).toEqual([])
    expect(a.params).toEqual({})
    expect(a.duration).toBeGreaterThan(0)
  })
})

describe('limits', () => {
  it('bounds what a single import may contain', () => {
    expect(LIMITS.maxNodes).toBeGreaterThan(0)
    expect(LIMITS.maxPlotSamples).toBeLessThanOrEqual(2000)
    expect(LIMITS.maxDuration).toBeLessThanOrEqual(600)
    expect(LIMITS.minDuration).toBeGreaterThan(0)
    expect(LIMITS.maxTemplateDepth).toBeLessThanOrEqual(8)
  })
})
