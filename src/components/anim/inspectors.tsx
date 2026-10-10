import { useMemo } from 'react'
import { Crosshair, Eye, EyeOff, LineChart, Plus, Shapes, Sparkles, Trash2, Wand2 } from 'lucide-react'
import type { AnimPanel, Animation, AnimLayer, AnimSeries, AnimShape, SeriesStyle } from '../../types'
import {
  ANIM_PROPS,
  ANIM_PROP_LABEL,
  ANIM_SHAPES,
  ANIM_SHAPE_LABEL,
  INTERP_LABEL,
  SERIES_STYLE_LABEL,
  newLayer,
  newSeries,
  uid,
} from '../../types'
import { check, EXPR_EXAMPLES, EXPR_FUNCS } from '../../lib/anim/expr'
import { currentValue, fitDomains, scenePanels, seriesLookupOf, withoutKey, withKey } from '../../lib/anim/engine'
import { PATH_PRESETS } from '../../lib/anim/presets'
import { cn, parseNum, pick, round, toFaDigits } from '../../lib/utils'
import { Badge, Button, Field, IconButton, Input, Segmented, Select, Switch } from '../ui/primitives'

/** A sensible starting vertical domain for the n-th panel of an animation. */
function panelDefaults(anim: Animation, i: number): AnimPanel {
  const fit = fitDomains(anim)
  const titles = ['x (m)', 'v (m/s)', 'a (m/s²)', '']
  const span = Math.max(1, fit.yMax - fit.yMin)
  return {
    id: `p${i + 1}`,
    title: titles[i] ?? '',
    yMin: Math.round(fit.yMin - span * 0.1),
    yMax: Math.round(fit.yMax + span * 0.1),
    yTicks: 4,
  }
}

/* ------------------------------------------------------------------ *
 *  Small controls
 * ------------------------------------------------------------------ */

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
      <span className="truncate text-2xs font-bold text-ink-3" title={hint ?? label}>
        {label}
      </span>
      {children}
    </div>
  )
}

function Num({
  value,
  onChange,
  step = 1,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  suffix?: string
}) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        value={Number.isFinite(value) ? round(value, 4) : 0}
        step={step}
        onChange={(e) => {
          const v = parseNum(e.target.value)
          onChange(Number.isFinite(v) ? v : 0)
        }}
        className="h-8 w-full min-w-0 rounded-lg border border-hairline bg-surface px-2 text-xs font-bold tabular-nums outline-none focus:border-brand/70"
      />
      {suffix && <span className="shrink-0 text-2xs text-ink-3">{suffix}</span>}
    </span>
  )
}

