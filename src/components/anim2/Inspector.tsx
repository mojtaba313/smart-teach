/**
 * The inspector, generated from the property schema.
 *
 * v1 wrote 1211 lines of forms, one block per node type. This file has no
 * knowledge of any particular node type: it reads `schema.ts` and renders
 * whatever it finds. Adding a property to a type is one line in the schema.
 *
 * Every animatable number carries a mode switch — constant, formula, keys —
 * because "this moved" and "this is a formula" are different facts, and v1
 * buried that distinction in the shape of the form.
 */

'use client'

import { memo, useMemo } from 'react'
import { AlertCircle, KeyRound, Link2, Sigma } from 'lucide-react'
import type { AnimAction, Animation2, Key, Node, NumProp } from '../../types/anim2'
import { uid } from '../../types/anim2'
import { validateExpr } from '../../lib/anim2/expr'
import { groupedProps, modeOf, readPath, valueOf, writePath, type PropMode, type PropSpec } from '../../lib/anim2/schema'
import { dedupeKeys } from '../../lib/anim2/timeline'
import { BUILTIN_TEMPLATES } from '../../lib/anim2/templates'
import { cn, toFaDigits } from '../../lib/utils'
import { controlKind } from './Controls'

export type NodeChange = (nodeId: string, next: Node) => void

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/* ------------------------------------------------------------------ *
 *  One property
 * ------------------------------------------------------------------ */

