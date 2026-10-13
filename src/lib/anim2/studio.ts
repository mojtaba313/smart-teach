/**
 * Editing operations that are shared by every studio surface.
 *
 * These live apart from the screens on purpose. A clipboard copy, a duplicated
 * node and a dragged clip all have to agree about id remapping, undo grouping
 * and time clamping; when each screen grew its own version, they quietly
 * diverged and the studio gained "works if you paste once, corrupts if you
 * paste twice" behaviour.
 */

import type { Key, Node } from '../../types/anim2'
import { LIMITS, uid } from '../../types/anim2'


/** Find a node anywhere in the tree; bodies live inside axes frames. */
export function findNode(nodes: readonly Node[], id: string): Node | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.type === 'group' || n.type === 'axes') {
      const hit = findNode(n.children ?? [], id)
      if (hit) return hit
    }
  }
  return undefined
}

/* ------------------------------------------------------------------ *
 *  Multi-select
 * ------------------------------------------------------------------ */

/**
 * Selection as an ordered list, with the most recent last.
 *
 * Order matters: a copy pastes in the order shown, and a delete removes in the
 * reverse so that removing a child never orphans the parent it depends on.
 */
/** Renamed from `Selection`: the DOM lib exports a global by that name. */
export type SelIds = string[]

export function toggleSelection(current: SelIds, id: string, additive: boolean): SelIds {
  if (!additive) return [id]
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
}

export function selectAll(nodes: readonly Node[]): SelIds {
  return nodes.map((n) => n.id)
}

export function isSelected(sel: SelIds, id: string): boolean {
  return sel.includes(id)
}

/** Nearest common ancestor, so grouping a mixed selection has one parent. */
export function commonParent(nodes: readonly Node[], sel: SelIds): Node | null {
  if (sel.length === 0) return null
  const paths = sel.map((id) => pathTo(nodes, id))
  if (paths.some((p) => !p)) return null
  const first = paths[0]!
  // `first` is [null, ...ancestors, self]; the answer is the last shared entry
  // *before* the nodes themselves, hence the -1.
  // `path` is [null, …ancestors, self]; walk the ancestor positions and stop at
  // the last one both paths share.
  const ancestors = first.length - 2
  let shared = 0
  for (let k = 1; k <= ancestors; k++) {
    if (paths.every((p) => p.length > k + 1 && p[k] === first[k])) shared = k
    else break
  }
  return parentAt(nodes, first[shared] ?? null) ?? null
}

function pathTo(nodes: readonly Node[], id: string): (string | null)[] {
  const walk = (list: readonly Node[], trail: (string | null)[]): (string | null)[] | null => {
    for (const n of list) {
      const next = [...trail, n.id]
      if (n.id === id) return next
      if ((n.type === 'group' || n.type === 'axes') && n.children.length) {
        const found = walk(n.children, next)
        if (found) return found
      }
    }
    return null
  }
  return walk(nodes, [null]) ?? []
}

function parentAt(nodes: readonly Node[], id: string | null): Node | null {
  if (!id) return null
  return findNode(nodes, id) ?? null
}

/* ------------------------------------------------------------------ *
 *  Ids
 * ------------------------------------------------------------------ */

