/**
 * The editable canvas.
 *
 * This is the piece that turns the studio from a form-filler into an editor.
 * The v1 studio had no selection at all: you could only type numbers into a
 * panel. Here you click a thing, drag it, drag its handles, rotate it, and
 * with record on, dragging *writes a keyframe at the current time* — which is
 * what generalising "record mode to any node" actually means in practice.
 *
 * Three rules, each learned the hard way:
 *
 * 1. A drag is one undo step. `begin` on pointerdown, `preview` while moving,
 *    `commit` on pointerup — including on `pointercancel`, so letting go
 *    halfway does not leave the document half-edited.
 * 2. Nothing is written to history while the pointer is down.
 * 3. A handle under the cursor wins over the body under the cursor, and a
 *    locked node gets no chrome at all.
 */

'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { Node as NodeT, NumProp } from '../../types/anim2'
import { uid } from '../../types/anim2'
import type { Clock } from '../../lib/anim2/clock'
import { compileAnimation, evaluate, type CompiledAnimation, type ResolvedNode } from '../../lib/anim2/engine'
import type { Animation2 } from '../../types/anim2'
import { modeOf, propsFor, readPath, writePath } from '../../lib/anim2/schema'
import { insertKey } from '../../lib/anim2/timeline'
import type { Frame, View } from './geometry'
import { SceneSvg } from './SceneSvg'
import { toFaDigits } from '../../lib/utils'

const HANDLE = 9

/** The frame a node's children are positioned in. */
function childFrameOf(node: ResolvedNode, parent: Frame): Frame {
  const raw = node.raw as {
    axes?: { xDomain: [number, number]; yDomain: [number, number]; rect?: [number, number, number, number] }
  }
  const axes = raw.axes
  if (!axes) return parent
  const r = axes.rect ?? [0, 0, 1, 1]
  const box = {
    x: parent.box.x + r[0] * parent.box.w,
    y: parent.box.y + r[1] * parent.box.h,
    w: Math.max(0, r[2] * parent.box.w),
    h: Math.max(0, r[3] * parent.box.h),
  }
  return {
    box,
    xDomain: axes.xDomain,
    yDomain: axes.yDomain,
    sx: makeSx(box, axes.xDomain),
    sy: makeSy(box, axes.yDomain),
    ix: makeIx(box, axes.xDomain),
    iy: makeIy(box, axes.yDomain),
  }
}

/** Find a node anywhere in the tree, with the frame that positions it. */
function locate(
  nodes: readonly ResolvedNode[],
  id: string,
  frame: Frame,
): { node: ResolvedNode; frame: Frame } | null {
  for (const n of nodes) {
    if (n.id === id) return { node: n, frame }
    if (n.children.length) {
      const hit = locate(n.children, id, childFrameOf(n, frame))
      if (hit) return hit
    }
  }
  return null
}

const makeSx = (box: Frame['box'], d: [number, number]) => (x: number) =>
  box.x + ((d[1] - d[0]) === 0 ? 0 : ((x - d[0]) / (d[1] - d[0])) * box.w)
const makeSy = (box: Frame['box'], d: [number, number]) => (y: number) =>
  box.y + box.h - ((d[1] - d[0]) === 0 ? 0 : ((y - d[0]) / (d[1] - d[0])) * box.h)
const makeIx = (box: Frame['box'], d: [number, number]) => (px: number) =>
  d[0] + (box.w === 0 ? 0 : ((px - box.x) / box.w) * (d[1] - d[0]))
const makeIy = (box: Frame['box'], d: [number, number]) => (py: number) =>
  d[0] + (box.y + box.h === py ? 0 : ((box.y + box.h - py) / box.h) * (d[1] - d[0]))

export type CanvasEdit = {
  nodeId: string
  /** Dotted property paths and their new values. */
  patch: Record<string, unknown>
  coalesceKey: string
}

