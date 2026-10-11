/**
 * The timeline.
 *
 * One row per node, one row per animated property under it, clip bars for
 * time windows and diamonds for keyframes — all laid out by `timeline.ts`,
 * which is where the arithmetic and its tests live.
 *
 * Two decisions that are easy to get wrong:
 *
 * - The whole strip is `dir="ltr"` even though the page is Persian. Time
 *   running right-to-left is a bug, not a localisation.
 * - Dragging a key previews during the drag and records once on release, so
 *   one drag is one undo step rather than one per pointermove.
 */

'use client'

import { memo, useCallback, useRef, useState } from 'react'
import type { Animation2, Key, Node } from '../../types/anim2'
import {
  buildRows,
  clampView,
  fullView,
  insertKey,
  moveKey,
  removeKey,
  snapPointsOf,
  snapTime,
  timeToX,
  timelineTicks,
  xToTime,
  zoomAt,
  type TimeView,
} from '../../lib/anim2/timeline'
import { modeOf, propsFor, readPath, writePath } from '../../lib/anim2/schema'
import { uid } from '../../types/anim2'
import { cn, toFaDigits } from '../../lib/utils'

const ROW_H = 26
const LABEL_W = 150
const SNAP_PX = 6

export type TimelineProps = {
  anim: Animation2
  nodes: Node[]
  t: number
  width: number
  selected: string | null
  view: TimeView
  onView: (view: TimeView) => void
  onSeek: (t: number) => void
  onSelect: (id: string) => void
  /** Called on pointerup only, so a drag is one history entry. */
  onEdit: (nodeId: string, path: string, next: unknown, coalesceKey: string) => void
  onBegin?: () => void
  onPreview?: (nodeId: string, path: string, next: unknown) => void
}

