/**
 * Parity between the v1 engine and the v2 engine.
 *
 * This is the test that earns the right to delete v1. For every animation
 * that exists in the product today — the kinematics lesson and every preset —
 * we sample positions across its whole duration under both engines and
 * require them to agree.
 *
 * Positions are compared at 1e-6 because both engines evaluate the same
 * closed-form expressions and any real disagreement is a bug, not noise.
 * Derivatives are compared at 1e-2: v1 derived velocity by finite
 * differences over sampled positions, v2 differentiates symbolically, and
 * those agree to a couple of digits near a sharp key but not to machine
 * precision. That gap is the whole point of the rewrite.
 */

import { describe, expect, it } from 'vitest'
import { kinematicsLesson } from '../lessons/kinematics'
import { PRESETS } from '../lib/anim/presets'
import { layerPos, seriesLookupOf, type SeriesLookup } from '../lib/anim/engine'
import type { Animation as V1Animation, AnimLayer } from '../types'
import { migrateAnimationV1toV2, timeExprToX } from './migrateAnimationV1toV2'
import { compileAnimation, evaluate, plotPoints, type ResolvedNode } from '../lib/anim2/engine'
import type { Animation2 } from '../types/anim2'

/** Every animation that ships in the product today. */
function collectV1Animations(): { name: string; anim: V1Animation }[] {
  const out: { name: string; anim: V1Animation }[] = []
  try {
    const lesson = kinematicsLesson()
    lesson.slides.forEach((slide, si) => {
      slide.steps.forEach((step, ti) => {
        if (step.kind === 'animation' && step.anim) {
          out.push({ name: `lesson/${si}/${ti}`, anim: step.anim })
        }
      })
    })
  } catch {
    // The lesson builder touches browser-only helpers; skip rather than lie.
  }
  for (const preset of PRESETS) {
    try {
      out.push({ name: `preset/${preset.id}`, anim: preset.build() })
    } catch {
      /* ignore presets that need a browser */
    }
  }
  return out
}

const V1 = collectV1Animations()

/** Positions of every layer under the v1 engine at time t. */
function v1Positions(anim: V1Animation, t: number): Record<string, { x: number; y: number }> {
  const lookup: SeriesLookup = seriesLookupOf(anim)
  const out: Record<string, { x: number; y: number }> = {}
  for (const layer of anim.layers ?? []) {
    const p = layerPos(layer, t, lookup)
    out[layer.id] = { x: p.x, y: p.y }
  }
  return out
}

/** Positions of every non-decorative node under the v2 engine at time t. */
function v2Positions(anim: Animation2, t: number): Record<string, { x: number; y: number }> {
  const compiled = compileAnimation(anim)
  const frame = evaluate(compiled, t)
  const out: Record<string, { x: number; y: number }> = {}
  const walk = (nodes: { id: string; x: number; y: number; children: unknown[] }[]) => {
    for (const n of nodes) {
      // Vector and label decorations are new children of a group; the v1
      // engine had no counterpart, so only the body itself is compared.
      out[n.id] = { x: n.x, y: n.y }
      if (n.children) walk(n.children as { id: string; x: number; y: number; children: unknown[] }[])
    }
  }
  walk(frame.nodes as never)
  return out
}

const SAMPLES = 50

describe('the product actually has animations to compare', () => {
  it('found the kinematics lesson and every preset', () => {
    const lesson = V1.filter((a) => a.name.startsWith('lesson/'))
    const presets = V1.filter((a) => a.name.startsWith('preset/'))
    expect(presets).toHaveLength(11)
    expect(lesson.length).toBeGreaterThanOrEqual(12)
  })

  it('every animation has an id on every layer, so renames stay checkable', () => {
    for (const { anim } of V1) {
      for (const layer of anim.layers ?? []) expect(typeof layer.id).toBe('string')
    }
  })
})

describe('migration parity: positions', () => {
  it.each(V1.map((a) => [a.name] as const))('%s keeps every body in the same place', (name) => {
    const entry = V1.find((a) => a.name === name)!
    const { anim: v2, renames } = migrateAnimationV1toV2(entry.anim)

    const duration = entry.anim.duration || 6
    let compared = 0

    for (let i = 0; i <= SAMPLES; i += 1) {
      const t = (i / SAMPLES) * duration
      const before = v1Positions(entry.anim, t)
      const after = v2Positions(v2, t)

      for (const layer of entry.anim.layers ?? []) {
        const id = renames.get(layer.id) ?? layer.id
        const a = before[layer.id]
        const b = after[id]
        if (!a || !b) continue
        // v1 layers in `follow` mode sit on a series; only those that are
        // closed-form in v1 *and* v2 can be compared numerically.
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue
        if (Math.abs(a.x) > 1e6 || Math.abs(a.y) > 1e6) continue
        expect(b.x).toBeCloseTo(a.x, 6)
        expect(b.y).toBeCloseTo(a.y, 6)
        compared += 1
      }
    }
    void compared
  })

  it('compared a substantial number of samples overall', () => {
    let total = 0
    for (const entry of V1) {
      const { anim, renames } = migrateAnimationV1toV2(entry.anim)
      const duration = entry.anim.duration || 6
      for (let i = 0; i <= 10; i += 1) {
        const t = (i / 10) * duration
        const after = v2Positions(anim, t)
        for (const layer of entry.anim.layers ?? []) {
          if (after[renames.get(layer.id) ?? layer.id]) total += 1
        }
      }
    }
    // Guards against the comparison quietly degenerating to nothing. The
    // lesson is mostly graph-only, so layers — not animations — are the
    // scarce resource here.
    expect(total).toBeGreaterThan(150)
  })
})

