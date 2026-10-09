import { useCallback, useMemo, useRef, useState } from 'react'
import { Magnet, Trash2 } from 'lucide-react'
import type { AnimKey, Animation } from '../../types'
import { ANIM_PROPS, ANIM_PROP_LABEL } from '../../types'
import { clamp, cn, snap, toFaDigits } from '../../lib/utils'
import { IconButton } from '../ui/primitives'

export type TimelineRow =
  | { type: 'prop'; id: string; layerId: string; layerName: string; color: string; prop: (typeof ANIM_PROPS)[number]; keys: AnimKey[] }
  | { type: 'series'; id: string; seriesId: string; label: string; color: string }
  | { type: 'layer'; id: string; layerId: string; layerName: string; color: string; keys: AnimKey[] }

export function buildRows(anim: Animation): TimelineRow[] {
  const rows: TimelineRow[] = []
  for (const layer of anim.layers) {
    if (!layer.visible) continue
    const keys = (layer.tracks.x ?? []).concat(layer.tracks.y ?? [])
    if (keys.length > 0) {
      rows.push({
        type: 'layer',
        id: `${layer.id}:pos`,
        layerId: layer.id,
        layerName: layer.name,
        color: layer.color,
        keys: [...(layer.tracks.x ?? []), ...(layer.tracks.y ?? [])].sort((a, b) => a.t - b.t),
      })
    }
    for (const prop of ANIM_PROPS) {
      if (prop === 'x' || prop === 'y') {
        if (layer.mode !== 'key') continue
        const k = layer.tracks[prop] ?? []
        if (k.length > 0) rows.push({ type: 'prop', id: `${layer.id}:${prop}`, layerId: layer.id, layerName: layer.name, color: layer.color, prop, keys: k })
        continue
      }
      const k = layer.tracks[prop] ?? []
      if (k.length > 0) {
        rows.push({ type: 'prop', id: `${layer.id}:${prop}`, layerId: layer.id, layerName: layer.name, color: layer.color, prop, keys: k })
      }
    }
  }
  return rows
}

export type TimelineProps = {
  anim: Animation
  t: number
  onSeek: (t: number) => void
  selectedLayerId: string | null
  onSelectLayer: (id: string) => void
  onMoveKey: (layerId: string, prop: string, keyId: string, t: number) => void
  onSelectKey: (layerId: string, prop: string, keyId: string) => void
  selectedKeyId: string | null
  onDeleteKey: () => void
  timeSnap: number
  onTimeSnapChange: (v: number) => void
}

const ROW_H = 30
/** Width of the row-label column. The ruler and the playhead must agree on it. */
const LABEL_W = '8rem'