export const Timeline = memo(function Timeline({
  anim,
  nodes,
  t,
  width,
  selected,
  view,
  onView,
  onSeek,
  onSelect,
  onEdit,
  onBegin,
  onPreview,
}: TimelineProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [, setDrag] = useState(false)
  const laneWidth = Math.max(60, width - LABEL_W)
  const snaps = snapPointsOf(anim, nodes)
  const rows = buildRows(anim, expanded)

  const timeAt = useCallback((clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect()
    return xToTime(clientX - rect.left, view, laneWidth)
  }, [view, laneWidth])

  /* ---- scrubbing the ruler ---- */
  const ruler = useRef<HTMLDivElement | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const onRulerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setScrubbing(true)
    onSeek(Math.max(0, Math.min(anim.duration, timeAt(e.clientX, e.currentTarget))))
  }
  const onRulerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return
    onSeek(Math.max(0, Math.min(anim.duration, timeAt(e.clientX, e.currentTarget))))
  }
  const endScrub = () => setScrubbing(false)

  /* ---- ctrl+wheel zooms about the cursor ---- */
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const anchor = xToTime(e.clientX - rect.left - LABEL_W, view, laneWidth)
    onView(zoomAt(view, anchor, e.deltaY > 0 ? 1.2 : 1 / 1.2, anim.duration))
  }

  /* ---- dragging a keyframe ---- */
  const lane = useRef<HTMLDivElement | null>(null)
  const startKeyDrag = (
    e: React.PointerEvent<SVGCircleElement>,
    row: { nodeId: string; path?: string; keys: Key[] },
    key: Key,
  ) => {
    // Narrowed once here so the closures below do not each re-check.
    const path = row.path
    if (!path) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    onBegin?.()
    setDrag(true)

    const el = e.currentTarget.ownerSVGElement
    const move = (ev: PointerEvent) => {
      if (!el) return
      const raw = timeAt(ev.clientX, el)
      const next = snapTime(raw, snaps, (SNAP_PX / laneWidth) * (view.end - view.start), {
        keys: [key.t],
      })
      const src = findNode(nodes, row.nodeId)
      if (!src) return
      const value = readPath(src, path)
      if (!value || typeof value !== 'object' || !('keys' in (value as object))) return
      const keys = moveKey((value as { keys: Key[] }).keys, key.id, next)
      onPreview?.(row.nodeId, path, { keys })
    }
    const up = () => {
      el?.removeEventListener('pointermove', move)
      el?.removeEventListener('pointerup', up)
      el?.removeEventListener('pointercancel', up)
      setDrag(false)
      const src = findNode(nodes, row.nodeId)
      const value = src ? readPath(src, path) : undefined
      if (src && row.path && value && typeof value === 'object' && 'keys' in (value as object)) {
        const keys = (value as { keys: Key[] }).keys
        const found = keys.find((k) => k.id === key.id)
        if (found) onEdit(row.nodeId, path, { keys }, `key:${found.id}`)
      }
    }
    el?.addEventListener('pointermove', move)
    el?.addEventListener('pointerup', up)
    el?.addEventListener('pointercancel', up)
  }

  const addKey = (row: { nodeId: string; path: string }) => {
    const src = findNode(nodes, row.nodeId)
    if (!src) return
    const value = readPath(src, row.path)
    const keys =
      value && typeof value === 'object' && 'keys' in (value as object) ? (value as { keys: Key[] }).keys : []
    const at = snapTime(t, snaps, 0.02)
    onEdit(row.nodeId, row.path, { keys: insertKey(keys, at, sampleValue(src, row.path, at), uid('k')) }, `keys:${row.nodeId}:${row.path}`)
  }

  const deleteKey = (row: { nodeId: string; path: string; keys: Key[] }, keyId: string) => {
    onEdit(row.nodeId, row.path, { keys: removeKey(row.keys, keyId) }, `key:${keyId}`)
  }

  const ticks = timelineTicks(view, laneWidth)

  return (
    <div className="flex select-none border-t border-hairline bg-surface" dir="ltr">
      {/* labels */}
      <div className="shrink-0 border-e border-hairline" style={{ width: LABEL_W }}>
        <div className="flex h-7 items-center justify-between px-2 text-[10px] font-black text-ink-3">
          <span>{toFaDigits(rows.length)} سطر</span>
          <button
            type="button"
            onClick={() => onView(fullView(anim.duration))}
            className="rounded px-1 hover:bg-sunken"
            title="نمایش کل"
          >
            کل
          </button>
        </div>
        {rows.map((row) => (
          <div
            key={row.id}
            className={cn(
              'flex items-center gap-1 px-2 text-2xs',
              selected === row.nodeId && 'bg-brand-soft/60',
            )}
            style={{ height: ROW_H, paddingInlineStart: 6 + row.depth * 10 }}
          >
            {row.path ? (
              <span className="truncate text-ink-3">{row.label}</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(row.nodeId)) next.delete(row.nodeId)
                    else next.add(row.nodeId)
                    return next
                  })}
                  className="grid size-4 shrink-0 place-items-center rounded text-ink-3 hover:bg-sunken"
                  aria-label={expanded.has(row.nodeId) ? 'بستن' : 'گشودن'}
                  title="گشودن ویژگی‌های متحرک"
                >
                  {expanded.has(row.nodeId) ? '▾' : '▸'}
                </button>
                <span className="size-2 shrink-0 rounded-full" style={{ background: row.color ?? '#94a3b8' }} />
                <button
                  type="button"
                  onClick={() => onSelect(row.nodeId)}
                  className="min-w-0 flex-1 truncate text-start font-bold text-ink-2"
                >
                  {row.label}
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* lanes */}
      <div ref={lane} className="relative flex-1 overflow-hidden" onWheel={onWheel}>
        <div
          ref={ruler}
          className="relative h-7 cursor-ew-resize border-b border-hairline"
          onPointerDown={onRulerDown}
          onPointerMove={onRulerMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
        >
          {ticks.map((v) => (
            <span
              key={v}
              className="absolute top-0 h-full border-s border-hairline ps-1 text-[10px] tabular-nums text-ink-3"
              style={{ left: timeToX(v, view, laneWidth) }}
            >
              {toFaDigits(String(Math.round(v * 100) / 100))}
            </span>
          ))}
          {anim.cues.map((cue) => (
            <span
              key={`c${cue.t}${cue.label}`}
              title={cue.label}
              className="absolute bottom-0 h-2 w-2 -translate-x-1/2 rotate-45 bg-brand"
              style={{ left: timeToX(cue.t, view, laneWidth) }}
            />
          ))}
        </div>

        <div className="relative">
          {rows.map((row) => {
            const left = row.start !== undefined ? timeToX(row.start, view, laneWidth) : 0
            const right =
              row.end !== undefined
                ? timeToX(row.end, view, laneWidth)
                : row.start !== undefined
                  ? left
                  : timeToX(anim.duration, view, laneWidth)
            return (
              <div
                key={row.id}
                className={cn(
                  'relative border-b border-hairline/60',
                  selected === row.nodeId && 'bg-brand-soft/30',
                )}
                style={{ height: ROW_H }}
                onClick={() => onSelect(row.nodeId)}
              >
                {/* clip bar */}
                {row.start !== undefined || row.end !== undefined ? (
                  <div
                    className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-brand/25"
                    style={{ left, width: Math.max(2, right - left) }}
                  />
                ) : null}

                <svg className="absolute inset-0 h-full w-full" width={laneWidth} height={ROW_H}>
                  {row.keys.map((k) => (
                    <g key={k.id}>
                      <circle
                        cx={timeToX(k.t, view, laneWidth)}
                        cy={ROW_H / 2}
                        r={5}
                        fill="#fff"
                        stroke={row.color ?? '#334155'}
                        strokeWidth={2}
                        className="cursor-ew-resize"
                        onPointerDown={(e) => startKeyDrag(e, row, k)}
                        onDoubleClick={() => deleteKey(row as never, k.id)}
                      />
                    </g>
                  ))}
                </svg>

                {row.path && row.keys.length === 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      addKey(row as never)
                    }}
                    className="absolute end-1 top-1/2 -translate-y-1/2 rounded px-1 text-2xs text-ink-3 hover:bg-sunken"
                    title="افزودن کی‌فریم در زمان جاری"
                  >
                    +k
                  </button>
                ) : null}
              </div>
            )
          })}

          {/* playhead */}
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-brand"
            style={{ left: timeToX(t, view, laneWidth) }}
          />
        </div>
      </div>
    </div>
  )
})

/* ------------------------------------------------------------------ *
 *  helpers
 * ------------------------------------------------------------------ */

function findNode(nodes: readonly Node[], id: string): Node | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.type === 'group' || n.type === 'axes') {
      const hit = findNode(n.children ?? [], id)
      if (hit) return hit
    }
  }
  return undefined
}

/** A value to start a new keyframe at, from whatever the property currently is. */
function sampleValue(node: Node, path: string, t: number): number {
  const spec = propsFor(node.type).find((p) => p.path === path)
  const value = readPath(node, path)
  if (value && typeof value === 'object' && 'keys' in (value as object)) {
    const keys = (value as { keys: Key[] }).keys
    if (keys.length) {
      const before = keys.filter((k) => k.t <= t).pop() ?? keys[0]
      const after = keys.find((k) => k.t > t)
      if (after && after.t !== before.t) {
        const u = (t - before.t) / (after.t - before.t)
        return before.v + (after.v - before.v) * u
      }
      return before.v
    }
  }
  if (modeOf(value) === 'expr') return 0
  return typeof spec?.fallback === 'number' ? spec.fallback : 0
}

export { writePath, clampView }