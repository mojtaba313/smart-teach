import { describe, expect, it } from 'vitest'
import { ANIM2_SCHEMA, type Key, type Node } from '../../types/anim2'
import {
  EASES,
  collectIds,
  commonParent,
  copySelection,
  deleteSelection,
  formatBezier,
  moveWindow,
  parseBezier,
  pasteClipboard,
  reid,
  reorder,
  resizeWindow,
  selectAll,
  shiftKeys,
  toggleSelection,
} from './studio'

/** The engine's own ease names, which parity requires us to keep. */
const EASE_NAMES = new Set<string>(['linear', 'ease', 'easeIn', 'easeOut', 'hold', 'smooth'])
const t = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }
const rect = (id: string, over: Partial<Node> = {}): Node =>
  ({ id, type: 'rect', w: 1, h: 1, transform: { ...t }, ...over }) as Node
const group = (id: string, children: Node[]): Node =>
  ({ id, type: 'group', transform: { ...t }, children }) as Node

describe('selection', () => {
  it('replaces without a modifier and toggles with one', () => {
    expect(toggleSelection(['a'], 'b', false)).toEqual(['b'])
    expect(toggleSelection(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(toggleSelection(['a', 'b'], 'a', true)).toEqual(['b'])
  })

  it('selects every top-level node', () => {
    expect(selectAll([rect('a'), rect('b')])).toEqual(['a', 'b'])
  })

  it('finds the nearest common ancestor', () => {
    const tree = [group('g1', [group('g2', [rect('a'), rect('b')])]), rect('c')]
    expect(commonParent(tree, ['a', 'b'])?.id).toBe('g2')
    expect(commonParent(tree, ['a', 'c'])).toBeNull()
  })
})

describe('reid', () => {
  it('gives a pasted subtree fresh ids against the document', () => {
    const src = group('g', [rect('a'), rect('b')])
    // Ids are minted against what is already there, so the copy only moves.
    const copy = reid(src, collectIds([src]))
    expect(copy.id).not.toBe('g')
    const children = (copy as { children: Node[] }).children
    expect(children.map((c) => c.id)).not.toContain('a')
    expect(new Set([copy.id, ...children.map((c) => c.id)]).size).toBe(3)
  })

  it('leaves the original untouched', () => {
    const src = rect('a')
    reid(src, collectIds([src]))
    expect(src.id).toBe('a')
  })

  it('keeps a name that is free', () => {
    expect(reid(rect('a'), new Set()).id).toBe('a')
  })
})

describe('clipboard', () => {
  it('copies and pastes at the root', () => {
    const tree = [rect('a')]
    const clip = copySelection(tree, ['a'], 0)
    expect(clip).not.toBeNull()
    const out = pasteClipboard(tree, clip!)
    expect(out.nodes).toHaveLength(2)
    expect(out.ids[0]).not.toBe('a')
  })

  it('pastes twice without colliding', () => {
    const tree = [rect('a')]
    const clip = copySelection(tree, ['a'], 0)!
    const once = pasteClipboard(tree, clip)
    const twice = pasteClipboard(once.nodes, clip)
    const ids = twice.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(twice.nodes).toHaveLength(3)
  })

  it('does not duplicate a child whose parent is also selected', () => {
    const tree = [group('g', [rect('a')])]
    const clip = copySelection(tree, ['g', 'a'], 0)!
    expect(clip.nodes).toHaveLength(1)
    expect(clip.nodes[0].id).toBe('g')
  })

  it('refuses nothing but silently yields no ids past the node cap', () => {
    const clip = { nodes: [rect('a')], parents: [null], at: 0 }
    const out = pasteClipboard(clip.nodes, clip)
    expect(out.ids).toHaveLength(1)
  })

  it('returns null for an empty selection', () => {
    expect(copySelection([rect('a')], [], 0)).toBeNull()
  })
})

describe('deleteSelection', () => {
  it('removes a child and its parent together', () => {
    const tree = [group('g', [rect('a'), rect('b')]), rect('c')]
    const out = deleteSelection(tree, ['g', 'a'])
    expect(out.nodes.map((n) => n.id)).toEqual(['c'])
    expect(out.removed).toHaveLength(2)
  })

  it('keeps a parent when only the child goes', () => {
    const tree = [group('g', [rect('a'), rect('b')])]
    const out = deleteSelection(tree, ['a'])
    expect((out.nodes[0] as { children: Node[] }).children.map((n) => n.id)).toEqual(['b'])
  })

  it('ignores an id that is not there', () => {
    const out = deleteSelection([rect('a')], ['zzz'])
    expect(out.nodes).toHaveLength(1)
  })
})

describe('collectIds', () => {
  it('walks into groups', () => {
    expect([...collectIds([group('g', [rect('a')])])].sort()).toEqual(['a', 'g'])
  })
})

describe('time windows', () => {
  it('moves a window and keeps its length', () => {
    expect(moveWindow({ start: 1, end: 3 }, 2, 10)).toEqual({ start: 3, end: 5 })
  })

  it('clamps at the start rather than running off', () => {
    expect(moveWindow({ start: 1, end: 3 }, -5, 10)).toEqual({ start: 0, end: 2 })
  })

  it('clamps at the end by the window length, not the start', () => {
    expect(moveWindow({ start: 1, end: 3 }, 50, 10)).toEqual({ start: 8, end: 10 })
  })

  it('treats a missing window as the whole timeline', () => {
    expect(moveWindow(undefined, 0, 10)).toEqual({ start: 0, end: 10 })
  })

  it('resizes one edge while holding the other', () => {
    expect(resizeWindow({ start: 1, end: 3 }, 'start', 2, 10)).toEqual({ start: 2, end: 3 })
    expect(resizeWindow({ start: 1, end: 3 }, 'end', 5, 10)).toEqual({ start: 1, end: 5 })
  })

  it('never lets the edges cross', () => {
    expect(resizeWindow({ start: 1, end: 3 }, 'start', 9, 10)).toEqual({ start: 3, end: 3 })
    expect(resizeWindow({ start: 1, end: 3 }, 'end', -5, 10)).toEqual({ start: 1, end: 1 })
  })
})

describe('easing', () => {
  it('parses a cubic-bezier', () => {
    expect(parseBezier('cubic-bezier(0.4, 0, 0.2, 1)')).toEqual([0.4, 0, 0.2, 1])
  })

  it('rejects x outside 0..1', () => {
    expect(parseBezier('cubic-bezier(1.4, 0, 0.2, 1)')).toBeNull()
    expect(parseBezier('cubic-bezier(-0.2, 0, 0.2, 1)')).toBeNull()
  })

  it('allows y outside 0..1, which is how an overshoot is written', () => {
    expect(parseBezier('cubic-bezier(0.34, 1.56, 0.64, 1)')).toEqual([0.34, 1.56, 0.64, 1])
  })

  it('rejects nonsense', () => {
    expect(parseBezier('linear')).toBeNull()
    expect(parseBezier('cubic-bezier(a, b, c, d)')).toBeNull()
    expect(parseBezier(undefined)).toBeNull()
  })

  it('round-trips through format', () => {
    const b: [number, number, number, number] = [0.34, 1.56, 0.64, 1]
    expect(parseBezier(formatBezier(b))).toEqual(b)
  })

  it('offers only easings the engine can evaluate', () => {
    for (const e of EASES) {
      const named = EASE_NAMES.has(e.name)
      const bezier = parseBezier(e.name) !== null
      expect(named || bezier).toBe(true)
      expect(e.p1[0]).toBeGreaterThanOrEqual(0)
      expect(e.p1[0]).toBeLessThanOrEqual(1)
      expect(e.p2[0]).toBeGreaterThanOrEqual(0)
      expect(e.p2[0]).toBeLessThanOrEqual(1)
    }
  })

  it('keeps the v1 names verbatim, because parity beat taste', () => {
    // These are quadratic, not CSS cubic. Renaming them would change the speed
    // of every animation already in the product.
    for (const n of ['linear', 'ease', 'easeIn', 'easeOut', 'hold']) {
      expect(EASE_NAMES.has(n)).toBe(true)
    }
  })
})

describe('shiftKeys', () => {
  const keys: Key[] = [{ id: 'a', t: 1, v: 0 }, { id: 'b', t: 3, v: 1 }]

  it('moves every key together', () => {
    expect(shiftKeys(keys, 1, 0, 10).map((k) => k.t)).toEqual([2, 4])
  })

  it('drops keys pushed outside the window', () => {
    expect(shiftKeys(keys, 10, 0, 10).map((k) => k.t)).toEqual([])
  })

  it('keeps them ordered', () => {
    expect(shiftKeys([{ id: 'b', t: 3, v: 1 }, { id: 'a', t: 1, v: 0 }], 0, 0, 10).map((k) => k.t)).toEqual([1, 3])
  })
})

describe('reorder', () => {
  it('moves an item and leaves everything else in order', () => {
    expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op for a same-place or out-of-range move', () => {
    expect(reorder(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(reorder(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })
})

describe('schema constant', () => {
  it('is still v2 — none of this needs a version bump', () => {
    expect(ANIM2_SCHEMA).toBe(2)
  })
})