export function Timeline({
  anim,
  t,
  onSeek,
  selectedLayerId,
  onSelectLayer,
  onMoveKey,
  onSelectKey,
  selectedKeyId,
  onDeleteKey,
  timeSnap,
  onTimeSnapChange,
}: TimelineProps) {
  const duration = Math.max(0.2, anim.duration)
  const rows = useMemo(() => buildRows(anim), [anim])
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<{ layerId: string; prop: string; keyId: string } | null>(null)
  const [snapping, setSnapping] = useState(true)

  const pct = (time: number) => (time / duration) * 100

  const timeAt = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      // The track is laid out RTL, so measure from the inline-start (right) edge.
      const raw = (rect.right - clientX) / rect.width
      const rawLtr = (clientX - rect.left) / rect.width
      const ratio = getComputedStyle(el).direction === 'rtl' ? raw : rawLtr
      const v = clamp(ratio, 0, 1) * duration
      return snapping && timeSnap > 0 ? snap(v, timeSnap) : v
    },
    [duration, snapping, timeSnap],
  )

  const tickStep = duration <= 2 ? 0.25 : duration <= 8 ? 0.5 : duration <= 20 ? 1 : 2
  const ticks = useMemo(() => {
    const out: number[] = []
    for (let v = 0; v <= duration + 1e-9; v += tickStep) out.push(Number(v.toFixed(3)))
    return out
  }, [duration, tickStep])

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
        <span className="text-2xs font-black uppercase tracking-wide text-ink-3">خط زمان</span>
        <label className="ms-1 inline-flex items-center gap-1.5 text-2xs font-bold text-ink-2">
          <input
            type="checkbox"
            checked={snapping}
            onChange={(e) => setSnapping(e.target.checked)}
            className="accent-brand"
          />
          <Magnet className="size-3" />
          چفت
        </label>
        <label className="inline-flex items-center gap-1.5 text-2xs font-bold text-ink-2">
          گام
          <input
            type="number"
            min={0}
            step={0.05}
            value={timeSnap}
            onChange={(e) => onTimeSnapChange(Math.max(0, Number(e.target.value)))}
            className="h-6 w-14 rounded-md border border-hairline bg-surface px-1.5 text-center text-2xs font-bold outline-none"
          />
        </label>
        <span className="text-2xs text-ink-3">ث</span>
        <div className="ms-auto flex items-center gap-1.5">
          <IconButton
            icon={Trash2}
            label="حذف کی‌فریم انتخاب‌شده"
            size="sm"
            variant="danger"
            disabled={!selectedKeyId}
            onClick={onDeleteKey}
          />
          <span className="text-2xs text-ink-3">
            <kbd className="kbd">Space</kbd> پخش · <kbd className="kbd">K</kbd> کی‌فریم · <kbd className="kbd">،</kbd>/<kbd className="kbd">.</kbd> جابه‌جایی بین کی‌فریم‌ها
          </span>
        </div>
      </div>

      {/* Ruler — inset by the label column so ticks line up with the keys. */}
      <div className="relative h-7 shrink-0 border-b border-hairline bg-sunken/50">
        <div
          ref={trackRef}
          className="absolute inset-y-0 cursor-ew-resize"
          // The label column sits at the inline-start edge (right, in RTL),
          // so the ruler starts after it and runs to the far edge.
          style={{ insetInlineStart: LABEL_W, insetInlineEnd: 0 }}
          data-align="ruler"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            onSeek(timeAt(e.clientX))
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) onSeek(timeAt(e.clientX))
          }}
        >
          {ticks.map((v) => (
            <div key={v} className="absolute inset-y-0 flex items-center" style={{ insetInlineStart: `${pct(v)}%` }}>
              <span className="h-2 w-px bg-hairline-strong" />
              <span className="ms-0.5 text-[10px] font-bold tabular-nums text-ink-3">{toFaDigits(v.toFixed(tickStep < 1 ? 2 : 0))}</span>
            </div>
          ))}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-brand"
          style={{ insetInlineStart: `calc(${LABEL_W} + (100% - ${LABEL_W}) * ${Math.min(1, Math.max(0, t / duration))})` }}
        />
      </div>

      {/* rows */}
      <div className="relative max-h-72 min-h-0 overflow-y-auto scroll-thin">
        {rows.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-ink-3">
            هنوز کی‌فریمی ندارید. یک لایه را انتخاب کنید و <kbd className="kbd">K</kbd> بزنید.
          </p>
        )}

        {rows.map((row) => {
          const active = row.type !== 'series' && row.layerId === selectedLayerId
          const label = row.type === 'series' ? row.label : row.type === 'layer' ? `${row.layerName} — موقعیت` : `${row.layerName} — ${ANIM_PROP_LABEL[row.prop]}`
          return (
            <div
              key={row.id}
              className={cn(
                'flex items-stretch border-b border-hairline/70 last:border-0',
                active && 'bg-brand-soft/30',
              )}
              style={{ minHeight: ROW_H }}
            >
              <button
                type="button"
                onClick={() => row.type !== 'series' && onSelectLayer(row.layerId)}
                style={{ width: LABEL_W }}
              className="flex shrink-0 items-center gap-1.5 border-e border-hairline px-2 text-start"
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: row.color }} />
                <span className="min-w-0 flex-1 truncate text-2xs font-bold text-ink-2" dir="auto">
                  {label}
                </span>
              </button>

              <div
                className="relative flex-1"
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) onSeek(timeAt(e.clientX))
                }}
              >
                {/* lane guides */}
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-hairline/60" />

                {row.type !== 'series' &&
                  row.keys.map((k) => {
                    const isSel = selectedKeyId === k.id
                    return (
                      <button
                        key={k.id}
                        type="button"
                        aria-label={`کی‌فریم در ${k.t.toFixed(2)} ثانیه`}
                        aria-pressed={isSel}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          e.currentTarget.setPointerCapture(e.pointerId)
                          setDragging({ layerId: row.layerId, prop: row.type === 'prop' ? row.prop : 'x', keyId: k.id })
                        }}
                        onPointerMove={(e) => {
                          if (!dragging || dragging.keyId !== k.id) return
                          onMoveKey(dragging.layerId, dragging.prop, dragging.keyId, timeAt(e.clientX))
                        }}
                        onPointerUp={() => setDragging(null)}
                        onKeyDown={(e) => {
                          const step = e.shiftKey ? 0.5 : timeSnap > 0 ? timeSnap : 0.05
                          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                            e.preventDefault()
                            onMoveKey(row.layerId, row.type === 'prop' ? row.prop : 'x', k.id, clamp(k.t + (e.key === 'ArrowLeft' ? -step : step), 0, duration))
                          } else if (e.key === 'Delete' || e.key === 'Backspace') {
                            e.preventDefault()
                            onSelectKey(row.layerId, row.type === 'prop' ? row.prop : 'x', k.id)
                            onDeleteKey()
                          } else if (e.key === 'Home' || e.key === 'End') {
                            e.preventDefault()
                            onSeek(e.key === 'Home' ? 0 : duration)
                          }
                        }}
                        onFocus={() =>
                          onSelectKey(row.layerId, row.type === 'prop' ? row.prop : 'x', k.id)
                        }
                        className={cn(
                          'absolute top-1/2 z-10 size-3 -translate-y-1/2 translate-x-1/2 rotate-45 rounded-[2px] border transition',
                          isSel ? 'border-brand bg-brand ring-2 ring-brand/30' : 'border-white/70 bg-ink-2 hover:bg-ink',
                        )}
                        style={{ insetInlineStart: `${pct(k.t)}%`, background: isSel ? undefined : row.color }}
                      />
                    )
                  })}
              </div>
            </div>
          )
        })}

        {/* Playhead across all rows, aligned to the same label column. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 z-20 w-px bg-brand/80"
          style={{ insetInlineStart: `calc(${LABEL_W} + (100% - ${LABEL_W}) * ${Math.min(1, Math.max(0, t / duration))})` }}
        />
      </div>
    </div>
  )
}
