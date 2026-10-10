import { describe, expect, it } from 'vitest'
import type { Template } from '../../types/anim2'
import {
  type Animation2,
  type Node,
  emptyAnimation2,
  emptyTransform,
  uid,
} from '../../types/anim2'
import {
  compileAnimation,
  compilePath,
  evaluate,
  expandTemplates,
  findCycles,
  plotPoints,
  samplePath,
} from './engine'
import { BUILTIN_TEMPLATES, templateLibrary } from './templates'

const T = () => emptyTransform()

function anim(nodes: Node[], over: Partial<Animation2> = {}): Animation2 {
  return { ...emptyAnimation2('test'), nodes, ...over }
}

/** Depth-first list of every node in a compiled tree. */
function flat(nodes: { id: string; children?: unknown }[]): { id: string }[] {
  const out: { id: string }[] = []
  const walk = (list: { id: string; children?: unknown }[]) => {
    for (const n of list) {
      out.push(n)
      if (n.children) walk(n.children as { id: string; children?: unknown }[])
    }
  }
  walk(nodes)
  return out
}

describe('compile and evaluate', () => {
  it('resolves a constant transform', () => {
    const c = compileAnimation(
      anim([{ id: 'a', type: 'ellipse', transform: { ...T(), x: 5, y: 7 } }]),
    )
    const f = evaluate(c, 0)
    expect(f.nodes[0].x).toBe(5)
    expect(f.nodes[0].y).toBe(7)
  })

  it('resolves an expression at the current time', () => {
    const c = compileAnimation(
      anim([{ id: 'a', type: 'ellipse', transform: { ...T(), x: { expr: '4*t - 2*t*t' } } }]),
    )
    expect(evaluate(c, 3).nodes[0].x).toBe(-6)
  })

  it('samples keyed tracks and sorts keys first', () => {
    const c = compileAnimation(
      anim([
        {
          id: 'a',
          type: 'ellipse',
          transform: {
            ...T(),
            x: {
              keys: [
                { id: 'b', t: 2, v: 10 },
                { id: 'a', t: 0, v: 0 },
              ],
            },
          },
        },
      ]),
    )
    expect(evaluate(c, 1).nodes[0].x).toBe(5)
  })

  it('marks an animation with no time dependence as static', () => {
    const still = compileAnimation(
      anim([{ id: 'a', type: 'ellipse', transform: { ...T(), x: 3 } }]),
    )
    expect(still.static).toBe(true)

    const moving = compileAnimation(
      anim([{ id: 'a', type: 'ellipse', transform: { ...T(), x: { expr: 't' } } }]),
    )
    expect(moving.static).toBe(false)
  })

  it('treats an expression in the axis variable as static in time', () => {
    const curve = compileAnimation(anim([{ id: 'p', type: 'plot', transform: T(), expr: 'x^2' }]))
    expect(curve.static).toBe(true)
  })
})

describe('time windows', () => {
  it('marks a node live only inside its window', () => {
    const c = compileAnimation(
      anim([{ id: 'a', type: 'rect', transform: T(), time: { start: 1, end: 3 } }]),
    )
    expect(evaluate(c, 0.5).nodes[0].live).toBe(false)
    expect(evaluate(c, 2).nodes[0].live).toBe(true)
    expect(evaluate(c, 4).nodes[0].live).toBe(false)
  })

  it('gives lt that starts at zero on the node’s own clock', () => {
    const c = compileAnimation(
      anim([{ id: 'a', type: 'rect', transform: { ...T(), x: { expr: 'lt' } }, time: { start: 2 } }]),
    )
    expect(evaluate(c, 2).nodes[0].x).toBe(0)
    expect(evaluate(c, 5).nodes[0].x).toBe(3)
  })
})

