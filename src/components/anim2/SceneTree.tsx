/**
 * The scene tree.
 *
 * One list for every kind of node, with hierarchy. v1 had four separate
 * lists in a narrow rail and three separate selection concepts that had to
 * be kept in sync by hand — and the tab bar could silently discard a
 * selection. One list and one id removes that entire class of bug.
 */

'use client'

import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  Layers as LayersIcon,
  Lock,
  LockOpen,
  Minus,
  Pencil,
  Spline,
  Square,
  Triangle as TriangleIcon,
  Type as TypeIcon,
  UnfoldVertical,
  Waves,
} from 'lucide-react'
import type { Node } from '../../types/anim2'
import { NODE_TYPES } from '../../lib/anim2/schema'
import { cn, toFaDigits } from '../../lib/utils'

const ICON: Record<Node['type'], typeof Square> = {
  rect: Square,
  ellipse: Minus,
  line: Pencil,
  path: Spline,
  text: TypeIcon,
  image: ImageIcon,
  plot: Waves,
  axes: LayersIcon,
  group: UnfoldVertical,
  use: LayersIcon,
  shape: TriangleIcon,
}

export function SceneTree({
  nodes,
  selected,
  expanded,
  onSelect,
  onToggleExpand,
  onToggleVisible,
  onToggleLock,
  onToggleExpandNode,
  onAdd,
  onGroup,
  onUngroup,
  depth = 0,
}: {
  nodes: readonly Node[]
  selected: string | null
  expanded: ReadonlySet<string>
  /** `additive` is set by a shift- or ctrl-click. */
  onSelect: (id: string, additive?: boolean) => void
  onToggleExpand: (id: string) => void
  onToggleVisible: (id: string) => void
  onToggleLock: (id: string) => void
  onToggleExpandNode: (id: string) => void
  onAdd: (type: Node['type']) => void
  onGroup: () => void
  onUngroup: () => void
  depth?: number
}) {
  return (
    <>
      {nodes.map((node) => {
        const Icon = ICON[node.type] ?? Square
        const hasChildren = node.type === 'group' || node.type === 'axes'
        const open = expanded.has(node.id)
        const selectedNode = selected === node.id
        return (
          <div key={node.id}>
            <div
              className={cn(
                'group flex items-center gap-1 rounded-lg py-0.5 pe-1 transition',
                selectedNode ? 'bg-brand-soft/70' : 'hover:bg-sunken',
              )}
              style={{ paddingInlineStart: 4 + depth * 10 }}
            >
              <GripVertical className="size-3 shrink-0 cursor-grab text-ink-3 opacity-0 group-hover:opacity-100" />
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => onToggleExpandNode(node.id)}
                  aria-label={open ? 'بستن' : 'گشودن'}
                  className="grid size-4 shrink-0 place-items-center text-ink-3 hover:text-ink-2"
                >
                  {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                </button>
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <button
                type="button"
                onClick={(e) => onSelect(node.id, e.shiftKey || e.metaKey || e.ctrlKey)}
                className="flex min-w-0 flex-1 items-center gap-1 text-start"
              >
                <Icon className="size-3 shrink-0 text-ink-3" />
                <span className={cn('truncate text-xs font-bold', selectedNode ? 'text-brand' : 'text-ink-2')}>
                  {node.name || node.type}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-ink-3">{node.type}</span>
              </button>
              <button
                type="button"
                onClick={() => onToggleLock(node.id)}
                aria-label="قفل"
                className="grid size-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-surface"
              >
                {node.locked ? <Lock className="size-3" /> : <LockOpen className="size-3 opacity-0 group-hover:opacity-100" />}
              </button>
              <button
                type="button"
                onClick={() => onToggleVisible(node.id)}
                aria-label="نمایش"
                className="grid size-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-surface"
              >
                {node.visible === false ? <EyeOff className="size-3" /> : <Eye className="size-3 opacity-0 group-hover:opacity-100" />}
              </button>
            </div>
            {hasChildren && open ? (
              <SceneTree
                nodes={node.children ?? []}
                selected={selected}
                expanded={expanded}
                onSelect={onSelect}
                onToggleExpand={onToggleExpand}
                onToggleVisible={onToggleVisible}
                onToggleLock={onToggleLock}
                onToggleExpandNode={onToggleExpandNode}
                onAdd={onAdd}
                onGroup={onGroup}
                onUngroup={onUngroup}
                depth={depth + 1}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

export function SceneTreePanel(props: {
  nodes: readonly Node[]
  selected: string | null
  expanded: ReadonlySet<string>
  /** `additive` is set by a shift- or ctrl-click. */
  onSelect: (id: string, additive?: boolean) => void
  onToggleExpand: (id: string) => void
  onToggleVisible: (id: string) => void
  onToggleLock: (id: string) => void
  onToggleExpandNode: (id: string) => void
  onAdd: (type: Node['type']) => void
  onGroup: () => void
  onUngroup: () => void
}) {
  const count = props.nodes.length
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-hairline px-2 py-1.5">
        <h2 className="text-2xs font-black uppercase tracking-wide text-ink-3">صحنه</h2>
        <span className="ms-auto text-2xs tabular-nums text-ink-3">{toFaDigits(count)}</span>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-hairline p-1.5">
        {NODE_TYPES.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => props.onAdd(t.type)}
            title={t.label}
            className="rounded-md border border-hairline px-1.5 py-1 text-2xs font-bold text-ink-3 hover:border-brand/50 hover:text-brand"
          >
            {t.label}
          </button>
        ))}
        <button type="button" onClick={props.onGroup} className="rounded-md border border-dashed border-hairline px-1.5 py-1 text-2xs font-bold text-ink-3 hover:text-brand">
          گروه
        </button>
        <button type="button" onClick={props.onUngroup} className="rounded-md border border-dashed border-hairline px-1.5 py-1 text-2xs font-bold text-ink-3 hover:text-brand">
          بازکردن
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto scroll-thin p-1">
        {count === 0 ? <p className="p-2 text-2xs text-ink-3">صحنه خالی است. یک شکل یا قالب اضافه کنید.</p> : null}
        <SceneTree {...props} />
      </div>
    </div>
  )
}