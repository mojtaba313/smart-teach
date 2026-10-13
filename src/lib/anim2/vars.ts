/**
 * Declarative scene variables.
 *
 * v2 already had `@node.prop` references, which cover "read another body's
 * position". What it lacked was the thing an author actually writes when the
 * quantities are *derived*, not drawn: a dozen charges, each contributing to a
 * field, and every vector on screen reading that one field.
 *
 * ```json
 * "vars": {
 *   "x1": "-3 + 0.3 * t",
 *   "x2": "3 - 0.3 * t",
 *   "r2": "(x2 - x1)^2",
 *   "F":  "9e9 * q1 * q2 / max(r2, 0.01)",
 *   "Fx": "F * (x2 - x1) / sqrt(r2)"
 * }
 * ```
 *
 * They are resolved once per frame, in dependency order, so a variable may
 * reference another variable defined later in the object.
 */

import { type CompiledExpr, type EvalEnv, compileExpr, validateExpr, RESERVED } from './expr'

export type SceneVars = Record<string, string>

export type ResolvedVar = {
  name: string
  fn: CompiledExpr
  /** Ids of other variables this one reads. */
  deps: string[]
}

export type VarPlan = {
  /** Topologically sorted: a variable only ever reads earlier entries. */
  order: ResolvedVar[]
  /** Names in a dependency cycle. They evaluate to 0 and are reported. */
  cyclic: string[]
  /** Names that could not be compiled at all. */
  broken: string[]
  /** Names that were refused because they collide with the language. */
  reserved: string[]
}

/**
 * Decide the evaluation order and compile everything once.
 *
 * A missing variable is *not* an error: it reads as 0, so a scene with one bad
 * entry still renders everything else. Only genuine cycles are called out.
 */
export function planVars(vars: SceneVars | undefined, extraNames?: Iterable<string>): VarPlan {
  const plan: VarPlan = { order: [], cyclic: [], broken: [], reserved: [] }
  if (!vars) return plan

  const names = Object.keys(vars)
  const present = new Set(names)
  const compiled = new Map<string, ResolvedVar>()
  // A variable may read a parameter, so validation has to know those names too
  // or every scene using `q1` would be reported as broken.
  const ambient = new Set<string>(extraNames ?? [])

  for (const name of names) {
    if (!isLegalName(name)) {
      plan.reserved.push(name)
      continue
    }
    if (RESERVED.has(name)) {
      plan.reserved.push(name)
      continue
    }
    const src = vars[name]
    const scopeNames = new Set<string>(['t', 'lt', 'x', 'u', 'duration', ...present, ...ambient])
    const check = validateExpr(src, { vars: scopeNames, refIds: new Set() })
    if (!check.ok) {
      plan.broken.push(name)
      continue
    }
    compiled.set(name, {
      name,
      fn: compileExpr(src, { vars: scopeNames, refIds: new Set() }),
      // A name that reads itself is a cycle of length one, so it stays in
      // the dependency list on purpose.
      deps: check.ok ? check.deps.names.filter((d) => present.has(d)) : [],
    })
  }

  // Depth-first topological sort. Anything that revisits a node on the current
  // path is part of a cycle and is dropped rather than half-evaluated.
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (name: string, path: string[]): void => {
    const seen = state.get(name)
    if (seen === 2) return
    if (seen === 1) {
      const at = path.indexOf(name)
      for (const onPath of path.slice(at < 0 ? 0 : at)) plan.cyclic.push(onPath)
      plan.cyclic.push(name)
      return
    }
    state.set(name, 1)
    path.push(name)
    for (const dep of compiled.get(name)?.deps ?? []) {
      if (compiled.has(dep)) visit(dep, path)
    }
    path.pop()
    state.set(name, 2)
    plan.order.push(compiled.get(name)!)
  }
  for (const name of names) if (compiled.has(name)) visit(name, [])

  // A cyclic variable must not be evaluated at all, or it would read a value
  // computed from itself.
  const cyclicSet = new Set(plan.cyclic)
  plan.order = plan.order.filter((v) => !cyclicSet.has(v.name))
  plan.cyclic = [...new Set(plan.cyclic)]
  return plan
}

/** Names are `[A-Za-z_][A-Za-z0-9_]*`; Persian is deliberately not allowed. */
export function isLegalName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

/**
 * Evaluate the plan into a name→value map for this frame.
 *
 * Returns a fresh object each call: it is small (one entry per variable) and
 * handing out a shared mutable map would let a caller's write corrupt the next
 * frame.
 */
export function resolveVars(
  plan: VarPlan,
  env: EvalEnv,
  extra?: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = extra ? { ...extra } : {}
  for (const v of plan.order) {
    // A variable may read another variable; the lookup goes through the values
    // already computed this frame, so order is what makes this work.
    const scoped: EvalEnv = { ...env, v: { ...env.v, ...out } }
    const value = v.fn(scoped)
    out[v.name] = Number.isNaN(value) ? 0 : value
  }
  return out
}

/** One-line explanation of anything the plan could not use, or null if clean. */
export function describeVars(plan: VarPlan): string | null {
  const parts: string[] = []
  if (plan.reserved.length) parts.push(`نام‌های رزرو‌شده: ${plan.reserved.join('، ')}`)
  if (plan.broken.length) parts.push(`فرمول نامعتبر: ${plan.broken.join('، ')}`)
  if (plan.cyclic.length) parts.push(`ارجاع حلقوی: ${plan.cyclic.join('، ')}`)
  return parts.length ? parts.join(' | ') : null
}