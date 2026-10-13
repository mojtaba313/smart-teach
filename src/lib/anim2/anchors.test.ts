import { describe, expect, it } from 'vitest'
import { ANIM2_SCHEMA, type Animation2 } from '../../types/anim2'
import { compileAnimation, evaluate } from './engine'
import { anchorNames, anchorToWorld, anchorsOf, MAX_ANCHORS, resolveAnchors, worldToAnchor } from './anchors'
import type { EvalEnv, Scope } from './expr'

const t = (o: Record<string, number> = {}) => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, ...o })
const env = (at = 0): EvalEnv => ({ t: at, lt: at, x: at, u: 0, duration: 10, v: {} })
const scope: Scope = { vars: new Set(['t']), refIds: new Set() }

describe('anchorToWorld', () => {
  it('passes the offset through when unrotated', () => {
    expect(anchorToWorld({ x: 10, y: 20, angle: 0, scaleX: 1, scaleY: 1 }, 0, -5)).toEqual({ x: 10, y: 15 })
  })

  it('rotates the offset counter-clockwise, matching the node', () => {
    // Local (0,-1) at 90° CCW lands to the +x side of the origin.
    const p = anchorToWorld({ x: 0, y: 0, angle: 90, scaleX: 1, scaleY: 1 }, 0, -1)
    expect(p.x).toBeCloseTo(1)
    expect(p.y).toBeCloseTo(0)
  })

  it('scales the offset before rotating it', () => {
    const p = anchorToWorld({ x: 0, y: 0, angle: 90, scaleX: 3, scaleY: 3 }, 0, -1)
    expect(p.x).toBeCloseTo(3)
    expect(p.y).toBeCloseTo(0)
  })

  it('round-trips through worldToAnchor', () => {
    const tf = { x: 30, y: -12, angle: 37, scaleX: 2, scaleY: 0.5 }
    const world = anchorToWorld(tf, 4, -6)
    const back = worldToAnchor(tf, world.x, world.y)
    expect(back.x).toBeCloseTo(4)
    expect(back.y).toBeCloseTo(-6)
  })

  it('survives a zero scale without dividing by zero', () => {
    const p = anchorToWorld({ x: 1, y: 1, angle: 0, scaleX: 0, scaleY: 0 }, 5, 5)
    expect(Number.isFinite(p.x)).toBe(true)
  })
})

describe('anchorsOf', () => {
  it('ignores a malformed table rather than throwing', () => {
    expect(anchorsOf({ anchors: undefined })).toEqual({})
    expect(anchorsOf({ anchors: {} as never })).toEqual({})
    expect(anchorsOf({ anchors: { bad: 1 } as never })).toEqual({})
  })

  it('keeps well-formed entries', () => {
    expect(anchorsOf({ anchors: { top: { x: 0, y: -1 } } })).toEqual({ top: { x: 0, y: -1 } })
  })
})

describe('resolveAnchors', () => {
  it('keys points by node and name', () => {
    const { points } = resolveAnchors(
      [{ id: 'body', transform: { x: 5, y: 6, angle: 0, scaleX: 1, scaleY: 1 }, anchors: { top: { x: 0, y: -2 }, left: { x: -3, y: 0 } } }],
      env(),
      scope,
    )
    expect(points.get('body@top')).toEqual({ x: 5, y: 4 })
    expect(points.get('body@left')).toEqual({ x: 2, y: 6 })
  })

  it('costs nothing for a node with no anchors', () => {
    const { points, warnings } = resolveAnchors(
      [{ id: 'n', transform: { x: 0, y: 0, angle: 0, scaleX: 1, scaleY: 1 }, anchors: {} }],
      env(),
      scope,
    )
    expect(points.size).toBe(0)
    expect(warnings).toEqual([])
  })

  it('truncates rather than allocating an unbounded table', () => {
    const many: Record<string, { x: number; y: number }> = {}
    for (let i = 0; i < MAX_ANCHORS + 10; i++) many[`a${i}`] = { x: i, y: 0 }
    const { points, warnings } = resolveAnchors(
      [{ id: 'n', transform: { x: 0, y: 0, angle: 0, scaleX: 1, scaleY: 1 }, anchors: many }],
      env(),
      scope,
    )
    expect(points.size).toBe(MAX_ANCHORS)
    expect(warnings[0].message).toContain(String(MAX_ANCHORS))
  })

  it('drops a non-finite anchor and says so', () => {
    const { points, warnings } = resolveAnchors(
      [{ id: 'n', transform: { x: 0, y: 0, angle: 0, scaleX: 1, scaleY: 1 }, anchors: { bad: { x: { expr: 'nope(' }, y: 0 } } }],
      env(),
      scope,
    )
    expect(warnings.length).toBe(1)
    // Dropped rather than placed at the origin, where it would look attached.
    expect(points.has('n@bad')).toBe(false)
  })
})