/** Every id in a subtree, used to remap on paste so nothing collides. */
export function collectIds(nodes: readonly Node[]): Set<string> {
  const out = new Set<string>()
  const walk = (list: readonly Node[]): void => {
    for (const n of list) {
      out.add(n.id)
      if ((n.type === 'group' || n.type === 'axes') && n.children.length) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/**
 * Give a pasted subtree fresh ids.
 *
 * A straight copy is the classic studio bug: pasting twice silently makes the
 * second copy shadow the first, because two nodes now answer to one id and
 * every reference resolves to whichever was resolved last.
 */
/**
 * Give a pasted subtree ids that are new to the *document*.
 *
 * A straight copy is the classic studio bug: pasting twice makes the second
 * copy shadow the first, because two nodes answer to one id and every
 * reference resolves to whichever was resolved last. Ids are minted against
 * the existing set, so the original keeps its name and only the paste moves.
 */
export function reid<T extends Node>(node: T, taken: ReadonlySet<string> = new Set()): T {
  const used = new Set(taken)
  const walk = (n: Node): Node => {
    let id = n.id
    while (used.has(id)) id = uid('n')
    used.add(id)
    const copy = { ...n, id } as Node
    if (n.type === 'group' || n.type === 'axes') {
      const withKids = copy as Node & { children: Node[] }
      withKids.children = n.children.map((c: Node) => walk(c))
    }
    return copy
  }
  return walk(node) as T
}

/* ------------------------------------------------------------------ *
 *  Clipboard
 * ------------------------------------------------------------------ */

export type Clipboard = {
  nodes: Node[]
  /** Names of the parents they came from, so a paste can land in context. */
  parents: (string | null)[]
  at: number
}

/** `at` is the playhead, so a paste lands where the author is looking. */
export function copySelection(nodes: readonly Node[], sel: SelIds, at: number): Clipboard | null {
  if (sel.length === 0) return null
  const picked: Node[] = []
  const parents: (string | null)[] = []
  for (const id of sel) {
    const path = pathTo(nodes, id)
    if (path.length < 2) continue
    const node = findNode(nodes, id)
    if (!node) continue
    // A node whose parent is also selected would arrive twice; the parent
    // already carries it.
    if (picked.some((already) => path.slice(0, -1).includes(already.id))) continue
    picked.push(node)
    parents.push(path[path.length - 2] ?? null)
  }
  if (picked.length === 0) return null
  return { nodes: picked, parents, at }
}

export type PasteResult = { nodes: Node[]; ids: string[] }

/**
 * Paste into the deepest still-open parent shared by the originals, or at the
 * root. Falls back to the root rather than refusing, because refusing a paste
 * with no feedback is worse than pasting one level up.
 */
export function pasteClipboard(
  nodes: Node[],
  clip: Clipboard,
  opts: { into?: string | null } = {},
): PasteResult {
  if (clip.nodes.length === 0) return { nodes, ids: [] }
  const target = opts.into ?? null
  // Mint against the live document so a paste never shadows an existing node.
  const taken = collectIds(nodes)
  const fresh = clip.nodes.map((n) => reid(n, taken))
  const ids = fresh.map((n) => n.id)

  if (target) {
    const parent = findNode(nodes, target)
    if (parent && (parent.type === 'group' || parent.type === 'axes')) {
      const children = parent.children
      if (children.length + fresh.length > LIMITS.maxNodes) {
        return { nodes, ids: [] }
      }
      return { nodes: replaceInTree(nodes, target, { ...parent, children: [...children, ...fresh] }), ids }
    }
  }
  if (nodes.length + fresh.length > LIMITS.maxNodes) return { nodes, ids: [] }
  return { nodes: [...nodes, ...fresh], ids }
}

function replaceInTree(nodes: Node[], id: string, next: Node): Node[] {
  return nodes.map((n) => {
    if (n.id === id) return next
    if ((n.type === 'group' || n.type === 'axes') && n.children.length) {
      return { ...n, children: replaceInTree(n.children, id, next) }
    }
    return n
  })
}

/** Remove in reverse order so a parent never outlives the child it holds. */
export function deleteSelection(nodes: Node[], sel: SelIds): { nodes: Node[]; removed: Node[] } {
  const order = [...sel].reverse()
  const removed: Node[] = []
  let out = nodes
  for (const id of order) {
    const node = findNode(out, id)
    if (!node) continue
    removed.unshift(node)
    out = removeFromTree(out, id)
  }
  return { nodes: out, removed }
}

function removeFromTree(nodes: Node[], id: string): Node[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) =>
      n.type === 'group' || n.type === 'axes'
        ? { ...n, children: removeFromTree(n.children, id) }
        : n,
    )
}

/* ------------------------------------------------------------------ *
 *  Time windows
 * ------------------------------------------------------------------ */

export type TimeWindow = { start?: number; end?: number }

/**
 * Shift a node's window by `delta`, clamped so it cannot leave the timeline.
 *
 * Dragging a clip past either end used to either freeze it or drop it; clamping
 * keeps the gesture total, which matters because a pointer drag will eventually
 * do both.
 */
export function moveWindow(w: TimeWindow | undefined, delta: number, duration: number): TimeWindow {
  const start = w?.start ?? 0
  const end = w?.end ?? duration
  const len = Math.max(0, end - start)
  const lo = 0
  const hi = Math.max(0, duration - len)
  const next = Math.min(hi, Math.max(lo, start + delta))
  return { start: next, end: next + len }
}

/** Resize one edge, keeping the other fixed and the window non-negative. */
export function resizeWindow(
  w: TimeWindow | undefined,
  edge: 'start' | 'end',
  at: number,
  duration: number,
): TimeWindow {
  const start = w?.start ?? 0
  const end = w?.end ?? duration
  if (edge === 'start') {
    return { start: Math.min(at, end), end }
  }
  return { start, end: Math.max(at, start) }
}

export function setWindow(node: Node, w: TimeWindow): Node {
  return { ...node, time: w }
}

/* ------------------------------------------------------------------ *
 *  Easing
 * ------------------------------------------------------------------ */

/**
 * The easings the studio offers, with a cubic control pair for the editor.
 *
 * The first five are the engine's own names, kept verbatim because they are
 * the *quadratic* curves v1 used and renaming them would silently change the
 * speed of every existing animation. The rest are `cubic-bezier(...)` strings,
 * which is the vocabulary the CSS ecosystem and every browser devtools panel
 * already share.
 */
export const EASES: { name: string; label: string; p1: [number, number]; p2: [number, number] }[] = [
  { name: 'linear', label: 'خطی', p1: [0, 0], p2: [1, 1] },
  { name: 'easeIn', label: 'تدریجی آغاز', p1: [0.42, 0], p2: [1, 1] },
  { name: 'easeOut', label: 'تدریجی پایان', p1: [0, 0], p2: [0.58, 1] },
  { name: 'ease', label: 'تدریجی دوطرفه', p1: [0.42, 0], p2: [0.58, 1] },
  { name: 'hold', label: 'پله‌ای', p1: [0, 0], p2: [1, 0] },
  { name: 'smooth', label: 'یکنواخت (PCHIP)', p1: [0, 0], p2: [1, 1] },
  { name: 'cubic-bezier(0.34, 1.56, 0.64, 1)', label: 'جهش پایان', p1: [0.34, 1.56], p2: [0.64, 1] },
  { name: 'cubic-bezier(0.22, 1.4, 0.36, 1)', label: 'کشسان', p1: [0.22, 1.4], p2: [0.36, 1] },
  { name: 'cubic-bezier(0.4, 0, 0.2, 1)', label: 'استاندارد', p1: [0.4, 0], p2: [0.2, 1] },
]

export type Bezier = [number, number, number, number]

/** Parse the SVG-ish `cubic-bezier(a,b,c,d)` a custom ease is stored as. */
export function parseBezier(spec: string | undefined): Bezier | null {
  if (!spec) return null
  const m = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(
    spec.trim(),
  )
  if (!m) return null
  const v = [m[1], m[2], m[3], m[4]].map(Number)
  if (v.some((n) => !Number.isFinite(n))) return null
  // x must be inside 0..1 for the curve to be a function; y may leave it, which
  // is exactly how a back or elastic ease overshoots.
  if (v[0] < 0 || v[0] > 1 || v[2] < 0 || v[2] > 1) return null
  return v as Bezier
}

export function formatBezier(b: Bezier): string {
  return `cubic-bezier(${b.map((n) => Number(n.toFixed(3))).join(', ')})`
}

/* ------------------------------------------------------------------ *
 *  Keyframes
 * ------------------------------------------------------------------ */

/** Shift every key by `delta`, keeping them ordered and inside the window. */
export function shiftKeys(keys: Key[], delta: number, from: number, to: number): Key[] {
  return keys
    .map((k) => ({ ...k, t: k.t + delta }))
    .filter((k) => k.t >= from - 1e-6 && k.t <= to + 1e-6)
    .sort((a, b) => a.t - b.t)
}

/** Reorder after a drag and drop in the tree. */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list
  const out = [...list]
  const [item] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item)
  return out
}