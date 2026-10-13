/**
 * The shape registry: named outlines that `shape` nodes draw.
 *
 * A shape's path is SVG path data in which `w`, `h`, `r`, `a` and `n` are bare
 * numbers in the arithmetic. They are substituted as literal numbers rather
 * than bound as variables, because a path is a closed piece of geometry that
 * has to be measured once per frame — a name lookup per coordinate would turn
 * a triangle into hundreds of scope reads, and paths are exactly where a
 * renderer cannot afford that.
 *
 * Substitution is length-aware: a replacement is wrapped so it cannot merge
 * with a neighbouring digit, which is the difference between `2r` and the
 * nonsense `2r-1` turning into the single token `2r-1`.
 */

import type { NumProp, ShapeDef } from '../../types/anim2'
import { LIMITS } from '../../types/anim2'
import type { EvalEnv, Scope } from './expr'
import { compileExpr } from './expr'

/** The names a path may use bare. Chosen to not collide with SVG keywords. */
export const SHAPE_VARS = ['w', 'h', 'r', 'a', 'n'] as const

export type ShapeValues = Record<string, number>

/**
 * Command letters that must never be substituted.
 *
 * `h`, `v`, `a` and `e` are deliberately absent: each is also a plausible
 * parameter name, and the surrounding arithmetic is what distinguishes them. A
 * `h` in `-h` or `h L` is a height; a `h` straight after a coordinate is the
 * horizontal-lineto command. Keeping the ambiguous letters substitutable is
 * the lesser evil — a definition that cannot use `h` as a height is far more
 * annoying than one that has to write `height`.
 */
const COMMANDS = new Set([
  'M', 'm', 'L', 'l', 'H', 'V', 'C', 'c', 'S', 's', 'Q', 'q',
  'T', 't', 'A', 'Z', 'z', 'E', 'x', 'y',
])

export type ResolvedShape = {
  /** SVG path data, with every substitution already made. */
  d: string
  /** Centroid offset in the shape's own units. */
  offset: { x: number; y: number }
}

export type ShapeWarning = { shapeId: string; message: string }

const num = (v: NumProp | undefined, env: EvalEnv, scope: Scope, fallback: number): number => {
  if (v === undefined) return fallback
  if (typeof v === 'number') return v
  if ('expr' in v) {
    try {
      const n = compileExpr(v.expr, scope)(env)
      return Number.isFinite(n) ? n : fallback
    } catch {
      return fallback
    }
  }
  return fallback
}

/**
 * Replace a bare name with its value, padded so `2r` cannot become `2` glued
 * to whatever follows. A negative value needs the same treatment: `-r` is
 * already an operator, but `w-r` would otherwise read as one token.
 */
export function substitute(src: string, values: ShapeValues): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const isStart = i === 0
    const prev = isStart ? '' : src[i - 1]
    // A name only starts where an identifier can start, so `stroke` and
    // `Arc` inside a path command are left alone.
    if (/[A-Za-z_]/.test(c) && !/[A-Za-z0-9_]/.test(prev)) {
      let j = i + 1
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1
      const word = src.slice(i, j)
      // A command is a letter sitting where a value cannot — after another
      // value, after a command, or at the start of a subpath.
      const prevChar = out.trimEnd().slice(-1)
      const asCommand =
        COMMANDS.has(word) && (prevChar === '' || /[\d.)-]/.test(prevChar))
      if (!asCommand && word in values) {
        const v = values[word]
        const n = Number.isFinite(v) ? v : 0
        const body = Math.abs(n) < 1e-12 ? '0' : String(Number(n.toFixed(6)))
        // A negative value must keep its sign as an operator.
        const needsParens = body.startsWith('-')
        out += needsParens ? `(${body})` : body
        i = j
        continue
      }
      out += word
      i = j
      continue
    }
    out += c
    i += 1
  }
  return out
}

