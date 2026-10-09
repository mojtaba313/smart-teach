import { useMemo, useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { restrictToVerticalAxis, restrictToWindowEdges } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DraggableAttributes } from '@dnd-kit/core'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities/useSyntheticListeners'
import { GripVertical } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Every sortable surface in the studio shares these sensors.
 *
 * `KeyboardSensor` is what makes reordering possible without a mouse:
 * focus a handle, hold Space to lift, arrows to move, Space to drop, Escape
 * to cancel — and the move is announced by dnd-kit's live region.
 */
export function useStudioSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

export function DragHandle({
  listeners,
  attributes,
  setActivatorNodeRef,
  label,
  className,
  compact,
}: {
  listeners?: SyntheticListenerMap
  attributes?: DraggableAttributes
  setActivatorNodeRef?: (el: HTMLElement | null) => void
  label: string
  className?: string
  compact?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} — یا با کلیدهای جهت‌دار جابه‌جا کنید`}
      className={cn(
        'flex cursor-grab touch-none items-center justify-center rounded-lg text-ink-3 transition hover:bg-sunken hover:text-ink active:cursor-grabbing',
        compact ? 'size-6' : 'size-7',
        className,
      )}
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
    >
      <GripVertical className={compact ? 'size-3.5' : 'size-4'} />
    </button>
  )
}

/**
 * The slice of dnd-kit's API this app uses. Re-exporting the library's own
 * return value would drag its internal refs into render.
 */
export type SortableShell = {
  id: string
  style: React.CSSProperties
  isDragging: boolean
  setNodeRef: (el: HTMLElement | null) => void
  setActivatorNodeRef: (el: HTMLElement | null) => void
  listeners: SyntheticListenerMap | undefined
  attributes: DraggableAttributes
}

/** Props every sortable row needs; keeps the call sites terse. */
export function useSortableItem(id: string, disabled = false): SortableShell {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })
  const style = useMemo<React.CSSProperties>(
    () => ({
      transform: CSS.Translate.toString(transform),
      transition,
      zIndex: isDragging ? 40 : undefined,
    }),
    [transform, transition, isDragging],
  )
  return { id, style, isDragging, setNodeRef, setActivatorNodeRef, listeners, attributes }
}

/* ------------------------------------------------------------------ *
 *  Vertical list (the slide rail)
 * ------------------------------------------------------------------ */

export function SortableList({
  ids,
  onReorder,
  renderRow,
  renderGhost,
  label,
  className,
}: {
  ids: string[]
  onReorder: (from: number, to: number) => void
  renderRow: (id: string, index: number, drag: SortableShell) => ReactNode
  renderGhost?: (id: string) => ReactNode
  label: string
  className?: string
}) {
  const sensors = useStudioSensors()
  const [active, setActive] = useState<UniqueIdentifier | null>(null)

  const onDragStart = (e: DragStartEvent) => setActive(e.active.id)
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null)
    const { active: a, over } = e
    if (!over || a.id === over.id) return
    const from = ids.indexOf(String(a.id))
    const to = ids.indexOf(String(over.id))
    if (from >= 0 && to >= 0) onReorder(from, to)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `برداشته شد: ${active.id}`,
          onDragOver: ({ over }) => (over ? `بر روی جای ${over.id}` : 'جایی نیست'),
          onDragEnd: ({ over }) => (over ? `رها شد روی جای ${over.id}` : 'رها شد'),
          onDragCancel: () => 'انصراف',
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={className} role="list" aria-label={label}>
          {ids.map((id, i) => (
            <SortableRow key={id} id={id} index={i} render={renderRow} />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.22,1,0.36,1)' }}>
        {active !== null && renderGhost ? renderGhost(String(active)) : null}
      </DragOverlay>
    </DndContext>
  )
}

/**
 * `useSortable` has to be called from a real component inside
 * `SortableContext` — one row per hook call, never inside a `.map`.
 */
function SortableRow({
  id,
  index,
  render,
}: {
  id: string
  index: number
  render: (id: string, index: number, drag: SortableShell) => ReactNode
}) {
  return <>{render(id, index, useSortableItem(id))}</>
}

/**
 * One grid cell. The column span lives on this element — putting it on a
 * nested wrapper would be inert, because the child is no longer a grid item.
 */
function SortableGridCell({
  id,
  span,
  render,
  active,
}: {
  id: string
  span: number
  render: (drag: SortableShell) => ReactNode
  active: boolean
}) {
  const { setNodeRef, style, isDragging, listeners, attributes, setActivatorNodeRef, id: dragId } = useSortableItem(id)
  return (
    <div
      ref={setNodeRef}
      // `grid-column: span N` would set the *start* track and leave the end
      // on `auto`, so name the end line explicitly.
      style={{ ...style, gridColumnEnd: `span ${Math.max(1, Math.min(6, span))}` }}
      role="listitem"
      className={cn('min-w-0', active && 'opacity-30')}
      data-span={span}
    >
      {render({ id: dragId, style, isDragging, setNodeRef, setActivatorNodeRef, listeners, attributes })}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Grid (the block canvas)
 * ------------------------------------------------------------------ */

export function SortableGrid({
  ids,
  spans,
  onReorder,
  children,
  renderOverlay,
  label,
}: {
  ids: string[]
  /** CSS grid-column span per id */
  spans: Record<string, number>
  onReorder: (from: number, to: number) => void
  children: (drag: ReturnType<typeof useSortableItem>) => ReactNode
  renderOverlay?: (id: string) => ReactNode
  label: string
}) {
  const sensors = useStudioSensors()
  const [active, setActive] = useState<string | null>(null)

  const onDragEnd = (e: DragEndEvent) => {
    setActive(null)
    const { active: a, over } = e
    if (!over || a.id === over.id) return
    const from = ids.indexOf(String(a.id))
    const to = ids.indexOf(String(over.id))
    if (from >= 0 && to >= 0) onReorder(from, to)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToWindowEdges]}
      onDragStart={(e) => setActive(String(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="block-grid" role="list" aria-label={label}>
          {ids.map((id) => (
            <SortableGridCell
              key={id}
              id={id}
              span={spans[id] ?? 6}
              active={active === id}
              render={children}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.22,1,0.36,1)' }}>
        {active && renderOverlay ? renderOverlay(active) : null}
      </DragOverlay>
    </DndContext>
  )
}