describe('anchorNames', () => {
  it('lists addressable names', () => {
    expect(
      anchorNames([
        { id: 'a', anchors: { top: { x: 0, y: 0 } } },
        { id: 'b', anchors: {} },
      ]),
    ).toEqual(['a@top'])
  })
})

describe('@node@anchor in expressions', () => {
  const anim = (rot: number, extra: Record<string, unknown> = {}): Animation2 =>
    ({
      schema: ANIM2_SCHEMA,
      title: 'a',
      duration: 10,
      params: {},
      cues: [],
      nodes: [
        {
          id: 'body',
          type: 'rect',
          w: 2,
          h: 2,
          transform: t({ x: 100, y: 50, rotation: rot }),
          anchors: { top: { x: 0, y: -1 } },
          ...extra,
        },
        { id: 'lbl', type: 'text', text: { expr: '@body@top.x' }, transform: t() },
      ],
    }) as unknown as Animation2

  it('reads the anchor position', () => {
    expect(evaluate(compileAnimation(anim(0)), 0).nodes.find((n) => n.id === 'lbl')?.text).toBe('100')
  })

  it('follows the node as it rotates', () => {
    expect(evaluate(compileAnimation(anim(90)), 0).nodes.find((n) => n.id === 'lbl')?.text).toBe('101')
  })

  it('works when the reader is declared before the owner', () => {
    const a: Animation2 = {
      schema: ANIM2_SCHEMA,
      title: 'a',
      duration: 10,
      params: {},
      cues: [],
      nodes: [
        { id: 'lbl', type: 'text', text: { expr: '@body@top.x' }, transform: t() },
        { id: 'body', type: 'rect', w: 2, h: 2, transform: t({ x: 100 }), anchors: { top: { x: 0, y: -1 } } },
      ],
    } as unknown as Animation2
    // Document order must not decide whether the reference resolves.
    expect(evaluate(compileAnimation(a), 0).nodes.find((n) => n.id === 'lbl')?.text).toBe('100')
  })

  it('reports an unknown anchor name instead of failing silently', () => {
    const a: Animation2 = {
      ...anim(0),
      nodes: [
        { id: 'body', type: 'rect', w: 2, h: 2, transform: t({ x: 100 }), anchors: { top: { x: 0, y: -1 } } },
        { id: 'lbl', type: 'text', text: { expr: '@body@nope.x' }, transform: t() },
      ],
    } as unknown as Animation2
    const c = compileAnimation(a)
    expect(c.warnings.some((w) => w.message.includes('@nope') || w.message.includes('نیست'))).toBe(true)
  })

  it('does not warn for a known anchor', () => {
    expect(compileAnimation(anim(0)).warnings).toEqual([])
  })

  it('feeds a force-length formula', () => {
    const a: Animation2 = {
      ...anim(0),
      nodes: [
        { id: 'body', type: 'rect', w: 2, h: 2, transform: t({ x: 100, y: 50 }), anchors: { top: { x: 0, y: -1 } } },
        { id: 'lbl', type: 'text', text: { expr: 'sqrt((@body@top.x - 0)^2 + (@body@top.y - 0)^2)' }, transform: t() },
      ],
    } as unknown as Animation2
    // sqrt(100^2 + 49^2) — the anchor sits at (100, 49) once rotated in.
    expect(evaluate(compileAnimation(a), 0).nodes.find((n) => n.id === 'lbl')?.text).toBe('111.36')
  })
})