import { describe, expect, it } from 'vitest'
import type { Animation2 } from '../../types/anim2'
import { ANIM2_SCHEMA } from '../../types/anim2'
import { compileAnimation, resolveDrawingLayer, valueOf } from './engine'
import {
  arcPoint,
  arcTangent,
  dimensionGeometry,
  distance,
  drawingText,
  normal,
  protractorTicks,
  resolveDrawings,
  sweepDeg,
} from './drawings'
import type { EvalEnv, Scope } from './expr'

const scope: Scope = { vars: new Set(['t', 'lt', 'x', 'u', 'q1', 'F']), refIds: new Set() }
const env = (t: number, v: Record<string, number> = {}): EvalEnv => ({
  t,
  lt: t,
  x: t,
  u: 0,
  duration: 10,
  v: { q1: 2, F: 9.8, ...v },
})

describe('drawing geometry', () => {
  it('passes through the endpoints of a straight arrow', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }
    expect(arcPoint(a, b, 0, 0)).toEqual(a)
    expect(arcPoint(a, b, 0, 1)).toEqual(b)
  })

  it('bows the midpoint perpendicular to the chord', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }
    // A positive sag pushes left of travel, which is up on a y-up plot.
    expect(arcPoint(a, b, 2, 0.5)).toEqual({ x: 5, y: 2 })
    expect(arcPoint(a, b, -2, 0.5)).toEqual({ x: 5, y: -2 })
  })

  it('aims the end tangent along the curve, not the chord', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }
    const t = arcTangent(a, b, 4, 1)
    expect(t.x).toBeGreaterThan(0)
    expect(t.y).toBeLessThan(0)
  })

  it('degrades gracefully when the endpoints coincide', () => {
    const p = { x: 3, y: 4 }
    expect(Number.isFinite(arcPoint(p, p, 5).x)).toBe(true)
    expect(arcTangent(p, p, 5)).toEqual({ x: 1, y: 0 })
  })

  it('gives a left-hand normal for a rightward span', () => {
    expect(normal({ x: 0, y: 0 }, { x: 4, y: 0 })).toEqual({ x: 0, y: 1 })
  })

  it('offsets both witness lines by the same amount', () => {
    const g = dimensionGeometry({ x: 0, y: 0 }, { x: 6, y: 0 }, 2)
    expect(g.measure[0]).toEqual({ x: 0, y: 2 })
    expect(g.measure[1]).toEqual({ x: 6, y: 2 })
    // Witnesses run past the arrow row, on the offset side.
    expect(g.witness[0]).toEqual({ x: 0, y: 2.5 })
    expect(g.witness[1]).toEqual({ x: 6, y: 2.5 })
  })

  it('takes the short way round the protractor', () => {
    expect(sweepDeg(0, 90)).toBe(90)
    expect(sweepDeg(350, 10)).toBe(20)
    expect(sweepDeg(10, 350)).toBe(-20)
    expect(sweepDeg(0, 450)).toBe(90)
  })

  it('spaces ticks by degree, marking the labelled ones', () => {
    const ticks = protractorTicks(0, 90, 30, 2)
    expect(ticks.map((k) => k.deg)).toEqual([0, 30, 60, 90])
    expect(ticks.filter((k) => k.label).map((k) => k.deg)).toEqual([0, 60])
    // Unit direction at 0° points along +x.
    expect(ticks[0].x).toBeCloseTo(1)
    expect(ticks[0].y).toBeCloseTo(0)
  })

  it('produces no ticks when the step is zero', () => {
    expect(protractorTicks(0, 90, 0, 6)).toEqual([])
  })
})

describe('resolveDrawings', () => {
  it('evaluates an arrow written in expressions', () => {
    const { resolved } = resolveDrawings(
      [
        {
          id: 'a1',
          kind: 'arrow',
          from: { x: 0, y: { expr: '0' } },
          to: { x: { expr: 'F' }, y: { expr: 't' } },
          curvature: 0.2,
        },
      ],
      env(3),
      scope,
    )
    expect(resolved[0].points.to).toEqual({ x: 9.8, y: 3 })
    expect(resolved[0].nums.curvature).toBeCloseTo(0.2)
    // Sag is a quarter of the chord per unit of curvature.
    const span = distance(resolved[0].points.from, resolved[0].points.to)
    expect(span).toBeGreaterThan(9)
  })

  it('warns instead of throwing on a zero-length arrow', () => {
    const { resolved, warnings } = resolveDrawings(
      [{ id: 'a', kind: 'arrow', from: { x: 1, y: 1 }, to: { x: 1, y: 1 } }],
      env(0),
      scope,
    )
    expect(resolved).toHaveLength(1)
    expect(warnings[0].drawingId).toBe('a')
  })

  it('survives one broken drawing and keeps the rest', () => {
    const { resolved, warnings } = resolveDrawings(
      [
        { id: 'bad', kind: 'arrow', from: { x: { expr: 'q1 +' }, y: 0 }, to: { x: 1, y: 0 } },
        { id: 'ok', kind: 'label', at: { x: 1, y: 1 }, text: 'ok' },
      ],
      env(0),
      scope,
    )
    expect(resolved.map((r) => r.id)).toEqual(['ok'])
    expect(warnings).toHaveLength(1)
  })

  it('resolves label text from keys and expressions', () => {
    expect(drawingText('ثابت', env(0), scope)).toBe('ثابت')
    expect(
      drawingText({ keys: [{ id: 'k1', t: 0, v: 'a' }, { id: 'k2', t: 5, v: 'b' }] }, env(6), scope),
    ).toBe('b')
    expect(drawingText({ expr: 'F' }, env(0), scope)).toBe('9.8')
    expect(drawingText({ expr: '2*pi' }, env(0), scope)).toBe('6.28')
  })
})

describe('drawings in a compiled animation', () => {
  const base: Animation2 = {
    schema: ANIM2_SCHEMA,
    title: 'd',
    duration: 10,
    params: { q1: { value: 2, min: 0, max: 5 } },
    vars: { F: 'q1 * 3' },
    cues: [],
    nodes: [],
  }

  it('reads scene vars inside a drawing', () => {
    const compiled = compileAnimation({
      ...base,
      drawings: [{ id: 'f', kind: 'arrow', from: { x: 0, y: 0 }, to: { x: { expr: 'F' }, y: 0 } }],
    })
    expect(valueOf(compiled, 0)['F']).toBe(6)
    const { resolved } = resolveDrawingLayer(compiled, 0)
    expect(resolved[0].points.to.x).toBe(6)
  })

  it('has no drawing layer when the field is absent', () => {
    expect(resolveDrawingLayer(compileAnimation(base), 0).resolved).toEqual([])
  })

  it('survives a drawing that names something out of scope', () => {
    const compiled = compileAnimation({
      ...base,
      drawings: [{ id: 'f', kind: 'label', at: { x: 0, y: 0 }, text: { expr: 'nosuchthing' } }],
    })
    // Reported as a warning, and the raw source stays visible in the label.
    const { resolved } = resolveDrawingLayer(compiled, 0)
    const label = resolved[0]
    expect(label.kind).toBe('label')
    expect(
      drawingText(
        label.kind === 'label' ? label.text : '',
        env(0),
        { vars: compiled.scope, refIds: compiled.refIds },
      ),
    ).toBe('nosuchthing')
  })
})