describe('velocity', () => {
  it('is the exact symbolic derivative of a formula', () => {
    const c = compileAnimation(
      anim([{ id: 'a', type: 'ellipse', transform: { ...T(), x: { expr: '4*t - 2*t*t' } } }]),
    )
    expect(evaluate(c, 3).nodes[0].dydt.x).toBeCloseTo(4 - 12, 10)
  })

  it('is the exact slope of a keyed track', () => {
    const c = compileAnimation(
      anim([
        {
          id: 'a',
          type: 'ellipse',
          transform: { ...T(), x: { keys: [{ id: 'k1', t: 0, v: 0 }, { id: 'k2', t: 2, v: 10 }] } },
        },
      ]),
    )
    expect(evaluate(c, 1).nodes[0].dydt.x).toBeCloseTo(5, 10)
  })

  it('is zero for a body that cannot move', () => {
    const c = compileAnimation(anim([{ id: 'a', type: 'ellipse', transform: { ...T(), x: 4 } }]))
    expect(evaluate(c, 1).nodes[0].dydt.x).toBe(0)
  })
})

describe('references', () => {
  it('reads another node’s position', () => {
    const c = compileAnimation(
      anim([
        { id: 'body', type: 'ellipse', transform: { ...T(), x: { expr: '2*t' }, y: 0 } },
        { id: 'follower', type: 'rect', transform: { ...T(), x: { expr: '@body.x + 1' }, y: 0 } },
      ]),
    )
    const f = evaluate(c, 3)
    const ids = f.nodes.map((n) => n.id)
    // the reference is resolved first, so a follower is never a frame behind
    expect(f.nodes[ids.indexOf('body')!].x).toBe(6)
    expect(f.nodes[ids.indexOf('follower')!].x).toBe(7)
  })

  it('sorts referenced nodes before the nodes that read them', () => {
    const c = compileAnimation(
      anim([
        { id: 'reader', type: 'rect', transform: { ...T(), x: { expr: '@target.x' } } },
        { id: 'target', type: 'ellipse', transform: { ...T(), x: 9 } },
      ]),
    )
    expect(c.order.indexOf('target')).toBeLessThan(c.order.indexOf('reader'))
  })

  it('detects a reference cycle and neutralises it', () => {
    const c = compileAnimation(
      anim([
        { id: 'a', type: 'rect', transform: { ...T(), x: { expr: '@b.x + 1' } } },
        { id: 'b', type: 'rect', transform: { ...T(), x: { expr: '@a.x + 1' } } },
      ]),
    )
    expect(c.cyclic.has('a')).toBe(true)
    expect(c.cyclic.has('b')).toBe(true)
    // the frame still renders; the cyclic parts simply read as zero
    expect(() => evaluate(c, 1)).not.toThrow()
    expect(c.warnings.some((w) => w.field === 'refs')).toBe(true)
  })

  it('differentiates through a reference by central difference', () => {
    const c = compileAnimation(
      anim([
        { id: 'body', type: 'ellipse', transform: { ...T(), x: { expr: 't*t' } } },
        { id: 'arrow', type: 'line', transform: T(), length: { expr: 'd(@body.x)' } },
      ]),
    )
    expect(evaluate(c, 3).nodes.find((n) => n.id === 'arrow')!.shape.length).toBeCloseTo(6, 3)
  })
})