/** A compact, axis-aligned bounding box of a path's own commands. */
export function pathBounds(d: string): { w: number; h: number } {
  const nums: number[] = []
  const re = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) nums.push(Number(m[0]))
  // Command letters and numbers alternate unevenly, so the axis bounds come
  // from a scan of the numeric stream rather than a full path parser. It is
  // enough for sizing a hit box and is explicitly not a geometry library.
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i]
    const y = nums[i + 1]
    if (Number.isFinite(x) && Number.isFinite(y)) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  if (!Number.isFinite(minX)) return { w: 0, h: 0 }
  return { w: maxX - minX, h: maxY - minY }
}

export type ShapeRegistry = {
  /** Resolved outline for one frame. */
  resolve(
    shapeId: string,
    params: Record<string, NumProp> | undefined,
    env: EvalEnv,
    scope: Scope,
  ): ResolvedShape | null
  warnings: ShapeWarning[]
  ids: string[]
}

/**
 * Build the table for an animation. Defaults come from the shape's own
 * `params`, overridden per instance — so `wedge(w=4)` and `wedge(w=2)` are the
 * same definition, which is the whole point of having a registry.
 */
export function planShapes(defs: Record<string, ShapeDef> | undefined): ShapeRegistry {
  // Built-ins are merged underneath, so a scene can use `wedge` immediately and
  // still override any entry by name.
  const table = { ...BUILTIN_SHAPES, ...(defs ?? {}) }
  const warnings: ShapeWarning[] = []
  const ids = Object.keys(table).slice(0, LIMITS.maxTemplates)

  const resolve = (
    shapeId: string,
    params: Record<string, NumProp> | undefined,
    e: EvalEnv,
    sc: Scope,
  ): ResolvedShape | null => {
    const def = table[shapeId]
    if (!def) {
      warnings.push({ shapeId, message: 'شکل تعریف نشده بود' })
      return null
    }
    if (typeof def.path !== 'string' || def.path.length === 0) {
      warnings.push({ shapeId, message: 'مسیر شکل خالی بود' })
      return null
    }
    const values: ShapeValues = {}
    for (const key of Object.keys(def.params ?? {})) {
      values[key] = num(def.params![key], e, sc, 0)
    }
    // An instance parameter wins, which is what makes one definition reusable.
    for (const key of Object.keys(params ?? {})) {
      values[key] = num(params![key], e, sc, values[key] ?? 0)
    }
    for (const key of SHAPE_VARS) if (!(key in values)) values[key] = key === 'n' ? 3 : 1

    // Guard the substitutions themselves: a NaN leaking into path data makes
    // the whole `<path>` silently vanish, with nothing in the console.
    for (const key of SHAPE_VARS) {
      if (!Number.isFinite(values[key])) values[key] = 0
    }
    return {
      d: substitute(def.path, values),
      offset: {
        x: num(def.offset?.x, e, sc, 0),
        y: num(def.offset?.y, e, sc, 0),
      },
    }
  }

  return { resolve, warnings, ids }
}

/**
 * Shapes every lesson reaches for, offered as defaults so a scene can use
 * `wedge` without first authoring it. Kept deliberately few: a registry that
 * guesses is a registry nobody trusts.
 */
export const BUILTIN_SHAPES: Record<string, ShapeDef> = {
  wedge: {
    path: 'M -w/2 0 L w/2 0 L 0 -h Z',
    params: { w: 4, h: 2 },
  },
  ramp: {
    path: 'M -w/2 -h L w/2 -h L w/2 h L -w/2 h Z',
    params: { w: 6, h: 1 },
  },
  box: {
    path: 'M -w/2 -h/2 L w/2 -h/2 L w/2 h/2 L -w/2 h/2 Z',
    params: { w: 2, h: 2 },
  },
  disc: {
    path: 'M -r 0 A r r 0 1 0 r 0 A r r 0 1 0 -r 0 Z',
    params: { r: 1 },
  },
  'disc-sector': {
    path: 'M 0 0 L -r 0 A r r 0 0 1 -r*cos(a) -r*sin(a) Z',
    params: { r: 1, a: 45 },
  },
  arrowhead: {
    path: 'M -w/2 -h/2 L w/2 0 L -w/2 h/2 Z',
    params: { w: 1, h: 0.8 },
  },
  'cone-half': {
    path: 'M -r 0 A r r 0 0 1 r 0 L 0 0 Z',
    params: { r: 2 },
  },
}