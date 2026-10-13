/**
 * A cubic-bezier easing editor.
 *
 * A preset list is not enough: "slightly late, slightly soft" is most of what
 * a keyframe needs and no named curve describes it. Dragging the two handles
 * writes a real `cubic-bezier(...)`, so the studio stays compatible with the
 * CSS timing vocabulary rather than inventing a second one.
 *
 * y is deliberately unclamped — an overshoot is the whole point of a back or
 * elastic ease — but x is held inside the unit square, because a bezier whose
 * control x leaves 0..1 is no longer a function of time and cannot be sampled.
 */

'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { EASES, formatBezier, parseBezier, type Bezier } from '../../lib/anim2/studio'
import { cn, toFaDigits } from '../../lib/utils'

const SIZE = 132
const PAD = 20

const toPx = (x: number, y: number): { x: number; y: number } => ({
  x: PAD + x * (SIZE - PAD * 2),
  // The box is drawn with y upward, the DOM with y downward.
  y: SIZE - PAD - y * (SIZE - PAD * 2),
})

const toUnit = (px: number, py: number): { x: number; y: number } => ({
  x: (px - PAD) / (SIZE - PAD * 2),
  y: (SIZE - PAD - py) / (SIZE - PAD * 2),
})

export function EaseEditor({
  value,
  onChange,
}: {
  /** The current spec: a preset name or a `cubic-bezier(...)`. */
  value: string | undefined
  onChange: (next: string) => void
}) {
  const parsed = parseBezier(value ?? '')
  const preset = EASES.find((e) => e.name === value)
  // Memoised because it is a dependency of the drag handler; rebuilding the
  // array each render would tear down the pointer capture mid-drag.
  const curve: Bezier = useMemo(
    () =>
      parsed ?? [
        preset?.p1[0] ?? 0.25,
        preset?.p1[1] ?? 0.1,
        preset?.p2[0] ?? 0.25,
        preset?.p2[1] ?? 1,
      ],
    [parsed, preset],
  )

  const svgRef = useRef<SVGSVGElement | null>(null)
  const [drag, setDrag] = useState<0 | 1 | 2 | 3 | null>(null)

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (drag === null) return
      const box = svgRef.current?.getBoundingClientRect()
      if (!box) return
      const scale = SIZE / Math.max(1, box.width)
      const unit = toUnit((e.clientX - box.left) * scale, (e.clientY - box.top) * scale)
      // x is held in the unit square; y is free to overshoot.
      const next: Bezier = [...curve] as Bezier
      const x = Math.min(1, Math.max(0, unit.x))
      const y = Math.max(-1, Math.min(2, unit.y))
      if (drag === 0) {
        next[0] = x
        next[1] = y
      } else if (drag === 1) {
        next[2] = x
        next[3] = y
      } else if (drag === 2) {
        next[0] = x
        next[3] = y
      } else {
        next[2] = x
        next[1] = y
      }
      onChange(formatBezier(next))
    },
    [drag, curve, onChange],
  )

  const a = toPx(0, 0)
  const b = toPx(1, 1)
  const c1 = toPx(curve[0], curve[1])
  const c2 = toPx(curve[2], curve[3])

  return (
    <div className="space-y-2 p-2">
      <div className="flex flex-wrap gap-1">
        {EASES.map((e) => (
          <button
            key={e.name}
            type="button"
            aria-pressed={value === e.name}
            onClick={() => onChange(e.name)}
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-2xs',
              value === e.name
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-hairline text-ink-3 hover:text-ink',
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="ویرایش شتاب"
        className="h-32 w-32 touch-none select-none rounded-md border border-hairline bg-surface"
        onPointerMove={onPointerMove}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
      >
        <rect x={PAD} y={PAD} width={SIZE - PAD * 2} height={SIZE - PAD * 2} fill="none" stroke="rgb(var(--hairline))" />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgb(var(--scene-ink) / 0.3)" />
        <line x1={a.x} y1={b.y} x2={b.x} y2={a.y} stroke="rgb(var(--scene-ink) / 0.15)" />
        <path
          d={`M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`}
          fill="none"
          stroke="rgb(var(--brand))"
          strokeWidth={2}
        />
        <line x1={a.x} y1={a.y} x2={c1.x} y2={c1.y} stroke="rgb(var(--brand) / 0.5)" />
        <line x1={b.x} y1={b.y} x2={c2.x} y2={c2.y} stroke="rgb(var(--brand) / 0.5)" />
        {/* Each handle drags the pair it is attached to, so the curve stays well-formed. */}
        {[
          { i: 0 as const, p: c1 },
          { i: 1 as const, p: c1 },
          { i: 2 as const, p: c2 },
          { i: 3 as const, p: c2 },
        ].map(({ i, p }) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={6}
            className="cursor-grab"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setDrag(i)
            }}
          />
        ))}
      </svg>

      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="linear یا cubic-bezier(a,b,c,d)"
        aria-label="شتاب"
        className="h-7 w-full rounded-md border border-hairline bg-surface px-1.5 text-2xs"
      />
      <p className="text-2xs text-ink-3">
        x بین ۰ و ۱ می‌ماند؛ y آزاد است تا جهش (back/elastic) ممکن شود.
      </p>
      <span className="sr-only">{toFaDigits(curve.map((n) => n.toFixed(2)).join(', '))}</span>
    </div>
  )
}