describe('motion paths', () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]

  it('travels at constant arc length, not constant parameter', () => {
    const path = compilePath(square, true)
    // half way along a square perimeter is the middle of the top-right corner
    const mid = samplePath(path, 0.5)
    expect(mid[0]).toBeCloseTo(10, 6)
    expect(mid[1]).toBeCloseTo(10, 6)
  })

  it('has non-zero velocity at a corner rather than stalling', () => {
    // The v1 bug: dropping `duration` made bodies stop dead at path vertices.
    const c = compileAnimation(
      anim([
        {
          id: 'mover',
          type: 'ellipse',
          transform: T(),
          time: { start: 0, end: 10 },
          motionPath: { points: square, closed: true, progress: { expr: 't / 10' } },
        },
      ]),
    )
    const at = (t: number) => evaluate(c, t).nodes[0]
    expect(Math.hypot(at(0.1).x - at(0).x, at(0.1).y - at(0).y)).toBeGreaterThan(0)
    // and it keeps moving right through the corner at t = 2.5
    expect(at(2.6).x).not.toBeCloseTo(at(2.4).x, 6)
  })

  /**
   * No spline *is* a circle. What centripetal Catmull-Rom guarantees is that
   * the curve passes through every point and never cusps or spirals, so the
   * error converges as vertices are added. Uniform Catmull-Rom, which v1
   * effectively used, drifted 0.08% at eight vertices and bulged visibly at
   * six. These numbers are the measured ones, and they are the promise.
   */
  const ring = (n: number): [number, number][] => {
    const out: [number, number][] = []
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2
      out.push([10 * Math.cos(a), 10 * Math.sin(a)])
    }
    return out
  }
  const worstError = (n: number): number => {
    const path = compilePath(ring(n), true, true)
    let worst = 0
    for (const [x, y] of path.points) worst = Math.max(worst, Math.abs(Math.hypot(x, y) - 10))
    return worst / 10
  }

  it('keeps a smoothed circle close to a circle, converging with vertices', () => {
    expect(worstError(8)).toBeLessThan(0.01)
    expect(worstError(16)).toBeLessThan(0.001)
    expect(worstError(24)).toBeLessThan(0.0005)
  })

  it('passes exactly through every vertex of a smoothed path', () => {
    const points: [number, number][] = [
      [0, 0],
      [30, 10],
      [40, 40],
      [10, 50],
    ]
    const path = compilePath(points, false, true)
    for (const [px, py] of points) {
      const near = path.points.some(([x, y]) => Math.hypot(x - px, y - py) < 1e-6)
      expect(near).toBe(true)
    }
  })

  it('is safe when the path is a single point', () => {
    expect(samplePath(compilePath([[1, 1]], false), 0.5)).toEqual([1, 1])
  })
})

describe('plots', () => {
  it('samples an expression in x', () => {
    const c = compileAnimation(anim([{ id: 'p', type: 'plot', transform: T(), expr: 'x^2', domain: [0, 2], samples: 3 }]))
    const pts = plotPoints(c.nodes[0].plot!, 0, {})
    expect(pts).toHaveLength(3)
    expect(pts[2]![1]).toBeCloseTo(4, 9)
  })

  it('is resolvable as @id.at(x)', () => {
    const c = compileAnimation(
      anim([
        { id: 'curve', type: 'plot', transform: T(), expr: 'x^2' },
        { id: 'dot', type: 'ellipse', transform: { ...T(), y: { expr: '@curve.at(x)' } } },
      ]),
    )
    expect(evaluate(c, 2).nodes.find((n) => n.id === 'dot')!.y).toBeCloseTo(4, 9)
  })

  it('skips non-finite samples instead of drawing a line to nowhere', () => {
    const c = compileAnimation(
      anim([{ id: 'p', type: 'plot', transform: T(), expr: '1/(x - 1)', domain: [0, 2], samples: 21 }]),
    )
    const pts = plotPoints(c.nodes[0].plot!, 0, {})
    expect(pts.every(([, y]) => Number.isFinite(y))).toBe(true)
    expect(pts.length).toBeLessThan(21)
  })

  it('caps samples at the import limit', () => {
    const c = compileAnimation(anim([{ id: 'p', type: 'plot', transform: T(), expr: 'x', samples: 99999 }]))
    expect(c.nodes[0].plot!.samples).toBe(2000)
  })
})

