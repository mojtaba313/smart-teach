import { describe, expect, it } from 'vitest'
import { emptyTransform, type Animation2, type Node } from '../../types/anim2'
import {
  buildRows,
  clampView,
  dedupeKeys,
  fullView,
  insertKey,
  moveKey,
  propFromEdit,
  removeKey,
  snapPointsOf,
  snapTime,
  timelineTicks,
  panBy,
  timeToX,
  xToTime,
  zoomAt,
} from './timeline'
import { animatedPaths, groupedProps, newNodeOfType, readPath, writePath } from './schema'

const T = () => emptyTransform()

const dot = (over: Partial<Node> = {}): Node =>
  ({ id: 'a', type: 'ellipse', transform: T(), ...over }) as Node

const doc = (nodes: Node[], over: Partial<Animation2> = {}): Animation2 => ({
  schema: 2,
  title: '',
  duration: 10,
  params: {},
  cues: [],
  nodes,
  ...over,
})

describe('time runs left to right', () => {
  it('maps the start of the view to the left edge', () => {
    const view = { start: 2, end: 6 }
    expect(timeToX(2, view, 400)).toBe(0)
    expect(timeToX(6, view, 400)).toBe(400)
    expect(timeToX(4, view, 400)).toBe(200)
  })

  it('round-trips through pixels', () => {
    const view = fullView(10)
    for (const t of [0, 1.5, 7.25, 10]) {
      expect(xToTime(timeToX(t, view, 640), view, 640)).toBeCloseTo(t, 9)
    }
  })

  it('never runs backwards even in an RTL interface', () => {
    // This is the assertion that matters: a later time is always further
    // right, whatever the surrounding layout does.
    const view = fullView(10)
    expect(timeToX(9, view, 500)).toBeGreaterThan(timeToX(1, view, 500))
  })
})

describe('zoom and pan', () => {
  it('zooms about a fixed anchor', () => {
    const before = fullView(10)
    const after = zoomAt(before, 5, 0.5, 10)
    expect(after.end - after.start).toBeCloseTo(5, 6)
    // The anchor stays put.
    expect(timeToX(5, before, 400)).toBeCloseTo(timeToX(5, after, 400), 6)
  })

  it('cannot zoom past the whole animation', () => {
    expect(zoomAt(fullView(10), 5, 1000, 10)).toEqual(fullView(10))
  })

  it('cannot zoom in past the minimum span', () => {
    const deep = zoomAt(fullView(10), 5, 0.0001, 10)
    expect(deep.end - deep.start).toBeGreaterThanOrEqual(0.1 - 1e-12)
  })

  it('cannot pan outside the animation', () => {
    expect(clampView({ start: -50, end: 0 }, 10).start).toBe(0)
    expect(clampView({ start: 8, end: 90 }, 10).end).toBe(10)
  })

  it('pans by pixels', () => {
    // Dragging a quarter of the width moves a quarter of the window. Panning
    // only means anything once zoomed in, so start from a narrow window.
    const panned = panBy({ start: 2, end: 6 }, 100, 400, 10)
    expect(panned.start).toBeCloseTo(3, 6)
    expect(panned.end).toBeCloseTo(7, 6)
  })

  it('does not pan off the end of the animation', () => {
    expect(panBy({ start: 0, end: 10 }, 9999, 400, 10).end).toBeCloseTo(10, 6)
  })
})

describe('snapping', () => {
  const points = { keys: [1, 2, 5], cues: [4], clips: [0, 10] }

  it('snaps to a cue before anything else', () => {
    expect(snapTime(4.05, points, 0.1)).toBe(4)
  })

  it('snaps to a key', () => {
    expect(snapTime(2.02, points, 0.1)).toBe(2)
  })

  it('snaps to a clip edge', () => {
    expect(snapTime(9.97, points, 0.1)).toBe(10)
  })

  it('leaves a time alone when nothing is close enough', () => {
    expect(snapTime(7.5, points, 0.1)).toBe(7.5)
  })

  it('can ignore the point being dragged', () => {
    // Dragging a key must not snap it to itself, or it appears stuck.
    expect(snapTime(2.02, points, 0.1, { keys: [2] })).toBeCloseTo(2.02, 9)
    expect(snapTime(1.98, points, 0.1, { keys: [2] })).toBeCloseTo(1.98, 9)
  })

  it('collects keys, cues and clips from the document', () => {
    const anim = doc([dot({ time: { start: 1, end: 3 } })], { cues: [{ t: 5, label: 'x' }] })
    const p = snapPointsOf(anim, anim.nodes)
    expect(p.clips).toContain(1)
    expect(p.cues).toContain(5)
  })
})

