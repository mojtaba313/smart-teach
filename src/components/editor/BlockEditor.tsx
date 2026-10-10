'use client'
import { useState } from 'react'
import { ChevronDown, ChevronUp, Eye, Plus, Trash2 } from 'lucide-react'
import type { AnimLayer, AnimPanel, AnimSeries, Animation, SlideStep, StepKind } from '../../types'
import { KIND_ACCENT, KIND_LABEL, SCHEMA_VERSION, emptyAnimation, newLayer, newSeries, uid } from '../../types'
import { cn, toFaDigits } from '../../lib/utils'

const BLOCK_KINDS: StepKind[] = ['text', 'list', 'formula', 'callout', 'trap', 'image', 'video', 'code', 'quiz', 'animation']
import { Badge, Button, Field, IconButton, Input, Segmented, Select, Switch, Textarea } from '../ui/primitives'
import { Menu, type MenuItem } from '../ui/overlay'

/**
 * A real block editor — add, reorder, edit, delete — for anywhere a list of
 * teaching blocks is needed.
 *
 * It exists because three places need the same thing and the answer key is
 * the important one: a worked solution that can only be a textarea is not a
 * solution, it is a note. So this supports every block kind, animations
 * included, with a live preview of what the student will actually see.
 */

export function BlockEditor({
  blocks,
  onChange,
  emptyHint,
  addLabel = 'افزودن کادر',
}: {
  blocks: SlideStep[]
  onChange: (next: SlideStep[]) => void
  emptyHint?: string
  addLabel?: string
}) {
  const [open, setOpen] = useState<string | null>(null)

  const patch = (id: string, next: SlideStep) => onChange(blocks.map((b) => (b.id === id ? { ...next, id } : b)))
  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    const next = [...blocks]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const add = (kind: StepKind) => {
    const b = blankBlock(kind)
    onChange([...blocks, b])
    setOpen(b.id)
  }

  if (blocks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline px-3 py-4 text-center">
        <p className="text-2xs text-ink-3">{emptyHint ?? 'هنوز کادری نیست.'}</p>
        <AddButton onAdd={add} className="mt-2" label={addLabel} />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {blocks.map((b, i) => (
        <div
          key={b.id}
          className="rounded-xl border border-hairline bg-surface/70"
          style={{ ['--k-accent' as string]: KIND_ACCENT[b.kind] }}
        >
          <div className="flex items-center gap-1.5 border-b border-hairline px-2 py-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: KIND_ACCENT[b.kind] }} />
            <span className="text-2xs font-black text-ink-2">{KIND_LABEL[b.kind]}</span>
            <Badge>{b.span === 'full' ? 'تمام‌عرض' : b.span === 'half' ? 'نصف' : 'یک‌سوم'}</Badge>
            <span className="ms-auto flex items-center gap-0.5">
              <IconButton icon={ChevronUp} label="بالا" size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton icon={ChevronDown} label="پایین" size="sm" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} />
              <IconButton
                icon={open === b.id ? Eye : ChevronDown}
                label={open === b.id ? 'بستن ویرایش' : 'ویرایش'}
                size="sm"
                active={open === b.id}
                onClick={() => setOpen(open === b.id ? null : b.id)}
              />
              <IconButton icon={Trash2} label="حذف کادر" size="sm" variant="danger" onClick={() => remove(b.id)} />
            </span>
          </div>

          {open === b.id ? (
            <div className="space-y-2 p-2.5">
              <div className="grid grid-cols-2 gap-2">
                <Field label="نوع">
                  <Select
                    value={b.kind}
                    onChange={(e) => {
                      const next = blankBlock(e.target.value as StepKind)
                      onChange(blocks.map((x) => (x.id === b.id ? { ...next, id: b.id } : x)))
                    }}
                    className="h-8 text-xs"
                  >
                    {BLOCK_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="عرض">
                  <Segmented
                    size="sm"
                    label="عرض"
                    value={b.span}
                    onChange={(v) => patch(b.id, { ...b, span: v as SlideStep['span'] })}
                    options={[
                      { value: 'full', label: 'تمام' },
                      { value: 'half', label: 'نصف' },
                      { value: 'third', label: 'سوم' },
                    ]}
                  />
                </Field>
              </div>
              <BlockFields step={b} onChange={(n) => patch(b.id, n)} />
            </div>
          ) : (
            <div className="px-2.5 py-2">
              <Preview step={b} />
            </div>
          )}
        </div>
      ))}
      <AddButton onAdd={add} label={addLabel} />
    </div>
  )
}