describe('templates', () => {
  it('expands a use node into the template subtree', () => {
    const a = anim(
      [{ id: 'u', type: 'use', transform: T(), template: 'freeBodyDiagram' }],
      { templates: templateLibrary(), params: { theta: { value: 30 }, mass: { value: 2 }, g: { value: 10 }, friction: { value: 0 } } },
    )
    const { nodes } = expandTemplates(a)
    const group = nodes[0]
    expect(group.type).toBe('group')
    expect('children' in group && group.children.length).toBeGreaterThan(1)
  })

  it('is deterministic', () => {
    const a = anim([{ id: 'u', type: 'use', transform: T(), template: 'springOrBlock' }], {
      templates: templateLibrary(),
    })
    const one = JSON.stringify(expandTemplates(a))
    const two = JSON.stringify(expandTemplates(a))
    expect(one).toBe(two)
  })

  it('reports a missing template instead of crashing', () => {
    const a = anim([{ id: 'u', type: 'use', transform: T(), template: 'nope' }])
    const { nodes, warnings } = expandTemplates(a)
    expect(nodes).toHaveLength(0)
    expect(warnings[0].message).toContain('پیدا نشد')
  })

  it('refuses to expand a template that includes itself', () => {
    const selfReferencing: Template = { id: 'loop', name: 'loop', nodes: [{ id: 'inner', type: 'use' as const, transform: T(), template: 'loop' }] }
    const a = anim([{ id: 'u', type: 'use', transform: T(), template: 'loop' }], {
      templates: { loop: selfReferencing },
    })
    const { warnings } = expandTemplates(a)
    expect(warnings.some((w) => w.message.includes('خودش'))).toBe(true)
  })

  it('lets a use node override the instance transform', () => {
    const a = anim(
      [
        {
          id: 'u',
          type: 'use',
          transform: { ...T(), x: 50 },
          template: 'springOrBlock',
          props: { y: { expr: '5*t' } },
        },
      ],
      { templates: templateLibrary() },
    )
    const { nodes } = expandTemplates(a)
    const child = (nodes[0] as Extract<Node, { type: 'group' }>).children[2]!
    expect((child.transform as unknown as Record<string, unknown>).y).toEqual({ expr: '5*t' })
  })

  it('every built-in template compiles without a warning', () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      const c = compileAnimation(anim(tpl.nodes.map((n) => n), { templates: templateLibrary() }))
      expect(c.warnings.filter((w) => w.nodeId !== 'animation')).toEqual([])
    }
  })
})

describe('robustness', () => {
  it('never throws on a broken formula', () => {
    const c = compileAnimation(
      anim([{ id: 'a', type: 'ellipse', transform: { ...T(), x: { expr: 'notAName + 1' } } }]),
    )
    expect(() => evaluate(c, 1)).not.toThrow()
    expect(c.warnings.length).toBeGreaterThan(0)
  })

  it('clamps an absurd duration', () => {
    expect(compileAnimation(anim([], { duration: 1e9 })).duration).toBe(600)
    expect(compileAnimation(anim([], { duration: 0 })).duration).toBe(0.2)
  })

  it('survives a layer with no tracks and no transform values', () => {
    const c = compileAnimation(anim([{ id: 'a', type: 'rect' } as unknown as Node]))
    expect(() => evaluate(c, 1)).not.toThrow()
  })

  it('warns about duplicate key ids within one track', () => {
    const c = compileAnimation(
      anim([
        {
          id: 'a',
          type: 'ellipse',
          transform: {
            ...T(),
            x: {
              keys: [
                { id: 'same', t: 0, v: 0 },
                { id: 'same', t: 1, v: 1 },
              ],
            },
          },
        },
      ]),
    )
    expect(c.warnings.some((w) => w.message.includes('تکراری'))).toBe(true)
  })

  it('rejects a key id that the v1 scheme would have collided on', () => {
    // v1 derived ids from t and |v|, so returning to a pose collided.
    const c = compileAnimation(
      anim([
        {
          id: 'a',
          type: 'ellipse',
          transform: {
            ...T(),
            x: {
              keys: [
                { id: uid('k'), t: 0, v: 1 },
                { id: uid('k'), t: 1, v: 0 },
                { id: uid('k'), t: 2, v: 1 },
              ],
            },
          },
        },
      ]),
    )
    const f = evaluate(c, 0.5)
    expect(f.nodes[0].x).toBeCloseTo(0.5, 9)
  })
})

describe('references and ordering on a real scene', () => {
  it('keeps a nested hierarchy addressable', () => {
    const c = compileAnimation(
      anim([
        {
          id: 'outer',
          type: 'group',
          transform: T(),
          children: [
            {
              id: 'inner',
              type: 'group',
              transform: T(),
              children: [{ id: 'leaf', type: 'ellipse', transform: { ...T(), x: 2 } }],
            },
          ],
        },
      ]),
    )
    expect(flat(c.nodes).map((n) => n.id)).toContain('leaf')
  })

  it('findCycles is empty for an acyclic scene', () => {
    const c = compileAnimation(
      anim([
        { id: 'a', type: 'rect', transform: { ...T(), x: { expr: '@b.x' } } },
        { id: 'b', type: 'rect', transform: { ...T(), x: 1 } },
      ]),
    )
    expect(findCycles(c.nodes).size).toBe(0)
  })
})