describe('rows', () => {
  const anim = doc([
    dot({
      id: 'a',
      name: 'body',
      transform: { ...T(), x: { keys: [{ id: 'k1', t: 1, v: 0 }, { id: 'k2', t: 3, v: 10 }] } },
      time: { start: 1, end: 8 },
    }),
    { id: 'still', type: 'rect', name: 'box', transform: T() } as Node,
  ])

  it('gives every node a row', () => {
    const rows = buildRows(anim, new Set())
    expect(rows.map((r) => r.nodeId)).toEqual(['a', 'still'])
  })

  it('finds only the properties that are actually animated', () => {
    const rows = buildRows(anim, new Set())
    expect(rows[0].kind).toBe('node')
    expect(animatedPaths(anim.nodes[0])).toEqual(['transform.x'])
    expect(animatedPaths(anim.nodes[1])).toEqual([])
  })

  it('adds property rows only for expanded nodes', () => {
    const collapsed = buildRows(anim, new Set())
    expect(collapsed).toHaveLength(2)

    const open = buildRows(anim, new Set(['a']))
    expect(open).toHaveLength(3)
    expect(open[1].path).toBe('transform.x')
    expect(open[1].depth).toBe(1)
  })

  it('carries the clip window onto the node row', () => {
    const [row] = buildRows(anim, new Set())
    expect(row.start).toBe(1)
    expect(row.end).toBe(8)
  })

  it('marks a formula row rather than pretending it has keys', () => {
    const a = doc([dot({ transform: { ...T(), y: { expr: 't*2' } } })])
    const rows = buildRows(a, new Set(['a']))
    expect(rows[1].formula).toBe(true)
    expect(rows[1].keys).toEqual([])
  })

  it('descends into groups', () => {
    const g = doc([
      {
        id: 'g',
        type: 'group',
        transform: T(),
        children: [dot({ id: 'inner' })],
      } as Node,
    ])
    const rows = buildRows(g, new Set())
    expect(rows.map((r) => r.nodeId)).toEqual(['g', 'inner'])
    expect(rows[1].depth).toBe(1)
  })
})

describe('ticks', () => {
  it('produces round times inside the view', () => {
    const t = timelineTicks({ start: 0, end: 10 }, 600)
    expect(t[0]).toBe(0)
    expect(t.every((v) => v >= 0 && v <= 10)).toBe(true)
  })

  it('stays inside a zoomed window', () => {
    const t = timelineTicks({ start: 4, end: 5 }, 600)
    expect(t.every((v) => v >= 4 && v <= 5)).toBe(true)
  })

  it('cannot spin the browser on a pathological span', () => {
    expect(timelineTicks({ start: 0, end: 1e9 }, 100).length).toBeLessThanOrEqual(200)
  })
})

describe('key editing', () => {
  const base = [
    { id: 'a', t: 0, v: 0 },
    { id: 'b', t: 2, v: 5 },
  ]

  it('updates an existing key rather than stacking a duplicate', () => {
    const next = insertKey(base, 2, 9, 'c')
    expect(next).toHaveLength(2)
    expect(next.find((k) => k.t === 2)?.v).toBe(9)
  })

  it('inserts a new key in time order', () => {
    const next = insertKey(base, 1, 3, 'c')
    expect(next.map((k) => k.t)).toEqual([0, 1, 2])
  })

  it('moves a key without losing its id', () => {
    const next = moveKey(base, 'b', 3)
    expect(next.find((k) => k.id === 'b')?.t).toBe(3)
  })

  it('removes by id', () => {
    expect(removeKey(base, 'a')).toHaveLength(1)
  })

  it('never produces two keys with the same id', () => {
    const fixed = dedupeKeys([
      { id: 'x', t: 0, v: 0 },
      { id: 'x', t: 1, v: 1 },
      { id: 'x', t: 2, v: 2 },
    ])
    expect(new Set(fixed.map((k) => k.id)).size).toBe(3)
  })
})

describe('prop construction', () => {
  it('builds each mode', () => {
    expect(propFromEdit({ kind: 'const', value: 3 })).toBe(3)
    expect(propFromEdit({ kind: 'expr', expr: 't' })).toEqual({ expr: 't' })
    expect(propFromEdit({ kind: 'keys', keys: [{ id: 'a', t: 0, v: 1 }] })).toEqual({
      keys: [{ id: 'a', t: 0, v: 1 }],
    })
  })

  it('substitutes zero for a value that is not a number', () => {
    expect(propFromEdit({ kind: 'const', value: NaN })).toBe(0)
  })
})

describe('property schema', () => {
  it('groups every property under a heading, in a stable order', () => {
    const groups = groupedProps('ellipse')
    expect(groups.map((g) => g.group)).toEqual(['هویت', 'حرکت', 'شکل', 'ظاهر', 'زمان'])
  })

  it('covers the transform for every node type', () => {
    for (const type of ['rect', 'ellipse', 'line', 'text', 'plot', 'group', 'use'] as const) {
      const paths = groupedProps(type).flatMap((g) => g.props.map((p) => p.path))
      expect(paths).toContain('transform.x')
      expect(paths).toContain('style.trim')
    }
  })

  it('reads and writes a dotted path without touching the original', () => {
    const node = dot({ transform: { ...T(), x: 1 } })
    expect(readPath(node, 'transform.x')).toBe(1)
    const next = writePath(node, 'transform.x', 5)
    expect(readPath(next, 'transform.x')).toBe(5)
    expect(readPath(node, 'transform.x')).toBe(1)
  })

  it('creates the objects a deep path needs', () => {
    const next = writePath(dot(), 'style.stroke', '#f00')
    expect(readPath(next, 'style.stroke')).toBe('#f00')
  })

  it('makes a node that compiles', () => {
    for (const type of ['rect', 'ellipse', 'line', 'text', 'plot', 'group'] as const) {
      const node = newNodeOfType(type, 'x1')
      expect(node.type).toBe(type)
      expect(node.transform.scaleX).toBe(1)
    }
  })
})