function ExprField({
  label,
  value,
  onChange,
  t,
  exampleSet,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  t: number
  exampleSet?: number
}) {
  const result = useMemo(() => check(value), [value])
  const preview = useMemo(() => (result.ok ? round(result.fn(t), 3) : null), [result, t])
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-2xs font-bold text-ink-3">{label}</label>
        <span className={cn('font-mono text-2xs font-black tabular-nums', result.ok ? 'text-ok' : 'text-danger')}>
          {result.ok ? `= ${toFaDigits(String(preview))}` : '—'}
        </span>
      </div>
      <input
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={cn(
          'h-8 w-full rounded-lg border bg-surface px-2 text-start font-mono text-xs outline-none transition focus:ring-2',
          result.ok ? 'border-hairline focus:border-brand/70 focus:ring-brand/20' : 'border-danger/60 focus:border-danger',
        )}
      />
      {!result.ok && <p className="text-2xs leading-5 text-danger">{result.error}</p>}
      {exampleSet !== undefined && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {EXPR_EXAMPLES.filter((_, i) => i % 3 === exampleSet).map((ex) => (
            <button
              key={ex.expr}
              type="button"
              onClick={() => onChange(ex.expr)}
              title={ex.label}
              className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-3 transition hover:bg-brand-soft hover:text-brand"
              dir="ltr"
            >
              {ex.expr}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-b border-hairline px-3.5 py-3 last:border-0">
      <header className="flex items-center gap-2">
        <h3 className="text-2xs font-black uppercase tracking-wide text-ink-3">{title}</h3>
        {action && <div className="ms-auto">{action}</div>}
      </header>
      {children}
    </section>
  )
}

const COLORS = ['#e11d48', '#f97316', '#d97706', '#059669', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#0f172a']

function ColorSwatches({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`رنگ ${c}`}
          aria-pressed={value.toLowerCase() === c.toLowerCase()}
          onClick={() => onChange(c)}
          className={cn(
            'size-5 rounded-full border-2 transition',
            value.toLowerCase() === c.toLowerCase() ? 'scale-110 border-ink' : 'border-transparent hover:scale-110',
          )}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="رنگ دلخواه"
        className="size-6 cursor-pointer rounded-md border border-hairline bg-transparent p-0"
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Layer inspector
 * ------------------------------------------------------------------ */

export function LayerInspector({
  layer,
  anim,
  t,
  onChange,
  onRemove,
}: {
  layer: AnimLayer
  anim: Animation
  t: number
  onChange: (next: AnimLayer) => void
  onRemove: () => void
}) {
  const lookup = useMemo(() => seriesLookupOf(anim), [anim])
  const set = <K extends keyof AnimLayer>(k: K, v: AnimLayer[K]) => onChange({ ...layer, [k]: v })
  const seriesOptions = anim.series.map((s) => ({ value: s.id, label: s.label || s.expr }))
  const panelOptions = scenePanels(anim).filter((p) => p.id)
  const patchPath = (i: number, patch: { x?: number; y?: number }) => {
    const path = layer.path ?? { points: [] }
    set('path', { ...path, points: path.points.map((pt, j) => (j === i ? { ...pt, ...patch } : pt)) })
  }

  return (
    <>
      <Section
        title="جسم"
        action={
          <div className="flex items-center gap-0.5">
            <IconButton
              icon={layer.visible ? Eye : EyeOff}
              label={layer.visible ? 'پنهان کردن' : 'نمایش'}
              size="sm"
              active={layer.visible}
              onClick={() => set('visible', !layer.visible)}
            />
            <IconButton icon={Trash2} label="حذف جسم" size="sm" variant="danger" onClick={onRemove} />
          </div>
        }
      >
        <Row label="نام">
          <Input value={layer.name} onChange={(e) => set('name', e.target.value)} className="h-8 text-xs" />
        </Row>
        <Row label="شکل">
          <Select value={layer.shape} onChange={(e) => set('shape', e.target.value as AnimShape)} className="h-8 text-xs">
            {ANIM_SHAPES.map((s) => (
              <option key={s} value={s}>
                {ANIM_SHAPE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="رنگ">
          <ColorSwatches value={layer.color} onChange={(v) => set('color', v)} />
        </Row>
        <Row label="برچسب">
          <Input
            value={layer.label ?? ''}
            onChange={(e) => set('label', e.target.value)}
            placeholder="اختیاری"
            className="h-8 text-xs"
          />
        </Row>
      </Section>

      <Section title="روش حرکت">
        <Segmented
          size="sm"
          label="روش حرکت"
          value={layer.mode}
          onChange={(v) => set('mode', v)}
          options={[
            { value: 'key', label: 'کی‌فریم' },
            { value: 'expr', label: 'فرمول' },
            { value: 'follow', label: 'روی نمودار' },
            { value: 'path', label: 'مسیر' },
          ]}
        />

        {layer.mode === 'expr' && (
          <div className="space-y-2 rounded-xl bg-sunken/60 p-2.5">
            <ExprField label="x(t)" value={layer.exprX} onChange={(v) => set('exprX', v)} t={t} exampleSet={0} />
            <ExprField label="y(t)" value={layer.exprY} onChange={(v) => set('exprY', v)} t={t} exampleSet={1} />
            <p className="text-[10px] leading-4 text-ink-3">
              متغیر <span className="font-mono">t</span> زمان بر حسب ثانیه است.
              <span className="mt-1 block font-mono text-[10px] leading-4 opacity-80" dir="ltr">
                {EXPR_FUNCS.slice(0, 14).join(' · ')}
              </span>
            </p>
          </div>
        )}

        {layer.mode === 'path' && (
          <div className="space-y-2 rounded-xl bg-sunken/60 p-2.5">
            <Field label="نقاط مسیر" hint="با کلیک روی صحنه اضافه می‌شود">
              <span className="text-2xs text-ink-3">
                {layer.path?.points.length ? `${toFaDigits(layer.path.points.length)} نقطه` : 'هنوز نقطه‌ای نیست'}
              </span>
            </Field>
            <div className="max-h-40 space-y-1 overflow-y-auto scroll-thin pe-0.5">
              {(layer.path?.points ?? []).map((pt, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="w-5 shrink-0 text-center font-mono text-2xs text-ink-3">{toFaDigits(i + 1)}</span>
                  <Num value={pt.x} step={0.5} onChange={(v) => patchPath(i, { x: v })} />
                  <Num value={pt.y} step={0.5} onChange={(v) => patchPath(i, { y: v })} />
                  <IconButton
                    icon={Trash2}
                    label={`حذف نقطهٔ ${i + 1}`}
                    size="sm"
                    onClick={() => set('path', { ...(layer.path ?? { points: [] }), points: (layer.path?.points ?? []).filter((_, j) => j !== i) })}
                  />
                </div>
              ))}
            </div>
            <Switch
              checked={!!layer.path?.closed}
              onChange={(v) => set('path', { ...(layer.path ?? { points: [] }), closed: v })}
              label="مسیر بسته است (حلقه)"
            />
            <Switch
              checked={layer.path?.show !== false}
              onChange={(v) => set('path', { ...(layer.path ?? { points: [] }), show: v })}
              label="نمایش مسیر روی صحنه"
            />
            {layer.path?.points.length ? (
              <Button
                size="xs"
                variant="subtle"
                onClick={() => set('path', undefined)}
              >
                حذف مسیر
              </Button>
            ) : (
              <>
                <p className="text-[10px] leading-4 text-ink-3">
                  حالت «مسیر» را انتخاب کنید و بعد روی صحنه کلیک کنید تا مسیر را
                  نقطه‌به‌نقطه رسم کنید. برای حلقه، انتهای مسیر را روی نقطهٔ اول ببندید.
                </p>
                <div className="flex flex-wrap gap-1 pt-1">
                  {PATH_PRESETS.map((p) => (
                    <Button key={p.label} size="xs" variant="subtle" onClick={() => set('path', { ...p.path })}>
                      {p.label}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {layer.mode === 'follow' && (
          <div className="space-y-2 rounded-xl bg-sunken/60 p-2.5">
            <Field label="شیء روی کدام منحنی بنشیند؟">
              <Select
                value={layer.follow ?? ''}
                onChange={(e) => set('follow', e.target.value)}
                className="h-8 text-xs"
              >
                <option value="">— انتخاب کنید —</option>
                {seriesOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-[10px] leading-4 text-ink-3">
              در حالت «زمان روی محور افقی»، جای افقی جسم برابر t و جای عمودی برابر مقدار منحنی می‌شود.
            </p>
          </div>
        )}
      </Section>

      <Section title="نمایش بردارها">
        <Switch checked={layer.showTrail} onChange={(v) => set('showTrail', v)} label="ردِ حرکت" />
        <Switch
          checked={layer.showVelocity}
          onChange={(v) => set('showVelocity', v)}
          label="بردار سرعت (v)"
        />
        <Switch
          checked={layer.showAcceleration}
          onChange={(v) => set('showAcceleration', v)}
          label="بردار شتاب (a)"
        />
        <Switch
          checked={!!layer.vectors?.decomposition}
          onChange={(v) => set('vectors', { ...layer.vectors, decomposition: v, acceleration: v })}
          label="تجزیهٔ a به aₜ و aₙ"
          hint="مولفهٔ مماسی (تغییر اندازهٔ سرعت) و مولفهٔ نرمال (تغییر جهت) — برای حرکت مارپیچ"
        />
        {(layer.showVelocity || layer.showAcceleration || layer.vectors?.decomposition) && (
          <Row label="طول بردار" hint="پیکسل به ازای هر واحد بر ثانیه">
            <Num value={layer.vectorScale} step={1} suffix="px" onChange={(v) => set('vectorScale', Math.max(0, v))} />
          </Row>
        )}

        <div className="mt-2 rounded-xl border border-hairline bg-sunken/50 p-2.5">
          <Switch
            checked={!!layer.positionVector}
            onChange={(v) => set('positionVector', v ? { from: 'origin', label: 'r' } : undefined)}
            label="بردار مکان (از مبدأ تا جسم)"
          />
          {layer.positionVector && (
            <div className="mt-2 space-y-2">
              <Row label="مبدأ بردار">
                <Select
                  value={layer.positionVector.from === 'origin' || !layer.positionVector.from ? 'origin' : 'custom'}
                  onChange={(e) =>
                    set('positionVector', {
                      ...layer.positionVector!,
                      from: e.target.value === 'origin' ? 'origin' : { x: 0, y: 0 },
                    })
                  }
                  className="h-8 text-xs"
                >
                  <option value="origin">مبدأ مختصات (0, 0)</option>
                  <option value="custom">نقطهٔ دلخواه</option>
                </Select>
              </Row>
              {layer.positionVector.from !== 'origin' && layer.positionVector.from && (
                <div className="grid grid-cols-2 gap-1.5">
                  <Row label="x مبدأ">
                    <Num
                      value={(layer.positionVector.from as { x: number; y: number }).x}
                      step={1}
                      onChange={(v) =>
                        set('positionVector', {
                          ...layer.positionVector!,
                          from: { ...(layer.positionVector!.from as { x: number; y: number }), x: v },
                        })
                      }
                    />
                  </Row>
                  <Row label="y مبدأ">
                    <Num
                      value={(layer.positionVector.from as { x: number; y: number }).y}
                      step={1}
                      onChange={(v) =>
                        set('positionVector', {
                          ...layer.positionVector!,
                          from: { ...(layer.positionVector!.from as { x: number; y: number }), y: v },
                        })
                      }
                    />
                  </Row>
                </div>
              )}
              <Row label="رنگ و برچسب">
                <span className="flex items-center gap-1.5">
                  <ColorSwatches value={layer.positionVector.color ?? layer.color} onChange={(v) => set('positionVector', { ...layer.positionVector!, color: v })} />
                  <Input
                    value={layer.positionVector.label ?? ''}
                    onChange={(e) => set('positionVector', { ...layer.positionVector!, label: e.target.value })}
                    className="h-8 text-xs"
                    dir="ltr"
                    placeholder="r"
                  />
                </span>
              </Row>
              <Switch
                checked={!!layer.positionVector.dashed}
                onChange={(v) => set('positionVector', { ...layer.positionVector!, dashed: v })}
                label="خط‌چین"
              />
            </div>
          )}
        </div>
      </Section>

      {panelOptions.length > 1 && (
        <Section title="جای جسم">
          <Row label="در کدام نمودار؟">
            <Select value={layer.panel ?? '0'} onChange={(e) => set('panel', e.target.value === '0' ? undefined : e.target.value)} className="h-8 text-xs">
              <option value="0">— پیش‌فرض —</option>
              {panelOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title || o.id}
                </option>
              ))}
              <option value="*">در همهٔ نمودارها</option>
            </Select>
          </Row>
        </Section>
      )}

      {layer.mode === 'key' && (
        <Section
          title="کی‌فریم‌ها"
          action={
            <Button
              size="xs"
              variant="subtle"
              icon={Plus}
              onClick={() => {
                let next = layer
                for (const prop of ANIM_PROPS) {
                  const has = (layer.tracks[prop] ?? []).length > 0
                  next = withKey(next, prop, t, lookup)
                  if (!has && (prop === 'x' || prop === 'y')) continue
                }
                onChange(next)
              }}
            >
              افزودن در لحظهٔ فعلی
            </Button>
          }
        >
          {ANIM_PROPS.filter((p) => p === 'x' || p === 'y' || (layer.tracks[p] ?? []).length > 0).map((prop) => {
            const keys = layer.tracks[prop] ?? []
            const value = currentValue(layer, prop, t, lookup)
            return (
              <div key={prop} className="space-y-1.5 rounded-xl border border-hairline bg-surface p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-2xs font-black text-ink-2">{ANIM_PROP_LABEL[prop]}</span>
                  <span className="ms-auto font-mono text-2xs font-bold tabular-nums text-brand">
                    {toFaDigits(round(value, 2))}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Num value={value} step={0.5} onChange={(v) => onChange(withKey(layer, prop, t, lookup, { v }))} />
                  <Button
                    size="xs"
                    variant="subtle"
                    icon={Crosshair}
                    onClick={() => onChange(withKey(layer, prop, t, lookup, { v: value }))}
                  >
                    کی‌فریم
                  </Button>
                </div>
                {keys.length > 0 && (
                  <div className="space-y-1 pt-0.5">
                    {keys.map((k) => (
                      <div key={k.id} className="flex items-center gap-1.5 text-2xs">
                        <span className="w-9 shrink-0 text-center font-mono tabular-nums text-ink-3">
                          {toFaDigits(k.t.toFixed(2))}
                        </span>
                        <input
                          type="number"
                          step={0.5}
                          value={k.v}
                          onChange={(e) => {
                            const v = parseNum(e.target.value)
                            onChange(withKey(layer, prop, k.t, lookup, { v: Number.isFinite(v) ? v : 0 }))
                          }}
                          aria-label={`مقدار کی‌فریم ${ANIM_PROP_LABEL[prop]} در ${k.t}`}
                          className="h-6 w-14 rounded-md border border-hairline bg-surface px-1 text-center font-mono tabular-nums outline-none focus:border-brand/70"
                        />
                        <select
                          value={k.interp}
                          aria-label="نوع درون‌یابی"
                          onChange={(e) => onChange(withKey(layer, prop, k.t, lookup, { interp: e.target.value as never }))}
                          className="h-6 min-w-0 flex-1 rounded-md border border-hairline bg-surface px-1 text-[10px] font-bold outline-none"
                        >
                          {Object.entries(INTERP_LABEL).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <IconButton
                          icon={Trash2}
                          label="حذف کی‌فریم"
                          size="sm"
                          variant="danger"
                          onClick={() => onChange(withoutKey(layer, prop, k.id))}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </Section>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Series inspector
 * ------------------------------------------------------------------ */

export function SeriesInspector({
  series,
  t,
  index,
  panelOptions,
  onChange,
  onRemove,
}: {
  series: AnimSeries
  t: number
  index: number
  panelOptions: { id: string; title?: string }[]
  onChange: (next: AnimSeries) => void
  onRemove: () => void
}) {
  const set = <K extends keyof AnimSeries>(k: K, v: AnimSeries[K]) => onChange({ ...series, [k]: v })
  const result = check(series.expr)
  const value = result.ok ? round(result.fn(t), 3) : null

  return (
    <>
      <Section
        title={`منحنی ${toFaDigits(index + 1)}`}
        action={
          <div className="flex items-center gap-0.5">
            <IconButton
              icon={series.visible ? Eye : EyeOff}
              label={series.visible ? 'پنهان کردن' : 'نمایش'}
              size="sm"
              active={series.visible}
              onClick={() => set('visible', !series.visible)}
            />
            <IconButton icon={Trash2} label="حذف منحنی" size="sm" variant="danger" onClick={onRemove} />
          </div>
        }
      >
        <Row label="برچسب">
          <Input value={series.label} onChange={(e) => set('label', e.target.value)} className="h-8 text-xs" placeholder="v(t)" />
        </Row>
        <ExprField label="فرمول بر حسب t" value={series.expr} onChange={(v) => set('expr', v)} t={t} exampleSet={2} />
        <Row label="رنگ">
          <ColorSwatches value={series.color} onChange={(v) => set('color', v)} />
        </Row>
        <Row label="سبک">
          <Segmented
            size="sm"
            label="سبک خط"
            value={series.style}
            onChange={(v) => set('style', v as SeriesStyle)}
            options={Object.entries(SERIES_STYLE_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </Row>
        {panelOptions.length > 1 && (
          <Row label="در کدام نمودار؟">
            <Select value={series.panel ?? '0'} onChange={(e) => set('panel', e.target.value === '0' ? undefined : e.target.value)} className="h-8 text-xs">
              <option value="0">— پیش‌فرض —</option>
              {panelOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title || o.id}
                </option>
              ))}
            </Select>
          </Row>
        )}
        <Switch checked={series.reveal} onChange={(v) => set('reveal', v)} label="رسم تدریجی با زمان" />
        <Switch checked={!!series.secant} onChange={(v) => set('secant', v)} label="خط قاطع از t=0 (سرعت متوسط)" />
        <Switch checked={!!series.tangent} onChange={(v) => set('tangent', v)} label="خط مماس (سرعت لحظه‌ای)" />
        <Switch
          checked={series.window != null}
          onChange={(v) => set('window', v ? 0.5 : undefined)}
          label="پنجرهٔ میانگین Δt"
          hint="خط قاطع روی بازهٔ [t − Δt, t]؛ با کوچک‌شدن Δt روی خط مماس می‌افتد"
        />
        {typeof series.window === 'number' && (
          <Row label="Δt">
            <Num value={series.window} step={0.1} suffix="ث" onChange={(v) => set('window', Math.max(0.001, v))} />
          </Row>
        )}
        {typeof series.window === 'string' && (
          <ExprField label="Δt بر حسب t" value={series.window} onChange={(v) => set('window', v)} t={t} exampleSet={-1} />
        )}
        {value !== null && (
          <Badge tone="accent">
            مقدار در t = {toFaDigits(t.toFixed(2))} ثانیه: {toFaDigits(String(value))}
          </Badge>
        )}
      </Section>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Scene inspector
 * ------------------------------------------------------------------ */

export function SceneInspector({ anim, onChange }: { anim: Animation; onChange: (next: Animation) => void }) {
  const { scene } = anim
  const setScene = <K extends keyof Animation['scene']>(k: K, v: Animation['scene'][K]) =>
    onChange({ ...anim, scene: { ...scene, [k]: v } })
  const set = <K extends keyof Animation>(k: K, v: Animation[K]) => onChange({ ...anim, [k]: v })
  const panelCount = Math.max(1, scene.panels?.length ?? 1)
  const panels: AnimPanel[] = scene.panels ?? [panelDefaults(anim, 0)]
  const isGraph = scene.showAxes || scene.showGrid

  /** Figure mode: a free plane with no axes, framed on what is in it. */
  const toFigure = () => {
    const fit = fitDomains(anim)
    const cx = (fit.xMin + fit.xMax) / 2
    const cy = (fit.yMin + fit.yMax) / 2
    const half = Math.max(Math.abs(fit.xMax - fit.xMin) / 2, Math.abs(fit.yMax - fit.yMin) / 2) * 1.35 || 10
    onChange({
      ...anim,
      scene: {
        ...scene,
        plotSpace: 'free',
        showAxes: false,
        showGrid: false,
        xMin: round(cx - half, 1),
        xMax: round(cx + half, 1),
        yMin: round(cy - half, 1),
        yMax: round(cy + half, 1),
      },
    })
  }
  const toGraph = () => {
    const fit = fitDomains(anim)
    onChange({ ...anim, scene: { ...scene, plotSpace: 'time', showAxes: true, showGrid: true, ...pick(fit, ['xMin', 'xMax', 'yMin', 'yMax']) } })
  }

  const setPanelCount = (n: number) => {
    if (n <= 1) return setScene('panels', undefined)
    const current = scene.panels ?? [panelDefaults(anim, 0)]
    const next: AnimPanel[] = []
    for (let i = 0; i < n; i += 1) next.push(current[i] ?? panelDefaults(anim, i))
    setScene('panels', next)
  }
  const updatePanel = (i: number, patch: Partial<AnimPanel>) => {
    const current = scene.panels ?? [panelDefaults(anim, 0)]
    setScene('panels', current.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  }

  return (
    <>
      <Section title="زمان">
        <Row label="مدت" hint="طول انیمیشن بر حسب ثانیه">
          <Num value={anim.duration} step={0.5} suffix="ث" onChange={(v) => set('duration', Math.max(0.2, v))} />
        </Row>
        <Row label="سرعت">
          <Num value={anim.speed} step={0.25} suffix="×" onChange={(v) => set('speed', Math.max(0.1, v))} />
        </Row>
        <Switch checked={anim.loop} onChange={(v) => set('loop', v)} label="تکرار بی‌نهایت" />
        <Switch checked={anim.autoplay} onChange={(v) => set('autoplay', v)} label="پخش خودکار" />
        <Switch checked={anim.readout} onChange={(v) => set('readout', v)} label="نمایش مقدارهای زنده" />
      </Section>

      <Section title="حالت صحنه">
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="xs"
            variant={isGraph ? 'subtle' : 'primary'}
            icon={LineChart}
            onClick={() => toGraph()}
          >
            نمودار (محور و شبکه)
          </Button>
          <Button
            size="xs"
            variant={isGraph ? 'primary' : 'subtle'}
            icon={Shapes}
            onClick={() => toFigure()}
          >
            صحنهٔ شکل‌ها (بدون محور)
          </Button>
        </div>
        <p className="text-[10px] leading-4 text-ink-3">
          شکل‌های بارِدار، مدارها و شکل‌های هندسی به محور و شبکه نیازی ندارند.
          حالت شکل، محور و شبکه را خاموش و فضا را آزاد می‌کند و بازهٔ دید را روی
          شکل‌های موجود می‌چیند — برای ذرات بار‌دار، مدارها و شکل‌های هندسی.
        </p>
      </Section>

      <Section
        title="صحنه"
        action={
          <Button
            size="xs"
            variant="subtle"
            icon={Wand2}
            onClick={() => onChange({ ...anim, scene: { ...scene, ...fitDomains(anim) } })}
          >
            قاب‌بندی خودکار
          </Button>
        }
      >
        <Segmented
          size="sm"
          label="فضای محور افقی"
          value={scene.plotSpace}
          onChange={(v) => setScene('plotSpace', v)}
          options={[
            { value: 'time', label: 'زمان', title: 'محور افقی = t' },
            { value: 'free', label: 'آزاد', title: 'مختصات دلخواه' },
          ]}
        />

        {scene.plotSpace === 'free' && (
          <div className="grid grid-cols-2 gap-1.5">
            <Row label="x کمینه">
              <Num value={scene.xMin} step={1} onChange={(v) => setScene('xMin', v)} />
            </Row>
            <Row label="x بیشینه">
              <Num value={scene.xMax} step={1} onChange={(v) => setScene('xMax', v)} />
            </Row>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          <Row label="y کمینه">
            <Num value={scene.yMin} step={1} onChange={(v) => setScene('yMin', v)} />
          </Row>
          <Row label="y بیشینه">
            <Num value={scene.yMax} step={1} onChange={(v) => setScene('yMax', v)} />
          </Row>
        </div>

        <Row label="نسبت" hint="ارتفاع به عرض کادر">
          <Num value={scene.aspect} step={0.05} onChange={(v) => setScene('aspect', Math.max(0.2, Math.min(2, v)))} />
        </Row>

        <Row label="برچسب x">
          <Input value={scene.xLabel} onChange={(e) => setScene('xLabel', e.target.value)} className="h-8 text-xs" dir="ltr" />
        </Row>
        <Row label="برچسب y">
          <Input value={scene.yLabel} onChange={(e) => setScene('yLabel', e.target.value)} className="h-8 text-xs" dir="ltr" />
        </Row>

        <Row label="تعداد تیک">
          <span className="flex items-center gap-1">
            <Num value={scene.xTicks} onChange={(v) => setScene('xTicks', Math.max(2, Math.round(v)))} />
            <Num value={scene.yTicks} onChange={(v) => setScene('yTicks', Math.max(2, Math.round(v)))} />
          </span>
        </Row>

        <Switch checked={scene.showAxes} onChange={(v) => setScene('showAxes', v)} label="محورها" />
        <Switch checked={scene.showGrid} onChange={(v) => setScene('showGrid', v)} label="شبکه" />
      </Section>

      <Section
        title="نمودارهای روی هم"
        action={
          <span className="text-[10px] text-ink-3" title="چند نمودار با یک ساعت مشترک: مثلاً x(t) روی v(t) روی a(t)">
            ساعت مشترک
          </span>
        }
      >
        <Row label="تعداد">
          <span className="flex items-center gap-1">
            <Num
              value={scene.panels?.length ?? 1}
              step={1}
              onChange={(v) => setPanelCount(Math.max(1, Math.min(4, Math.round(v))))}
            />
            <Badge tone="accent">۱ = تک‌نمودار</Badge>
          </span>
        </Row>
        {panelCount > 1 && (
          <div className="mt-2 space-y-2">
            {panels.map((p, i) => (
              <div key={p.id} className="space-y-1.5 rounded-xl border border-hairline bg-sunken/50 p-2">
                <Row label={`عنوان ${toFaDigits(i + 1)}`}>
                  <Input
                    value={p.title ?? ''}
                    onChange={(e) => updatePanel(i, { title: e.target.value })}
                    className="h-8 text-xs"
                    dir="ltr"
                    placeholder="x (m)"
                  />
                </Row>
                <div className="grid grid-cols-2 gap-1.5">
                  <Row label="y کمینه">
                    <Num value={p.yMin} step={1} onChange={(v) => updatePanel(i, { yMin: v })} />
                  </Row>
                  <Row label="y بیشینه">
                    <Num value={p.yMax} step={1} onChange={(v) => updatePanel(i, { yMax: v })} />
                  </Row>
                </div>
              </div>
            ))}
            <p className="text-[10px] leading-4 text-ink-3">
              هر منحنی و هر جسم را از بخش خودش روی یکی از این نمودارها می‌نشانید.
            </p>
          </div>
        )}
      </Section>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Add menu
 * ------------------------------------------------------------------ */

export function AddSeriesButton({ onAdd }: { onAdd: (s: AnimSeries) => void }) {
  return (
    <Button
      size="sm"
      variant="subtle"
      icon={Plus}
      onClick={() => onAdd(newSeries({ id: uid('s'), label: 'y(t)', expr: '2*t' }))}
      block
    >
      افزودن منحنی
    </Button>
  )
}

export function AddLayerButton({ onAdd, colorIndex }: { onAdd: (l: AnimLayer) => void; colorIndex: number }) {
  return (
    <Button
      size="sm"
      variant="subtle"
      icon={Sparkles}
      onClick={() =>
        onAdd(
          newLayer({
            id: uid('layer'),
            name: `جسم ${toFaDigits(colorIndex + 1)}`,
            color: COLORS[colorIndex % COLORS.length],
            mode: 'expr',
            exprX: `${10 * (colorIndex + 1)}*t`,
            exprY: '0',
          }),
        )
      }
      block
    >
      افزودن جسم
    </Button>
  )
}
