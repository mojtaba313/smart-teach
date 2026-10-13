/**
 * Live controls for `Animation2.params`.
 *
 * One component draws every control kind so a scene's knobs stay visually
 * identical and line up, whichever kind each happens to be. The alternative —
 * a separate widget per kind — drifts within a lesson, and the drift is
 * exactly what makes a lesson feel unfinished.
 *
 * Buttons carry their own action list, which is why `onAction` exists: a
 * control is the one place a *viewer*, not the author, can trigger a scene
 * effect, and that has to reach the same runtime the events use.
 */

'use client'

import { memo } from 'react'
import type { AnimAction, Param } from '../../types/anim2'
import { cn, toFaDigits } from '../../lib/utils'

export type ControlProps = {
  name: string
  param: Param
  onChange: (name: string, value: number) => void
  /** Fired when a control carries actions. Not called for a bare value change. */
  onAction?: (name: string, actions: readonly AnimAction[]) => void
  /** Disabled while the scene is loading or the animation is disabled. */
  disabled?: boolean
}

/** The kind actually drawn, resolving the v1 `slider` flag. */
export function controlKind(param: Param): NonNullable<Param['control']> {
  if (param.control) return param.control
  // v1 only had a boolean `slider`; honour it before defaulting, or every old
  // document would silently gain a range input it never asked for.
  if (param.slider === true) return 'slider'
  if (param.slider === false) return 'slider'
  return 'slider'
}

const label = (name: string, param: Param): string => param.label ?? name

export const ParamControl = memo(function ParamControl({
  name,
  param,
  onChange,
  onAction,
  disabled,
}: ControlProps) {
  const kind = controlKind(param)
  const text = label(name, param)
  const base =
    'h-7 rounded-md border border-hairline bg-surface text-2xs text-ink disabled:opacity-50'

  // A toggle is a param holding 0 or 1, so `when: "show == 1"` reads as plain
  // arithmetic rather than needing a second language.
  if (kind === 'toggle') {
    const on = param.value >= 0.5
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={text}
        disabled={disabled}
        onClick={() => {
          const next = on ? 0 : 1
          onChange(name, next)
          if (param.actions) onAction?.(name, param.actions)
        }}
        className={cn(
          'flex h-7 items-center gap-2 rounded-md border px-2 text-2xs',
          on ? 'border-brand bg-brand/10 text-brand' : 'border-hairline bg-surface text-ink-3',
        )}
      >
        <span className={cn('h-3 w-3 rounded-full', on ? 'bg-brand' : 'bg-hairline')} />
        {text}
      </button>
    )
  }

  if (kind === 'select') {
    const options = param.options ?? []
    return (
      <label className="flex items-center gap-1.5 text-2xs text-ink-3">
        <span className="whitespace-nowrap">{text}</span>
        <select
          value={String(Math.round(param.value))}
          disabled={disabled}
          aria-label={text}
          onChange={(e) => {
            const next = parseInt(e.target.value, 10)
            if (!Number.isNaN(next)) {
              onChange(name, next)
              if (param.actions) onAction?.(name, param.actions)
            }
          }}
          className={cn(base, 'px-1.5')}
        >
          {options.map((o, i) => (
            // The stored value is the index, so the option label is free text.
            <option key={`${o}-${i}`} value={i}>
              {o}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (kind === 'button') {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={text}
        onClick={() => {
          // A pulsed button reads as held while it works, then falls back, so a
          // single press cannot leave the scene latched in a transient state.
          if (param.pulseFor !== undefined && param.pulseFor > 0) {
            onChange(name, param.value === (param.resetTo ?? 0) ? 1 : (param.resetTo ?? 0))
            if (param.actions) onAction?.(name, param.actions)
          } else {
            onChange(name, param.value + 1)
            if (param.actions) onAction?.(name, param.actions)
          }
        }}
        className={cn(base, 'px-2.5 font-medium hover:border-brand/50 hover:text-brand')}
      >
        {text}
      </button>
    )
  }

  return (
    <label className="flex items-center gap-1.5 text-2xs text-ink-3">
      <span className="w-16 shrink-0 truncate">{text}</span>
      <input
        type="range"
        min={param.min ?? 0}
        max={param.max ?? 10}
        step={param.step ?? 0.1}
        value={param.value}
        disabled={disabled}
        aria-label={text}
        onChange={(e) => onChange(name, parseFloat(e.target.value))}
        className="h-1 flex-1 accent-brand"
      />
      <span className="w-12 shrink-0 text-left tabular-nums">{toFaDigits(String(param.value))}</span>
    </label>
  )
})

/** The whole panel, in declaration order. */
export const ParamsPanel = memo(function ParamsPanel({
  params,
  onChange,
  onAction,
  disabled,
}: {
  params: Record<string, Param>
  onChange: (name: string, value: number) => void
  onAction?: (name: string, actions: readonly AnimAction[]) => void
  disabled?: boolean
}) {
  const names = Object.keys(params)
  if (names.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {names.map((name) => (
        <ParamControl
          key={name}
          name={name}
          param={params[name]}
          onChange={onChange}
          onAction={onAction}
          disabled={disabled}
        />
      ))}
    </div>
  )
})