const PropertyRow = memo(function PropertyRow({
  node,
  spec,
  scope,
  onNode,
}: {
  node: Node
  spec: PropSpec
  scope: Set<string>
  onNode: NodeChange
}) {
  const raw = readPath(node, spec.path)
  const mode = modeOf(raw)
  const value = valueOf(node, spec)

  const setNode = (next: Node) => onNode(node.id, next)

  const setPath = (v: unknown) => {
    setNode(writePath(node, spec.path, v))
  }

  /* ---- not animatable: a plain control ---- */
  if (!spec.animatable) {
    return (
      <div className="grid grid-cols-[6rem_1fr] items-center gap-2">
        <label className="truncate text-2xs font-bold text-ink-3" title={spec.hint ?? spec.label}>
          {spec.label}
        </label>
        {spec.kind === 'boolean' ? (
          <Toggle on={value === true} onChange={(v) => setPath(v)} />
        ) : spec.kind === 'select' ? (
          <select
            value={String(value)}
            onChange={(e) => setPath(e.target.value)}
            className="h-8 rounded-lg border border-hairline bg-surface px-2 text-xs font-bold outline-none focus:border-brand/70"
          >
            {(spec.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : spec.kind === 'color' ? (
          <div className="flex items-center gap-1">
            <input
              type="color"
              value={typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#111827'}
              onChange={(e) => setPath(e.target.value)}
              className="size-8 shrink-0 rounded border border-hairline"
              aria-label={spec.label}
            />
            <input
              value={String(value)}
              onChange={(e) => setPath(e.target.value)}
              className="h-8 w-full min-w-0 rounded-lg border border-hairline bg-surface px-2 text-xs outline-none focus:border-brand/70"
            />
          </div>
        ) : (
          <input
            value={String(value)}
            onChange={(e) => setPath(e.target.value)}
            className="h-8 w-full min-w-0 rounded-lg border border-hairline bg-surface px-2 text-xs outline-none focus:border-brand/70"
          />
        )}
      </div>
    )
  }

  /* ---- animatable: constant | formula | keys ---- */
  const keys = mode === 'keys' && typeof value === 'object' && value && 'keys' in (value as object)
    ? ((value as { keys: Key[] }).keys ?? [])
    : []

  const switchTo = (next: PropMode) => {
    if (next === mode) return
    if (next === 'const') setPath(num(value))
    else if (next === 'expr') setPath({ expr: typeof value === 'number' ? String(value) : '0' })
    else {
      const t = 0
      setPath({ keys: dedupeKeys([{ id: uid('k'), t, v: num(value), ease: 'smooth' as const }]) })
    }
  }

  return (
    <div className="space-y-1 rounded-lg bg-sunken/50 p-1.5">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-2xs font-bold text-ink-3" title={spec.hint ?? spec.label}>
          {spec.label}
        </span>
        <ModeSwitch mode={mode} onChange={switchTo} />
      </div>

      {mode === 'const' ? (
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            step={spec.step ?? 1}
            value={num(value)}
            onChange={(e) => setPath(parseFloat(e.target.value))}
            className="h-8 w-full min-w-0 rounded-lg border border-hairline bg-surface px-2 text-xs font-bold tabular-nums outline-none focus:border-brand/70"
          />
          <LiveValue spec={spec} mode={mode} value={value} />
        </div>
      ) : mode === 'expr' ? (
        <ExprInput source={typeof value === 'object' && value && 'expr' in (value as object) ? String((value as { expr: string }).expr) : ''} scope={scope} onChange={(expr) => setPath({ expr })} />
      ) : (
        <KeyList keys={keys} spec={spec} onChange={(next) => setPath({ keys: next })} />
      )}
    </div>
  )
})

/** constant / formula / keys, in one place, so the meaning is never guessed at. */
function ModeSwitch({ mode, onChange }: { mode: PropMode; onChange: (m: PropMode) => void }) {
  const options: { m: PropMode; icon: typeof Sigma; label: string }[] = [
    { m: 'const', icon: KeyRound, label: 'ثابت' },
    { m: 'expr', icon: Sigma, label: 'فرمول' },
    { m: 'keys', icon: Link2, label: 'کی‌فریم' },
  ]
  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border border-hairline" role="group" aria-label="نوع مقدار">
      {options.map(({ m, icon: Icon, label }) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          title={label}
          className={cn(
            'grid size-6 place-items-center text-2xs transition',
            mode === m ? 'bg-brand text-white' : 'text-ink-3 hover:bg-sunken',
          )}
        >
          <Icon className="size-3" />
        </button>
      ))}
    </div>
  )
}

function ExprInput({
  source,
  scope,
  onChange,
}: {
  source: string
  scope: Set<string>
  onChange: (next: string) => void
}) {
  const check = useMemo(() => validateExpr(source || '0', { vars: scope, refIds: new Set() }), [source, scope])
  const ok = check.ok
  return (
    <div className="space-y-1">
      <input
        value={source}
        onChange={(e) => onChange(e.target.value)}
        dir="ltr"
        placeholder="مثلاً 4*t - 2*t^2"
        className={cn(
          'h-8 w-full min-w-0 rounded-lg border bg-surface px-2 font-mono text-xs outline-none',
          ok ? 'border-hairline focus:border-brand/70' : 'border-danger',
        )}
      />
      {!ok ? (
        <p role="alert" className="flex items-start gap-1 text-[10px] leading-4 text-danger">
          <AlertCircle className="mt-px size-3 shrink-0" />
          <span>{check.message}</span>
        </p>
      ) : null}
    </div>
  )
}

function KeyList({ keys, spec, onChange }: { keys: Key[]; spec: PropSpec; onChange: (keys: Key[]) => void }) {
  return (
    <div className="space-y-1">
      {keys.map((k) => (
        <div key={k.id} className="flex items-center gap-1">
          <input
            type="number"
            step={0.05}
            value={k.t}
            onChange={(e) => onChange(keys.map((x) => (x.id === k.id ? { ...x, t: parseFloat(e.target.value) } : x)))}
            className="h-7 w-16 rounded-md border border-hairline bg-surface px-1.5 text-2xs tabular-nums"
            aria-label="زمان کی‌فریم"
          />
          <input
            type="number"
            step={spec.step ?? 0.1}
            value={k.v}
            onChange={(e) => onChange(keys.map((x) => (x.id === k.id ? { ...x, v: parseFloat(e.target.value) } : x)))}
            className="h-7 w-20 rounded-md border border-hairline bg-surface px-1.5 text-2xs tabular-nums"
            aria-label="مقدار کی‌فریم"
          />
          <select
            value={k.ease ?? 'smooth'}
            onChange={(e) => onChange(keys.map((x) => (x.id === k.id ? { ...x, ease: e.target.value as never } : x)))}
            className="h-7 flex-1 rounded-md border border-hairline bg-surface px-1 text-2xs"
            aria-label="نرمی"
          >
            {['smooth', 'linear', 'ease', 'easeIn', 'easeOut', 'hold'].map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onChange(keys.filter((x) => x.id !== k.id))}
            className="grid size-6 shrink-0 place-items-center rounded-md text-2xs text-ink-3 hover:bg-surface hover:text-danger"
            aria-label="حذف کی‌فریم"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...keys, { id: uid('k'), t: 0, v: num(readPath({}, spec.path)), ease: 'smooth' }])}
        className="w-full rounded-md border border-dashed border-hairline py-1 text-2xs font-bold text-ink-3 hover:border-brand/60 hover:text-brand"
      >
        + کی‌فریم
      </button>
    </div>
  )
}

/** What the property is right now, so you can see a formula working. */
function LiveValue({ spec, mode, value }: { spec: PropSpec; mode: PropMode; value: unknown }) {
  const v = num(value)
  return (
    <span className="shrink-0 tabular-nums text-2xs text-ink-3">
      {mode === 'const' && spec.kind === 'number' ? toFaDigits(String(Math.round(v * 1000) / 1000)) : null}
    </span>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn('relative h-5 w-9 shrink-0 rounded-full transition', on ? 'bg-brand' : 'bg-hairline')}
    >
      <span className={cn('absolute top-0.5 size-4 rounded-full bg-white transition-all', on ? 'start-0.5' : 'start-4.5')} />
    </button>
  )
}

/* ------------------------------------------------------------------ *
 *  Panels
 * ------------------------------------------------------------------ */

export function NodeInspector({
  node,
  anim,
  onNode,
}: {
  node: Node
  anim: Animation2
  onNode: NodeChange
}) {
  const scope = useMemo(
    () => new Set(['t', 'lt', 'x', 'u', 'duration', ...Object.keys(anim.params ?? {}), ...Object.keys(anim.templates ?? {})]),
    [anim.params, anim.templates],
  )

  return (
    <div className="space-y-3 p-2">
      {groupedProps(node.type).map((group) => (
        <section key={group.group} className="space-y-1.5">
          <h3 className="text-2xs font-black uppercase tracking-wide text-ink-3">{group.group}</h3>
          {group.props.map((spec) => (
            <PropertyRow key={spec.path} node={node} spec={spec} scope={scope} onNode={onNode} />
          ))}
        </section>
      ))}
    </div>
  )
}

/** The animation's own settings, plus the parameters a viewer may move. */
export function ParamsPanel({
  anim,
  onParam,
  onAction,
}: {
  anim: Animation2
  onParam: (name: string, patch: Record<string, unknown> | null) => void
  /** Forwards a control's own actions to the scene runtime. */
  onAction?: (name: string, actions: readonly AnimAction[]) => void
}) {
  // Editing here writes the document; the player's panel writes local state.
  // Both end up as the same number, so a formula never has to care which.
  const onValue = (name: string, value: number): void => onParam(name, { value })
  const entries = Object.entries(anim.params ?? {})
  return (
    <div className="space-y-2 p-2">
      <div className="grid grid-cols-[6rem_1fr] items-center gap-2">
        <label className="text-2xs font-bold text-ink-3">مدت</label>
        <input
          type="number"
          step={0.5}
          min={0.2}
          max={600}
          value={anim.duration}
          onChange={(e) => onParam('__duration', { duration: parseFloat(e.target.value) })}
          className="h-8 rounded-lg border border-hairline bg-surface px-2 text-xs font-bold tabular-nums"
        />
      </div>
      <Toggle on={anim.loop === true} onChange={(v) => onParam('__loop', { loop: v })} />

      <h3 className="pt-1 text-2xs font-black uppercase tracking-wide text-ink-3">پارامترها</h3>
      {entries.length === 0 ? (
        <p className="text-2xs text-ink-3">هنوز پارامتری تعریف نشده. با پارامتر، فرمول‌ها با لغزنده زنده می‌شوند.</p>
      ) : null}
      {entries.map(([name, param]) => (
        <div key={name} className="space-y-1 rounded-lg bg-sunken/50 p-1.5">
          <div className="flex items-center gap-1.5">
            {controlKind(param) === 'slider' ? <span className="text-2xs text-ink-3">{param.label ?? name}</span> : null}
            <input
              value={param.label ?? name}
              onChange={(e) => onParam(name, { label: e.target.value })}
              className="h-6 min-w-0 flex-1 bg-transparent text-2xs font-bold outline-none"
            />
            <Toggle on={param.slider === true} onChange={(v) => onParam(name, { slider: v })} />
            <button
              type="button"
              onClick={() => onParam(name, null)}
              className="grid size-6 place-items-center rounded-md text-2xs text-ink-3 hover:text-danger"
              aria-label="حذف پارامتر"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {controlKind(param) === 'toggle' ? (
              <button
                type="button"
                role="switch"
                aria-checked={param.value >= 0.5}
                aria-label={param.label ?? name}
                onClick={() => {
                  const next = param.value >= 0.5 ? 0 : 1
                  onValue(name, next)
                  if (param.actions) onAction?.(name, param.actions)
                }}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md border px-2 text-2xs',
                  param.value >= 0.5 ? 'border-brand bg-brand/10 text-brand' : 'border-hairline bg-surface text-ink-3',
                )}
              >
                <span className={cn('h-3 w-3 rounded-full', param.value >= 0.5 ? 'bg-brand' : 'bg-hairline')} />
                {param.value >= 0.5 ? 'روشن' : 'خاموش'}
              </button>
            ) : controlKind(param) === 'select' ? (
              <select
                value={String(Math.round(param.value))}
                aria-label={param.label ?? name}
                onChange={(e) => {
                  const next = parseInt(e.target.value, 10)
                  if (!Number.isNaN(next)) onValue(name, next)
                }}
                className="h-7 rounded-md border border-hairline bg-surface px-1.5 text-2xs"
              >
                {(param.options ?? []).map((o, i) => (
                  <option key={`${o}-${i}`} value={i}>
                    {o}
                  </option>
                ))}
              </select>
            ) : controlKind(param) === 'button' ? (
              <button
                type="button"
                aria-label={param.label ?? name}
                onClick={() => {
                  const back = param.resetTo ?? 0
                  onValue(name, param.value === back ? 1 : back)
                  if (param.actions) onAction?.(name, param.actions)
                }}
                className="h-7 rounded-md border border-hairline bg-surface px-2 text-2xs hover:border-brand/50 hover:text-brand"
              >
                {param.label ?? name}
              </button>
            ) : param.slider !== false ? (
              <input
                type="range"
                min={param.min ?? 0}
                max={param.max ?? 10}
                step={param.step ?? 0.1}
                value={param.value}
                onChange={(e) => onParam(name, { value: parseFloat(e.target.value) })}
                className="h-1 flex-1 accent-brand"
                aria-label={param.label ?? name}
              />
            ) : (
              <input
                type="number"
                step={param.step ?? 0.1}
                value={param.value}
                onChange={(e) => onParam(name, { value: parseFloat(e.target.value) })}
                className="h-7 w-20 rounded-md border border-hairline bg-surface px-1.5 text-2xs tabular-nums"
              />
            )}
            <span className="tabular-nums text-2xs text-ink-3">{toFaDigits(String(param.value))}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function TemplateGallery({ onInsert }: { onInsert: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-1 p-2">
      {BUILTIN_TEMPLATES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onInsert(t.id)}
          className="rounded-lg border border-hairline px-2 py-1.5 text-start transition hover:border-brand/50 hover:bg-brand-soft/40"
        >
          <span className="block text-xs font-bold text-ink-2">{t.name}</span>
          <span className="block truncate text-[10px] text-ink-3">{t.description}</span>
        </button>
      ))}
    </div>
  )
}

export type { PropSpec, NumProp }