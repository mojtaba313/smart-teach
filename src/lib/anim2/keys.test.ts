import { describe, expect, it } from 'vitest'
import type { Ease } from '../../types/anim2'
import { prepareTrack, sampleKeys, sampleKeysDerivative, sampleTrack } from './keys'

const k = (t: number, v: number, ease?: Ease) => ({
  id: `k${t}`,
  t,
  v,
  ...(ease ? { ease } : {}),
})

describe('linear and clamped sampling', () => {
  it('interpolates between keys', () => {
    expect(sampleKeys([k(0, 0), k(2, 10)], 1)).toBe(5)
  })

  it('holds the end values outside the key range', () => {
    const keys = [k(1, 5), k(2, 9)]
    expect(sampleKeys(keys, 0)).toBe(5)
    expect(sampleKeys(keys, 5)).toBe(9)
  })

  it('is empty-safe', () => {
    expect(sampleKeys([], 3)).toBe(0)
    expect(sampleKeysDerivative([], 3)).toBe(0)
  })

  it('does not care what order the keys arrive in', () => {
    expect(sampleKeys([k(2, 10), k(0, 0)], 1)).toBe(5)
  })
})

describe('hold', () => {
  it('stays on the previous key until the next one', () => {
    const keys = [k(0, 0, 'hold'), k(1, 10, 'hold')]
    expect(sampleKeys(keys, 0.99)).toBe(0)
    expect(sampleKeys(keys, 1)).toBe(10)
  })
})

describe('eases', () => {
  it('passes through the endpoints exactly', () => {
    for (const ease of ['ease', 'easeIn'] as const) {
      const keys = [k(0, 0, ease), k(1, 1, ease)]
      expect(sampleKeys(keys, 0)).toBeCloseTo(0, 10)
      expect(sampleKeys(keys, 1)).toBeCloseTo(1, 10)
    }
  })

  it('easeIn starts slower than linear', () => {
    const eased = sampleKeys([k(0, 0, 'easeIn'), k(1, 1, 'easeIn')], 0.25)
    expect(eased).toBeCloseTo(0.0625, 9)
  })

  it('uses the same quadratic curves v1 used, so migrated motion is unchanged', () => {
    // These numbers are v1's `easeFactor`. Changing them would silently
    // re-time every animation already in the product.
    const at = (ease: Ease, u: number) => sampleKeys([k(0, 0, ease), k(1, 1, ease)], u)
    expect(at('ease', 0.25)).toBeCloseTo(0.125, 9)
    expect(at('ease', 0.5)).toBeCloseTo(0.5, 9)
    expect(at('ease', 0.75)).toBeCloseTo(0.875, 9)
    expect(at('easeOut', 0.25)).toBeCloseTo(0.4375, 9)
    expect(at('hold', 0.99)).toBeCloseTo(0, 9)
  })

  it('differentiates the named eases exactly', () => {
    const numeric = (ease: Ease, u: number) => {
      const h = 1e-7
      const f = (x: number) => sampleKeys([k(0, 0, ease), k(1, 1, ease)], x)
      return (f(u + h) - f(u - h)) / (2 * h)
    }
    for (const ease of ['linear', 'ease', 'easeIn', 'easeOut'] as const) {
      for (const u of [0.2, 0.5, 0.8]) {
        expect(sampleKeysDerivative([k(0, 0, ease), k(1, 1, ease)], u)).toBeCloseTo(numeric(ease, u), 4)
      }
    }
  })

  it('parses a custom cubic-bezier', () => {
    const bez: Ease = 'cubic-bezier(0, 0, 1, 1)'
    const value = sampleKeys([k(0, 0, bez), k(1, 1, bez)], 0.3)
    expect(value).toBeCloseTo(0.3, 6)
  })

  it('falls back to linear for an unparseable ease', () => {
    const value = sampleKeys([k(0, 0, 'cubic-bezier(nonsense)' as never), k(1, 10)], 0.5)
    expect(value).toBeCloseTo(5, 10)
  })
})

describe('smooth (monotone cubic)', () => {
  /**
   * The regression this exists for: with linear keys, acceleration derived
   * from velocity differences spikes at every keyframe boundary. A smooth
   * track must have continuous derivative.
   */
  const keys = [k(0, 0, 'smooth'), k(1, 1, 'smooth'), k(2, 4, 'smooth'), k(3, 9, 'smooth')]

  it('passes through every key', () => {
    const track = prepareTrack(keys)
    for (const key of keys) expect(sampleTrack(track, key.t)).toBeCloseTo(key.v, 9)
  })

  it('has no derivative jump at interior keyframe boundaries', () => {
    for (const key of keys.slice(1, -1)) {
      const before = sampleKeysDerivative(keys, key.t - 1e-4)
      const after = sampleKeysDerivative(keys, key.t + 1e-4)
      expect(Math.abs(after - before)).toBeLessThan(0.05)
    }
  })

  it('is flat outside the key range, so a moving body starts at rest', () => {
    // The outer edges are one-sided on purpose: before the first key nothing
    // has happened yet, and after the last key nothing more will.
    expect(sampleKeysDerivative(keys, 0)).toBe(0)
    expect(sampleKeysDerivative(keys, 3)).toBe(0)
    expect(sampleKeysDerivative(keys, 0 + 1e-4)).toBeCloseTo(sampleKeysDerivative(keys, 0 - 1e-4) + 1, 3)
  })

  it('does not overshoot between a peak and its neighbours', () => {
    // 0, 10, 0 — a local maximum must stay 10, not bulge above it.
    const peak = [k(0, 0, 'smooth'), k(1, 10, 'smooth'), k(2, 0, 'smooth')]
    for (let t = 1; t <= 2; t += 0.05) {
      expect(sampleKeys(peak, t)).toBeLessThanOrEqual(10 + 1e-9)
    }
  })

  it('keeps a derivative that matches a numeric estimate', () => {
    const numeric = (t: number): number => {
      const h = 1e-6
      return (sampleKeys(keys, t + h) - sampleKeys(keys, t - h)) / (2 * h)
    }
    for (const t of [0.4, 1.3, 2.6]) {
      expect(sampleKeysDerivative(keys, t)).toBeCloseTo(numeric(t), 4)
    }
  })

  it('has zero derivative at a local extremum', () => {
    const peak = [k(0, 0, 'smooth'), k(1, 10, 'smooth'), k(2, 0, 'smooth')]
    expect(Math.abs(sampleKeysDerivative(peak, 1))).toBeLessThan(0.05)
  })
})

describe('derivatives', () => {
  it('is the slope of a linear track', () => {
    expect(sampleKeysDerivative([k(0, 0), k(2, 10)], 1)).toBeCloseTo(5, 10)
  })

  it('is zero outside the key range', () => {
    expect(sampleKeysDerivative([k(1, 0), k(2, 10)], 0)).toBe(0)
    expect(sampleKeysDerivative([k(1, 0), k(2, 10)], 9)).toBe(0)
  })

  it('is zero for a single key', () => {
    expect(sampleKeysDerivative([k(1, 3)], 1)).toBe(0)
  })

  it('matches the slope of a linear bezier at its midpoint', () => {
    const keys = [k(0, 0, 'cubic-bezier(0, 0, 1, 1)'), k(1, 4, 'cubic-bezier(0, 0, 1, 1)')]
    expect(sampleKeysDerivative(keys, 0.5)).toBeCloseTo(4, 5)
  })
})
