/**
 * The per-frame side effects an animation needs: events, particles and clock
 * bookkeeping.
 *
 * This is a hook rather than part of the renderer so the studio and the player
 * behave identically. The studio, for instance, uses `EditorCanvas` and never
 * touches `AnimationPlayer` — when the event loop lived in the player, editing
 * a scene silently stopped firing its events.
 *
 * The whole loop runs on the clock's listener, outside React's render path.
 * Only a version counter is set state, so a burst of 500 particles costs one
 * re-render of the canvas, not of the scene tree or the inspector.
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Clock } from '../../lib/anim2/clock'
import type { CompiledAnimation } from '../../lib/anim2/engine'
import { valueOf } from '../../lib/anim2/engine'
import type { EvalEnv } from '../../lib/anim2/expr'
import { evalPoint, resetEvents, stepEvents } from '../../lib/anim2/events'
import { ParticleSystem } from '../../lib/anim2/particles'

export type SceneRuntime = {
  particles: ParticleSystem
  /** Bumped every frame; a component can depend on it without polling. */
  version: number
  /** Seek and forget edge state, so scrubbing back re-arms one-shot events. */
  seek: (t: number) => void
  /** Run an action list directly — used by control buttons. */
  run: (actions: readonly import('../../types/anim2').AnimAction[]) => void
}

export function useSceneRuntime(
  clock: Clock,
  compiled: CompiledAnimation | null,
  overrides?: Record<string, number>,
): SceneRuntime {
  const particles = useMemo(() => new ParticleSystem(), [])
  const [version, setVersion] = useState(0)
  const lastTime = useRef(0)

  const envAt = useCallback(
    (t: number): EvalEnv => ({
      t,
      lt: t,
      x: t,
      u: 0,
      duration: compiled?.duration ?? 0,
      v: compiled ? { ...valueOf(compiled, t, overrides) } : {},
    }),
    [compiled, overrides],
  )

  const run = useCallback(
    (actions: readonly import('../../types/anim2').AnimAction[]) => {
      const env = envAt(clock.t)
      for (const action of actions) {
        if (action.type === 'pause') clock.pause()
        else if (action.type === 'resume') clock.play()
        else if (action.type === 'jumpTo') clock.seek(action.t)
        else if (action.type === 'spawnParticles') {
          particles.spawn(evalPoint(action.at, env), {
            count: action.count,
            color: action.color,
            speed: action.speed,
            lifetime: action.lifetime,
            shape: action.shape ?? 'dot',
            budgetMs: 16,
          })
        } else if (action.type === 'log') {
          console.info('[anim]', action.message)
        }
        // show/hide/fade/shake/flash and setVar are resolved by the caller,
        // which owns the scene; `run` only handles what needs the clock.
      }
      setVersion((n) => n + 1)
    },
    [clock, particles, envAt],
  )

  useEffect(() => {
    if (!compiled) return
    const tick = (): void => {
      const t = clock.t
      const dt = Math.max(0, t - lastTime.current)
      lastTime.current = t
      const { actions } = stepEvents(compiled.events, t, envAt(t))
      for (const action of actions) {
        if (action.type === 'pause') clock.pause()
        else if (action.type === 'resume') clock.play()
        else if (action.type === 'jumpTo') clock.seek(action.t)
        else if (action.type === 'spawnParticles') {
          particles.spawn(evalPoint(action.at, envAt(t)), {
            count: action.count,
            color: action.color,
            speed: action.speed,
            lifetime: action.lifetime,
            shape: action.shape ?? 'dot',
            budgetMs: 16,
          })
        } else if (action.type === 'log') {
          console.info('[anim]', action.message)
        }
      }
      if (dt > 0) particles.step(dt)
      setVersion((n) => n + 1)
    }
    // Step once so particles spawned by an event on the very first frame are
    // not frozen until the clock next moves.
    tick()
    return clock.subscribe(tick)
  }, [clock, compiled, particles, envAt])

  const seek = useCallback(
    (t: number) => {
      if (compiled) resetEvents(compiled.events)
      particles.clear()
      lastTime.current = t
      clock.seek(t)
      setVersion((n) => n + 1)
    },
    [clock, compiled, particles],
  )

  useEffect(() => () => particles.clear(), [particles])

  return { particles, version, seek, run }
}