function AddButton({ onAdd, className, label = 'افزودن کادر' }: { onAdd: (k: StepKind) => void; className?: string; label?: string }) {
  const items: MenuItem[] = BLOCK_KINDS.map((k) => ({
    type: 'item',
    key: k,
    label: KIND_LABEL[k],
    onSelect: () => onAdd(k),
  }))
  return (
    <Menu
      label={label}
      align="start"
      items={items}
      triggerClassName={cn('h-8 w-8 rounded-lg border border-dashed border-hairline', className)}
    />
  )
}

/** A compact, read-only look at what the block will render as. */
function Preview({ step }: { step: SlideStep }) {
  if (step.kind === 'animation') {
    return <p className="truncate text-2xs text-ink-3">{step.anim.title || 'صحنهٔ بی‌عنوان'} — {step.anim.duration} ثانیه</p>
  }
  const text = 'value' in step ? step.value : step.kind === 'list' ? step.items.join(' · ') : step.kind === 'quiz' ? step.question : ''
  return (
    <p className="line-clamp-2 text-2xs leading-5 text-ink-2">
      {text?.replace(/\$[^$]*\$/g, '') || <span className="text-ink-3">— خالی —</span>}
    </p>
  )
}

/* ------------------------------------------------------------------ *
 *  Fields
 * ------------------------------------------------------------------ */