export function EditorCanvas({
  anim,
  clock,
  selected,
  record,
  onSelect,
  onBegin,
  onPreview,
  onCommit,
  onScrub,
}: {
  anim: Animation2
  clock: Clock
  selected: string | null
  /** When on, dragging writes keyframes at the playhead instead of constants. */
  record: boolean
  onSelect: (id: string | null) => void
  onBegin: () => void
  onPreview: (edit: CanvasEdit) => void
  onCommit: (edit: CanvasEdit) => void
  onScrub?: (t: number) => void
}) {
  const compiled: CompiledAnimation = useMemo(() => compileAnimation(anim), [anim])
  const t = clock.t
  const frame = useMemo(() => evaluate(compiled, t), [compiled, t])
  const [geo, setGeo] = useState<{ view: View; free: Frame } | null>(null)
  const stageRef = useRef<SVGSVGElement | null>(null)

  const handleReady = useCallback(
    (info: { view: View; textScale: number; free: Frame }) => setGeo({ view: info.view, free: info.free }),
    [],
  )

  const found = selected && geo ? locate(frame.nodes, selected, geo.free) : null
  const node = found?.node ?? null
  const f = found?.frame ?? geo?.free ?? null

  /* ---- hit testing ---- */
  /**
   * Topmost node under the cursor. Later siblings draw on top, so the search
   * runs backwards, and a locked node is never a candidate.
   */
  const hitTest = (clientX: number, clientY: number): ResolvedNode | null => {
    if (!geo || !stageRef.current) return null
    const rect = stageRef.current.getBoundingClientRect()
    const px = ((clientX - rect.left) / rect.width) * geo.view.width
    const py = ((clientY - rect.top) / rect.height) * geo.view.height

    const candidates: { node: ResolvedNode; frame: Frame }[] = []
    const walk = (list: ResolvedNode[], parent: Frame) => {
      for (const n of list) {
        if (n.live && !n.locked) candidates.push({ node: n, frame: parent })
        if (n.children.length) walk(n.children, childFrameOf(n, parent))
      }
    }
    walk(frame.nodes, geo.free)

    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const { node: n, frame: fr } = candidates[i]
      // Positions are mapped through the frame; sizes are not — a marker keeps
      // its size on screen whatever the domain is. So the comparison has to be
      // in scene units on both sides. Mixing the two once made the target
      // almost the entire plot, and clicking anywhere grabbed something.
      const dx = px - fr.sx(n.x)
      const dy = py - fr.sy(n.y)
      const halfW = Math.max(10, (n.shape.w ?? (n.shape.rx ?? 10) * 2) / 2)
      const halfH = Math.max(10, (n.shape.h ?? (n.shape.ry ?? 10) * 2) / 2)
      if (Math.abs(dx) <= halfW + 6 && Math.abs(dy) <= halfH + 6) return n
    }
    return null
  }

  /* ---- writing properties, honouring the record mode ---- */
  /**
   * With record on, a drag writes a keyframe at the playhead instead of
   * overwriting the constant — which is what "record mode generalised to any
   * node" has to mean, since any node can now move.
   */
  const writePatch = (
    nodeId: string,
    patch: Record<string, number>,
    coalesceKey: string,
  ): CanvasEdit | null => {
    const target = findRaw(anim.nodes, nodeId)
    if (!target) return null
    const out: Record<string, unknown> = {}
    for (const [path, value] of Object.entries(patch)) {
      if (!record) {
        out[path] = value
        continue
      }
      const current = readPath(target, path)
      const keys =
        current && typeof current === 'object' && 'keys' in (current as object)
          ? ((current as { keys: never[] }).keys as never[])
          : []
      out[path] = { keys: insertKey(keys, t, value, uid('k')) } as NumProp
    }
    return { nodeId, patch: out, coalesceKey }
  }

  const write = (nodeId: string, path: string, value: number, coalesceKey: string): CanvasEdit | null =>
    writePatch(nodeId, { [path]: value }, coalesceKey)

  /* ---- one drag gesture ---- */
  /**
   * Listeners go on `window`, not on the SVG.
   *
   * With `setPointerCapture` the pointer events are retargeted to the
   * capturing element, and a listener on the `<svg>` silently stops seeing
   * them in some browsers. Window also means a drag that leaves the canvas
   * still finishes cleanly.
   */
  const startDrag = (
    e: React.PointerEvent<SVGElement>,
    plan: { nodeId: string; path: string; mode: 'move' | 'rotate' | 'x' | 'y'; at: number },
  ) => {
    e.stopPropagation()
    e.preventDefault()
    const pointerId = e.pointerId
    const box = (stageRef.current ?? e.currentTarget).getBoundingClientRect()
    const view = geo?.view
    const frameOf = f
    if (!view || !frameOf) return

    const toScene = (cx: number, cy: number) => ({
      px: ((cx - box.left) / box.width) * view.width,
      py: ((cy - box.top) / box.height) * view.height,
    })
    const origin = toScene(e.clientX, e.clientY)
    const baseData = { x: frameOf.ix(origin.px), y: frameOf.iy(origin.py) }
    const seen: CanvasEdit[] = []

    onBegin()

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const here = toScene(ev.clientX, ev.clientY)
      const dx = here.px - origin.px
      const dy = here.py - origin.py

      if (plan.mode === 'move') {
        // One edit carrying both axes. Emitting two means the second is
        // applied to the document the first was written against, and x is lost.
        const nx = plan.at + (frameOf.ix(origin.px + dx) - baseData.x)
        const ny = plan.at + (frameOf.iy(origin.py + dy) - baseData.y)
        const edit = writePatch(plan.nodeId, { 'transform.x': nx, 'transform.y': ny }, `move:${plan.nodeId}`)
        if (edit) { onPreview(edit); seen.push(edit) }
        return
      }

      if (plan.mode === 'x' || plan.mode === 'y') {
        const path = plan.mode === 'x' ? 'w' : 'h'
        const edit = write(
          plan.nodeId,
          path,
          Math.max(1, plan.at + (plan.mode === 'x' ? dx : dy)),
          `size:${plan.nodeId}`,
        )
        if (edit) { onPreview(edit); seen.push(edit) }
        return
      }

      // rotate, measured from the body's own centre
      const cx = frameOf.sx(baseData.x)
      const cy = frameOf.sy(baseData.y)
      const angle = (Math.atan2(-(here.py - cy), here.px - cx) * 180) / Math.PI
      const edit = write(plan.nodeId, 'transform.rotation', Math.round(angle), `rot:${plan.nodeId}`)
      if (edit) { onPreview(edit); seen.push(edit) }
    }

    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      const last = seen[seen.length - 1]
      if (last) onCommit(last)
    }
    // Letting go halfway must not leave a half-applied edit in history.
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      onCommit(seen[0] ?? { nodeId: plan.nodeId, patch: {}, coalesceKey: `cancel:${plan.nodeId}` })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  const scrub = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onScrub || !geo) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width)
    onScrub(Math.min(1, Math.max(0, ratio)) * compiled.duration)
  }

  const overlay = node && f && geo ? (
    <SelectionChrome
      node={node}
      frame={f}
      onDrag={startDrag}
      unit={Math.max(1, Math.min(geo.view.width, geo.view.height) / 120)}
    />
  ) : null

  return (
    <SceneSvg
      ref={undefined}
      compiled={compiled}
      frame={frame}
      t={t}
      overlay={overlay}
      onReady={handleReady}
      svgProps={{
        ref: stageRef,
        onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
          // A handle owns its own gesture; the body never steals it.
          if ((e.target as Element).closest('[data-handle]')) return
          onSelect(hitTest(e.clientX, e.clientY)?.id ?? null)
          scrub(e)
        },
      }}
      className="cursor-crosshair"
    />
  )
}

