/**
 * Events: conditions that fire once, on the rising edge.
 *
 * The rule that matters is the **edge**. A condition like `r < 1.5` is true for
 * a whole stretch of time; firing on every frame of that stretch would spawn
 * hundreds of particle bursts. So an event only fires on the frame where its
 * condition goes from false to true, optionally re-arming after a cooldown.
 *
 * Actions are declarative too — the same list drives an event, a control
 * button, and a keyframe, so there is one vocabulary.
 */

import type { Node } from '../../types/anim2'
import { type CompiledExpr, type EvalEnv, compileExpr, validateExpr } from './expr'

/* ------------------------------------------------------------------ *
 *  Actions
 * ------------------------------------------------------------------ */

export type AnimAction =
  | { type: 'show'; target: string }
  | { type: 'hide'; target: string }
  | { type: 'fadeIn'; target: string; duration: number }
  | { type: 'fadeOut'; target: string; duration: number }
  | { type: 'setVar'; name: string; expr: string }
  | { type: 'playSound'; href: string; volume?: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'jumpTo'; t: number }
  | {
      type: 'spawnParticles'
      at: [string, string]
      count: number
      color: string
      speed: number
      lifetime: number
      shape?: 'dot' | 'spark' | 'star'
    }
  | { type: 'shake'; target: string; amplitude: number; duration: number }
  | { type: 'flash'; target: string; color: string; duration: number }
  | { type: 'log'; message: string }

/* ------------------------------------------------------------------ *
 *  Events
 * ------------------------------------------------------------------ */

export type AnimEventDef = {
  id: string
  /** A boolean expression, e.g. `"r < 1.5"`. */
  when: string
  actions: AnimAction[]
  /** Fire only the first time. Defaults to true — most events are one-shot. */
  once?: boolean
  /** Seconds before it can fire again. Defaults to 0. */
  cooldown?: number
}

type CompiledEvent = {
  id: string
  when: CompiledExpr
  actions: AnimAction[]
  once: boolean
  cooldown: number
  /** Value of `when` on the previous frame, for edge detection. */
  prev: number
  fired: boolean
  lastFired: number
}

export type EventPlan = {
  events: CompiledEvent[]
  /** Ids whose `when` could not be compiled. */
  broken: string[]
}

/**
 * Compile every event's condition once. `when` sees exactly the same
 * namespace as any other expression: the clock, parameters and scene vars.
 */
export function planEvents(
  defs: readonly AnimEventDef[] | undefined,
  scopeNames: Iterable<string>,
): EventPlan {
  const plan: EventPlan = { events: [], broken: [] }
  if (!defs?.length) return plan
  const names = new Set<string>(['t', 'lt', 'x', 'u', 'duration', ...scopeNames])

  for (const def of defs) {
    if (!def || typeof def.when !== 'string') {
      plan.broken.push(def?.id ?? '?')
      continue
    }
    const check = validateExpr(def.when, { vars: names, refIds: new Set() })
    if (!check.ok) {
      plan.broken.push(def.id)
      continue
    }
    plan.events.push({
      id: def.id,
      when: compileExpr(def.when, { vars: names, refIds: new Set() }),
      actions: Array.isArray(def.actions) ? def.actions : [],
      once: def.once !== false,
      cooldown: typeof def.cooldown === 'number' && def.cooldown > 0 ? def.cooldown : 0,
      prev: 0,
      fired: false,
      lastFired: -Infinity,
    })
  }
  return plan
}

export type EventState = {
  /** Ids that fired on this frame. */
  fired: string[]
  /** Every action raised this frame, in order. */
  actions: AnimAction[]
}

/**
 * Advance the event machine to time `t` and collect what happened.
 *
 * Pure with respect to the animation: it mutates only its own edge-tracking
 * state, which is what makes "fire once" work while scrubbing backwards and
 * forwards again.
 */
export function stepEvents(plan: EventPlan, t: number, env: EvalEnv): EventState {
  const out: EventState = { fired: [], actions: [] }

  for (const ev of plan.events) {
    let now: number
    try {
      now = ev.when(env) !== 0 ? 1 : 0
    } catch {
      now = 0
    }

    // Rising edge: false → true. A condition that is simply true (someone
    // scrubbing into the middle of a range) does not fire, which is what
    // stops a burst of particles appearing every frame.
    const edge = now === 1 && ev.prev === 0
    ev.prev = now

    if (!edge) continue
    if (ev.once && ev.fired) continue
    if (t - ev.lastFired < ev.cooldown) continue

    ev.fired = true
    ev.lastFired = t
    out.fired.push(ev.id)
    out.actions.push(...ev.actions)
  }

  return out
}

/** Forget every edge, so scrubbing back to the start can fire again. */
export function resetEvents(plan: EventPlan): void {
  for (const ev of plan.events) {
    ev.prev = 0
    ev.fired = false
    ev.lastFired = -Infinity
  }
}

/* ------------------------------------------------------------------ *
 *  Actions that need resolving scene context
 * ------------------------------------------------------------------ */

/** Resolve `[expr, expr]` — an action's position, given the live namespace. */
export function evalPoint(at: [string, string], env: EvalEnv): { x: number; y: number } {
  const read = (src: string, fallback: number): number => {
    try {
      const v = compileExpr(src || '0', { vars: new Set<string>(['t', 'lt', 'x', 'u', 'duration', ...Object.keys(env.v)]) })(env)
      return Number.isFinite(v) ? v : fallback
    } catch {
      return fallback
    }
  }
  return { x: read(at[0], 0), y: read(at[1], 0) }
}

/** Whether an action's target exists, so the UI can flag a typo. */
export function targetExists(nodes: readonly Node[], id: string): boolean {
  for (const n of nodes) {
    if (n.id === id) return true
    if (n.type === 'group' || n.type === 'axes') {
      if (targetExists(n.children ?? [], id)) return true
    }
  }
  return false
}