function BlockFields({ step, onChange }: { step: SlideStep; onChange: (n: SlideStep) => void }) {
  // The union narrows inside each case, so a key that is not on every member
  // cannot be typed generically; the spread below is the whole record.
  const set = (k: string, v: unknown) => onChange({ ...step, [k]: v } as SlideStep)
  const t = 'h-8 text-xs'

  switch (step.kind) {
    case 'text':
    case 'formula':
    case 'code':
    case 'image':
    case 'video':
      return (
        <>
          <Field label={step.kind === 'image' || step.kind === 'video' ? 'آدرس' : 'متن'}>
            <Input value={step.value} onChange={(e) => set('value', e.target.value)} className={t} dir="auto" />
          </Field>
          {(step.kind === 'image' || step.kind === 'video' || step.kind === 'code') && (
            <Field label="توضیح زیر کادر">
              <Input value={step.caption ?? ''} onChange={(e) => set('caption', e.target.value)} className={t} />
            </Field>
          )}
          {step.kind === 'text' && <Hint>می‌توانید **پررنگ**، $فرمول$ و `کد` بنویسید.</Hint>}
        </>
      )
    case 'trap':
      return (
        <>
          <Field label="دام">
            <Textarea value={step.value} onChange={(e) => set('value', e.target.value)} className="text-xs" dir="auto" />
          </Field>
          <Hint>مهم‌ترین بخش آموزشی: دقیقاً بنویسید دانش‌آموز کجا اشتباه می‌کند.</Hint>
        </>
      )
    case 'callout':
      return (
        <>
          <Field label="متن کادر">
            <Textarea value={step.value} onChange={(e) => set('value', e.target.value)} className="text-xs" dir="auto" />
          </Field>
          <Field label="لحن">
            <Segmented
              size="sm"
              label="لحن"
              value={step.tone}
              onChange={(v) => set('tone', v as never)}
              options={[
                { value: 'info', label: 'نکته' },
                { value: 'tip', label: 'ترفند' },
                { value: 'warn', label: 'هشدار' },
                { value: 'idea', label: 'ایده' },
              ]}
            />
          </Field>
        </>
      )
    case 'list':
      return (
        <>
          {step.items.map((it, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={it}
                onChange={(e) => set('items', step.items.map((x, j) => (j === i ? e.target.value : x)))}
                className={t}
                dir="auto"
              />
              <IconButton icon={Trash2} label={`حذف مورد ${i + 1}`} size="sm" onClick={() => set('items', step.items.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="xs" variant="subtle" icon={Plus} onClick={() => set('items', [...step.items, ''])}>
            مورد تازه
          </Button>
          <Switch checked={step.ordered === true} onChange={(v) => set('ordered', v)} label="شماره‌دار باشد" />
        </>
      )
    case 'quiz':
      return (
        <>
          <Field label="صورت سؤال">
            <Textarea value={step.question} onChange={(e) => set('question', e.target.value)} className="text-xs" dir="auto" />
          </Field>
          {step.options.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Select
                value={String(step.answerIndex === i)}
                onChange={() => set('answerIndex', i)}
                className="h-8 w-8 shrink-0 text-xs"
              >
                <option value="false">۱</option>
                <option value="true">✓</option>
              </Select>
              <Input
                value={o}
                onChange={(e) => set('options', step.options.map((x, j) => (j === i ? e.target.value : x)))}
                className={t}
                dir="auto"
              />
            </div>
          ))}
        </>
      )
    case 'animation':
      return <AnimationFields anim={step.anim} onChange={(a) => set('anim', a)} />
  }
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] leading-4 text-ink-3">{children}</p>
}

/* ------------------------------------------------------------------ *
 *  Animation — enough to build a real scene without leaving the editor
 * ------------------------------------------------------------------ */

function AnimationFields({ anim, onChange }: { anim: Animation; onChange: (a: Animation) => void }) {
  const scene = anim.scene
  const setScene = <K extends keyof Animation['scene']>(k: K, v: Animation['scene'][K]) =>
    onChange({ ...anim, scene: { ...scene, [k]: v } })
  const t = 'h-8 text-xs'

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <Field label="عنوان">
          <Input value={anim.title} onChange={(e) => onChange({ ...anim, title: e.target.value })} className={t} />
        </Field>
        <Field label="مدت (ثانیه)">
          <Input
            type="number"
            value={anim.duration}
            step={0.5}
            min={0.5}
            onChange={(e) => onChange({ ...anim, duration: Math.max(0.2, Number(e.target.value) || 1) })}
            className={t}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Switch checked={anim.loop} onChange={(v) => onChange({ ...anim, loop: v })} label="تکرار" />
        <Switch checked={anim.autoplay} onChange={(v) => onChange({ ...anim, autoplay: v })} label="پخش خودکار" />
        <Switch checked={scene.showAxes} onChange={(v) => setScene('showAxes', v)} label="محور" />
        <Switch checked={scene.showGrid} onChange={(v) => setScene('showGrid', v)} label="شبکه" />
        <Switch checked={scene.plotSpace === 'free'} onChange={(v) => setScene('plotSpace', v ? 'free' : 'time')} label="صحنهٔ شکل (بدون محور)" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="x کمینه"><Input type="number" value={scene.xMin} onChange={(e) => setScene('xMin', Number(e.target.value))} className={t} /></Field>
        <Field label="x بیشینه"><Input type="number" value={scene.xMax} onChange={(e) => setScene('xMax', Number(e.target.value))} className={t} /></Field>
        <Field label="y کمینه"><Input type="number" value={scene.yMin} onChange={(e) => setScene('yMin', Number(e.target.value))} className={t} /></Field>
        <Field label="y بیشینه"><Input type="number" value={scene.yMax} onChange={(e) => setScene('yMax', Number(e.target.value))} className={t} /></Field>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs font-black text-ink-3">اشیاء ({toFaDigits(anim.layers.length)})</span>
          <Button
            size="xs"
            variant="subtle"
            icon={Plus}
            className="ms-auto"
            onClick={() => onChange({ ...anim, layers: [...anim.layers, newLayer({ mode: 'key', tracks: { x: [{ id: uid('k'), t: 0, v: 0, interp: 'linear' }], y: [{ id: uid('k'), t: 0, v: 0, interp: 'linear' }], size: [{ id: uid('k'), t: 0, v: 0.2, interp: 'linear' }] } })] })}
          >
            شیء
          </Button>
        </div>
        {anim.layers.map((l, i) => (
          <LayerRow
            key={l.id}
            layer={l}
            onChange={(n) => onChange({ ...anim, layers: anim.layers.map((x, j) => (j === i ? n : x)) })}
            onRemove={() => onChange({ ...anim, layers: anim.layers.filter((_, j) => j !== i) })}
          />
        ))}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs font-black text-ink-3">منحنی‌ها ({toFaDigits(anim.series.length)})</span>
          <Button
            size="xs"
            variant="subtle"
            icon={Plus}
            className="ms-auto"
            onClick={() => onChange({ ...anim, series: [...anim.series, newSeries({ expr: 't', reveal: true })] })}
          >
            منحنی
          </Button>
        </div>
        {anim.series.map((s, i) => (
          <SeriesRow
            key={s.id}
            series={s}
            onChange={(n) => onChange({ ...anim, series: anim.series.map((x, j) => (j === i ? n : x)) })}
            onRemove={() => onChange({ ...anim, series: anim.series.filter((_, j) => j !== i) })}
          />
        ))}
      </div>

      <Hint>برای کار کامل با صحنه (کی‌فریم، مسیر، بردار) کادر را در ارائه بگذارید و «استودیوی انیمیشن» را بزنید.</Hint>
    </div>
  )
}

const SHAPE_LABEL: Record<string, string> = { circle: 'دایره', square: 'مربع', triangle: 'مثلث', arrow: 'پیکان', car: 'خودرو', ball: 'توپ' }

function LayerRow({ layer, onChange, onRemove }: { layer: AnimLayer; onChange: (l: AnimLayer) => void; onRemove: () => void }) {
  const t = 'h-8 text-xs'
  const x = layer.tracks.x?.[0]?.v ?? 0
  const y = layer.tracks.y?.[0]?.v ?? 0
  const size = layer.tracks.size?.[0]?.v ?? 0.2
  const put = (prop: 'x' | 'y' | 'size', v: number) =>
    onChange({ ...layer, tracks: { ...layer.tracks, [prop]: [{ id: uid('k'), t: 0, v, interp: 'linear' }] } })

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-sunken/60 p-1.5">
      <Input value={layer.name} onChange={(e) => onChange({ ...layer, name: e.target.value })} className={cn(t, 'w-24')} />
      <Select value={layer.shape} onChange={(e) => onChange({ ...layer, shape: e.target.value as never })} className={cn(t, 'w-24')}>
        {Object.entries(SHAPE_LABEL).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </Select>
      <input type="color" value={layer.color} onChange={(e) => onChange({ ...layer, color: e.target.value })} className="size-7 rounded border border-hairline" aria-label="رنگ" />
      <Input type="number" step={0.5} value={x} onChange={(e) => put('x', Number(e.target.value))} className={cn(t, 'w-16')} aria-label="x" />
      <Input type="number" step={0.5} value={y} onChange={(e) => put('y', Number(e.target.value))} className={cn(t, 'w-16')} aria-label="y" />
      <Input type="number" step={0.05} value={size} onChange={(e) => put('size', Number(e.target.value))} className={cn(t, 'w-16')} aria-label="اندازه" />
      <IconButton icon={Trash2} label="حذف شیء" size="sm" onClick={onRemove} />
    </div>
  )
}

function SeriesRow({ series, onChange, onRemove }: { series: AnimSeries; onChange: (s: AnimSeries) => void; onRemove: () => void }) {
  const t = 'h-8 text-xs'
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-sunken/60 p-1.5">
      <Input value={series.label} onChange={(e) => onChange({ ...series, label: e.target.value })} className={cn(t, 'w-24')} />
      <Input value={series.expr} onChange={(e) => onChange({ ...series, expr: e.target.value })} className={cn(t, 'w-28 font-mono')} dir="ltr" />
      <input type="color" value={series.color} onChange={(e) => onChange({ ...series, color: e.target.value })} className="size-7 rounded border border-hairline" aria-label="رنگ" />
      <Switch checked={series.reveal} onChange={(v) => onChange({ ...series, reveal: v })} label="تدریجی" />
      <Switch checked={!!series.tangent} onChange={(v) => onChange({ ...series, tangent: v })} label="مماس" />
      <IconButton icon={Trash2} label="حذف منحنی" size="sm" onClick={onRemove} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Factory
 * ------------------------------------------------------------------ */

export function blankBlock(kind: StepKind): SlideStep {
  const base = { id: uid('step'), span: 'full' as const }
  switch (kind) {
    case 'list':
      return { ...base, kind, items: [''], ordered: false }
    case 'callout':
      return { ...base, kind, value: '', tone: 'info' }
    case 'quiz':
      return { ...base, kind, question: '', options: ['', ''], answerIndex: 0 }
    case 'animation':
      return { ...base, kind, anim: emptyAnimation() }
    default:
      return { ...base, kind, value: '' } as SlideStep
  }
}

export { SCHEMA_VERSION }
export type { AnimPanel }