/* ------------------------------------------------------------------ *
 *  Selection chrome
 * ------------------------------------------------------------------ */

function SelectionChrome({
  node,
  frame,
  onDrag,
  unit,
}: {
  node: ResolvedNode
  frame: Frame
  onDrag: (e: React.PointerEvent<SVGElement>, plan: { nodeId: string; path: string; mode: 'move' | 'rotate' | 'x' | 'y'; at: number }) => void
  unit: number
}) {
  const x = frame.sx(node.x)
  const y = frame.sy(node.y)
  const rx = node.shape.rx ?? (node.shape.w ? node.shape.w / 2 : 10)
  const ry = node.shape.ry ?? (node.shape.h ? node.shape.h / 2 : 10)
  const boxW = node.shape.w ?? rx * 2
  const boxH = node.shape.h ?? ry * 2
  const plan = (mode: 'move' | 'rotate' | 'x' | 'y', at: number) => ({
    nodeId: node.id,
    path: mode === 'x' ? 'transform.x' : mode === 'y' ? 'transform.y' : 'transform.rotation',
    mode,
    at,
  })

  return (
    <g>
      {/* body: click and drag to move */}
      <rect
        x={x - boxW / 2 - 4}
        y={y - boxH / 2 - 4}
        width={boxW + 8}
        height={boxH + 8}
        fill="transparent"
        stroke="rgb(var(--brand))"
        strokeWidth={1.5}
        strokeDasharray="5 4"
        className="cursor-move"
        onPointerDown={(e) => onDrag(e, plan('move', node.x))}
      />

      {/* resize corners */}
      {([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => (
        <rect
          key={`${sx}${sy}`}
          data-handle="1"
          x={x + (sx * boxW) / 2 - HANDLE / 2}
          y={y + (sy * boxH) / 2 - HANDLE / 2}
          width={HANDLE}
          height={HANDLE}
          rx={2}
          fill="#fff"
          stroke="rgb(var(--brand))"
          strokeWidth={1.5}
          className="cursor-nwse-resize"
          onPointerDown={(e) => onDrag(e, plan(sx < 0 === sy < 0 ? 'x' : 'y', sx < 0 === sy < 0 ? boxW : boxH))}
        />
      ))}

      {/* rotate handle */}
      <line x1={x} y1={y} x2={x} y2={y - boxH / 2 - unit * 2} stroke="rgb(var(--brand))" strokeWidth={1.2} />
      <circle
        data-handle="1"
        cx={x}
        cy={y - boxH / 2 - unit * 2}
        r={HANDLE / 1.6}
        fill="#fff"
        stroke="rgb(var(--brand))"
        strokeWidth={1.5}
        className="cursor-grab"
        onPointerDown={(e) => onDrag(e, plan('rotate', node.rotation))}
      />

      {/* a small readout, because "where is it now" is a real question */}
      <g transform={`translate(${x + boxW / 2 + 8} ${y - boxH / 2 - 6})`}>
        <rect x={-2} y={-11} width={62} height={16} rx={4} fill="rgb(var(--brand))" opacity={0.9} />
        <text x={3} y={1} fontSize={11} fill="#fff" direction="ltr">
          {toFaDigits(Math.round(node.x))}, {toFaDigits(Math.round(node.y))}
        </text>
      </g>
    </g>
  )
}

function findRaw(nodes: readonly NodeT[], id: string): NodeT | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.type === 'group' || n.type === 'axes') {
      const hit = findRaw(n.children ?? [], id)
      if (hit) return hit
    }
  }
  return undefined
}

export { modeOf, propsFor, writePath }