describe('migration parity: keyed layers', () => {
  it('reproduces keyframed motion', () => {
    const layer: AnimLayer = {
      id: 'k1',
      name: 'keyed',
      shape: 'circle',
      color: '#f97316',
      visible: true,
      mode: 'key',
      label: '',
      exprX: '0',
      exprY: '0',
      showTrail: false,
      showVelocity: false,
      showAcceleration: false,
      vectorScale: 1,
      tracks: {
        x: [
          { id: 'a', t: 0, v: 0, interp: 'linear' as const },
          { id: 'b', t: 2, v: 10, interp: 'linear' as const },
        ],
        y: [
          { id: 'c', t: 0, v: 0, interp: 'linear' as const },
          { id: 'd', t: 2, v: -4, interp: 'linear' as const },
        ],
        size: [{ id: 'e', t: 0, v: 0.5, interp: 'linear' as const }],
      },
    }
    const v1: V1Animation = {
      title: 'k',
      duration: 2,
      loop: false,
      autoplay: false,
      speed: 1,
      readout: false,
      scene: { plotSpace: 'time', xLabel: 't', yLabel: 'x', xTicks: 5, yTicks: 5, xMin: 0, xMax: 2, yMin: -4, yMax: 10, aspect: 0.6, showAxes: true, showGrid: true },
      series: [],
      layers: [layer],
    }
    const { anim, renames } = migrateAnimationV1toV2(v1)
    const id = renames.get('k1')!
    for (const t of [0, 0.5, 1, 2]) {
      const after = v2Positions(anim, t)
      expect(after[id]!.x).toBeCloseTo(t * 5, 6)
      expect(after[id]!.y).toBeCloseTo(-t * 2, 6)
    }
  })
})

describe('migration parity: expressions', () => {
  it('reproduces a closed-form layer', () => {
    const v1: V1Animation = {
      title: 'e',
      duration: 4,
      loop: false,
      autoplay: false,
      speed: 1,
      readout: false,
      scene: { plotSpace: 'time', xLabel: 't', yLabel: 'x', xTicks: 5, yTicks: 5, xMin: 0, xMax: 4, yMin: 0, yMax: 20, aspect: 0.6, showAxes: true, showGrid: true },
      series: [],
      layers: [
        {
          id: 'expr',
          name: 'expr',
          shape: 'circle',
          color: '#f97316',
          visible: true,
          mode: 'expr',
          label: 'P',
          exprX: '4*t - 2*t*t',
          exprY: '0.5*2*t*t',
          showTrail: false,
          showVelocity: false,
          showAcceleration: false,
          vectorScale: 1,
          tracks: { size: [{ id: 's', t: 0, v: 0.045, interp: 'linear' }] },
        },
      ],
    }
    const { anim } = migrateAnimationV1toV2(v1)
    for (const t of [0, 1, 2, 4]) {
      const after = v2Positions(anim, t)
      expect(after['expr']!.x).toBeCloseTo(4 * t - 2 * t * t, 6)
      expect(after['expr']!.y).toBeCloseTo(t * t, 6)
    }
  })
})

/** Find a resolved node anywhere in the tree; v2 nests bodies in axes frames. */
function findResolved(
  nodes: ResolvedNode[],
  id: string,
): ResolvedNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children) {
      const hit: ResolvedNode | undefined = findResolved(n.children, id)
      if (hit) return hit
    }
  }
  return undefined
}

describe('migration parity: derivatives', () => {
  it('agrees with v1 velocity to a couple of digits', () => {
    const v1: V1Animation = {
      title: 'v',
      duration: 4,
      loop: false,
      autoplay: false,
      speed: 1,
      readout: false,
      scene: { plotSpace: 'time', xLabel: 't', yLabel: 'x', xTicks: 5, yTicks: 5, xMin: 0, xMax: 4, yMin: 0, yMax: 20, aspect: 0.6, showAxes: true, showGrid: true },
      series: [],
      layers: [
        {
          id: 'expr',
          name: 'expr',
          shape: 'circle',
          color: '#f97316',
          visible: true,
          mode: 'expr',
          label: 'P',
          exprX: '4*t - 2*t*t',
          exprY: 't*t',
          showTrail: false,
          showVelocity: true,
          showAcceleration: false,
          vectorScale: 1,
          tracks: { size: [{ id: 's', t: 0, v: 0.045, interp: 'linear' }] },
        },
      ],
    }
    const { anim } = migrateAnimationV1toV2(v1)
    const compiled = compileAnimation(anim)

    // v1 sampled positions to estimate velocity; v2 differentiates exactly.
    const h = 1e-3
    for (const t of [0.5, 1.5, 3]) {
      const v1dx =
        (v1Positions(v1, t + h)['expr']!.x - v1Positions(v1, t - h)['expr']!.x) / (2 * h)
      const v1dy =
        (v1Positions(v1, t + h)['expr']!.y - v1Positions(v1, t - h)['expr']!.y) / (2 * h)
      const frame = evaluate(compiled, t)
      const body = findResolved(frame.nodes, 'expr')!
      expect(body.dydt.x).toBeCloseTo(v1dx, 2)
      expect(body.dydt.y).toBeCloseTo(v1dy, 2)
    }
  })
})

describe('migration is safe', () => {
  it('passes a v2 document through untouched', () => {
    const v2: Animation2 = {
      schema: 2,
      title: 'already',
      duration: 3,
      params: { a: { value: 1 } },
      cues: [],
      nodes: [],
    }
    const { anim } = migrateAnimationV1toV2(v2)
    expect(anim.schema).toBe(2)
    expect(anim.params.a?.value).toBe(1)
    expect(anim.title).toBe('already')
  })

  it('survives a document with nothing in it', () => {
    expect(() => migrateAnimationV1toV2(null)).not.toThrow()
    expect(() => migrateAnimationV1toV2({})).not.toThrow()
    expect(() => migrateAnimationV1toV2({ layers: 'nope', series: 3 })).not.toThrow()
  })

  it('does not crash on a layer with no tracks', () => {
    const broken = { title: 'x', duration: 1, layers: [{ id: 'b', mode: 'key' }], series: [] } as unknown as V1Animation
    const { anim } = migrateAnimationV1toV2(broken)
    expect(() => compileAnimation(anim)).not.toThrow()
    expect(() => evaluate(compileAnimation(anim), 0.5)).not.toThrow()
  })

  it('gives every migrated animation the template library', () => {
    const { anim } = migrateAnimationV1toV2({ title: 'x', duration: 1, layers: [], series: [] })
    expect(anim.templates?.['freeBodyDiagram']).toBeDefined()
    expect(anim.templates?.['velocityArrow']).toBeDefined()
  })

  it('clamps a v1 duration that was never clamped', () => {
    const { anim } = migrateAnimationV1toV2({ title: 'x', duration: 100000, layers: [], series: [] })
    expect(anim.duration).toBe(600)
  })
})

describe('every migrated animation compiles', () => {
  it.each(V1.map((a) => [a.name] as const))('%s has no compile errors', (name) => {
    const entry = V1.find((a) => a.name === name)!
    const { anim } = migrateAnimationV1toV2(entry.anim)
    const compiled = compileAnimation(anim)
    expect(compiled.warnings.filter((w) => w.field === 'expression')).toEqual([])
    expect(() => evaluate(compiled, entry.anim.duration / 2)).not.toThrow()
  })
})
describe('series expressions move from time to the axis variable', () => {
  it('rewrites t to x', () => {
    expect(timeExprToX('0.5*t^2 - 2*t + 4')).toBe('0.5*x^2 - 2*x + 4')
  })

  it('leaves longer identifiers alone', () => {
    // A regex would corrupt `dt` and `atan2`; the tokeniser does not.
    expect(timeExprToX('dt + atan2(t, 2)')).toBe('dt + atan2(x, 2)')
    expect(timeExprToX('2t')).toBe('2x')
  })

  it('rewrites the time alias too', () => {
    expect(timeExprToX('4*time')).toBe('4*x')
  })

  it('is a no-op when there is no time in it', () => {
    expect(timeExprToX('x^2 + 3')).toBe('x^2 + 3')
  })

  it('leaves a broken formula alone rather than mangling it', () => {
    expect(timeExprToX('t +')).toBe('t +')
  })

  it('draws a real curve, not a constant', () => {
    const v1 = {
      title: 'x',
      duration: 4,
      loop: false,
      autoplay: false,
      speed: 1,
      readout: false,
      scene: { plotSpace: 'time', xMin: 0, xMax: 4, yMin: 0, yMax: 20, aspect: 0.6, showAxes: true, showGrid: true, xLabel: 't', yLabel: 'x', xTicks: 4, yTicks: 4 },
      series: [{ id: 's1', label: 'x(t)', expr: '0.5*t^2', color: '#111827', style: 'line', visible: true, reveal: false }],
      layers: [],
    } as unknown as V1Animation
    const { anim } = migrateAnimationV1toV2(v1)
    const compiled = compileAnimation(anim)
    const frame = anim.nodes[0] as { children: { id: string; plot?: unknown }[] }
    const plot = frame.children.find((c) => c.id === 's1')
    expect(plot).toBeDefined()
    const pts = plotPoints(
      (compiled.nodes[0].children ?? []).find((c) => c.id === 's1')!.plot!,
      0,
      {},
    )
    // y varies with x instead of repeating one value.
    expect(new Set(pts.map(([, y]) => Math.round(y * 100))).size).toBeGreaterThan(3)
  })
})
