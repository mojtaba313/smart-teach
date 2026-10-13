/**
 * The v2 animation studio.
 *
 * The shape of this screen is the answer to "it became too complicated". One
 * list on the left, one canvas, one timeline, one inspector. One selection.
 * Every control is generated from the property schema, so there is no
 * per-node-type code anywhere in this file.
 *
 * State is split deliberately:
 *   - the *document* lives in a history reducer (undoable, transactional)
 *   - the *playhead* lives in the clock (not undoable, not history)
 *   - *preview* state during a drag goes through the reducer's `preview`
 *     action, which moves the present without touching history
 */

'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowRight, Redo2, Save, Undo2 } from 'lucide-react'
import type { Slide, SlideStep } from '../types'
import type { AnimAction, Animation2, Node } from '../types/anim2'
import { uid } from '../types/anim2'
import { Clock } from '../lib/anim2/clock'
import { canRedo, canUndo, historyReducer, initHistory } from '../lib/anim2/history'
import { newNodeOfType, writePath } from '../lib/anim2/schema'
import { fullView, type TimeView } from '../lib/anim2/timeline'
import {
  copySelection,
  deleteSelection,
  findNode,
  pasteClipboard,
  selectAll,
  toggleSelection,
  type Clipboard,
  type SelIds,
} from '../lib/anim2/studio'
import { templateLibrary } from '../lib/anim2/templates'
import { EditorCanvas } from '../components/anim2/EditorCanvas'
import { SceneToolbar } from '../components/anim2/SceneToolbar'
import { NodeInspector, ParamsPanel, TemplateGallery } from '../components/anim2/Inspector'
import { SceneTreePanel } from '../components/anim2/SceneTree'
import { Timeline } from '../components/anim2/Timeline'
import { migrateAnimationV1toV2 } from '../model/migrateAnimationV1toV2'
import { putPresentation, usePresentations } from '../lib/store'
import { cn } from '../lib/utils'

const AUTOSAVE_MS = 600

/** The parent of `id`, or null at the root. Used to land a paste in context. */
function parentIdOf(nodes: readonly Node[], id: string): string | null {
  for (const n of nodes) {
    if (n.type !== 'group' && n.type !== 'axes') continue
    if (n.children.some((c) => c.id === id)) return n.id
    const hit = parentIdOf(n.children, id)
    if (hit) return hit
  }
  return null
}

/** Apply a change to a node wherever it lives. */
function mapNode(nodes: readonly Node[], id: string, fn: (n: Node) => Node): Node[] {
  return nodes.map((n) => {
    if (n.id === id) return fn(n)
    if (n.type === 'group' || n.type === 'axes') {
      return { ...n, children: mapNode(n.children ?? [], id, fn) } as Node
    }
    return n
  })
}

export function Studio() {
  const { presId, slideId, stepId } = useParams<{ presId: string; slideId: string; stepId: string }>()
  const router = useRouter()
  const library = usePresentations()
  const pres = library.find((p) => p.id === presId)

  const located = (() => {
    if (!pres) return null
    for (const slide of pres.slides) {
      const i = slide.steps.findIndex((s) => s.id === stepId)
      if (i >= 0) return { slide, index: i }
    }
    return null
  })()

  const step = located?.slide.steps[located.index]

  /** The step may hold a v1 or a v2 animation; upgrade once and keep it. */
  const stepAnim = step && step.kind === 'animation' ? step.anim : undefined
  const seed = useMemo(() => migrateAnimationV1toV2(stepAnim ?? {}).anim, [stepAnim])

  /** Write the edited animation back into the deck. */
  const saveStep = useCallback(
    (p: string, s: string, k: string, patch: { anim: unknown }) => {
      const deck = library.find((x) => x.id === p)
      if (!deck) return
      putPresentation({
        ...deck,
        slides: deck.slides.map((slide): Slide =>
          slide.id === s
            ? { ...slide, steps: slide.steps.map((st) => (st.id === k ? ({ ...st, ...patch } as SlideStep) : st)) }
            : slide,
        ),
      })
    },
    [library],
  )

  const [history, dispatch] = useReducer(historyReducer, seed, initHistory)
  const [sel, setSel] = useState<SelIds>([])
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  // The toolbar serialises the live scene, so it needs the element itself.
  const sceneSvgRef = useRef<SVGSVGElement | null>(null)
  // The canvas owns the runtime; the toolbar and inspector need to reach it.
  const canvasRuntime = useRef<{ run: (actions: readonly AnimAction[]) => void } | null>(null)
  // The focused member is the last one picked; every single-node action keeps
  // working unchanged, so adding multi-select does not fork the whole screen.
  const selected = sel[sel.length - 1] ?? null
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [view, setView] = useState<TimeView>(() => fullView(seed.duration))
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<'node' | 'params' | 'templates'>('node')
  const [record, setRecord] = useState(false)

  const anim = history.present
  const [clock] = useState(() => new Clock({ duration: anim.duration }))
  const laneRef = useRef<HTMLDivElement | null>(null)
  const [laneWidth, setLaneWidth] = useState(600)

  useEffect(() => {
    clock.reconfigure({ duration: anim.duration, loop: anim.loop === true, speed: anim.speed ?? 1 })
  }, [clock, anim.duration, anim.loop, anim.speed])

  /* ---- keep the timeline sized to the window ---- */
  useEffect(() => {
    const el = laneRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 600
      setLaneWidth(Math.max(200, w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ---- autosave, flushed on the ways a tab can disappear ---- */
  useEffect(() => {
    if (!dirty) return
    const id = setTimeout(() => {
      saveStep(presId, slideId, stepId, { anim: anim as never })
      setDirty(false)
    }, AUTOSAVE_MS)
    return () => clearTimeout(id)
  }, [dirty, anim, saveStep, presId, slideId, stepId])

  useEffect(() => {
    const flush = () => {
      if (!dirty) return
      saveStep(presId, slideId, stepId, { anim: anim as never })
      setDirty(false)
    }
    // A debounce that never fires is a lost edit.
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', flush)
      flush()
    }
  }, [dirty, anim, saveStep, presId, slideId, stepId])

  /* ---- edits ---- */
  const commit = useCallback(
    (next: Animation2, coalesceKey?: string) => {
      dispatch({ type: 'set', next, coalesceKey, now: Date.now() })
      setDirty(true)
    },
    [],
  )

  /* ---- selection operations ---- */
  const doCopy = useCallback(() => {
    setClipboard(copySelection(anim.nodes, sel, clock.t))
  }, [anim.nodes, sel, clock])

  const doPaste = useCallback(() => {
    if (!clipboard) return
    const parent = selected ? parentIdOf(anim.nodes, selected) : null
    const out = pasteClipboard(anim.nodes, clipboard, { into: parent })
    if (out.ids.length === 0) return
    commit({ ...anim, nodes: out.nodes }, 'paste')
    setSel(out.ids)
  }, [anim, clipboard, selected, commit])

  const doDuplicate = useCallback(() => {
    const clip = copySelection(anim.nodes, sel, clock.t)
    if (!clip) return
    const out = pasteClipboard(anim.nodes, clip, { into: selected ? parentIdOf(anim.nodes, selected) : null })
    if (out.ids.length === 0) return
    commit({ ...anim, nodes: out.nodes }, 'duplicate')
    setSel(out.ids)
  }, [anim, sel, clock, selected, commit])

  const removeSelection = useCallback(() => {
    const out = deleteSelection(anim.nodes, sel)
    if (out.removed.length === 0) return
    commit({ ...anim, nodes: out.nodes }, 'delete')
    setSel([])
  }, [anim, sel, commit])

  const select = useCallback((id: string | null, additive = false) => {
    // Clicking empty canvas clears the selection unless it is an extend, which
    // is how every other editor behaves and what a stray click should do.
    setSel((prev) => (id ? toggleSelection(prev, id, additive) : []))
  }, [])

  /** One expander shared by the tree and the timeline, so they never disagree. */
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const patchNodes = useCallback(
    (fn: (nodes: Node[]) => Node[], coalesceKey?: string) => {
      commit({ ...anim, nodes: fn(anim.nodes) }, coalesceKey)
    },
    [anim, commit],
  )

  const updateNode = useCallback(
    (nodeId: string, next: Node, coalesceKey?: string) => {
      patchNodes((list) => mapNode(list, nodeId, () => next), coalesceKey)
    },
    [patchNodes],
  )

  const toggleOn = useCallback(
    (nodeId: string, path: string, next: boolean) => {
      patchNodes((list) => mapNode(list, nodeId, (n) => writePath(n, path, next) as Node))
    },
    [patchNodes],
  )

  const addNode = useCallback(
    (type: Node['type']) => {
      const node = newNodeOfType(type, uid(type))
      const withLib = anim.templates?.['freeBodyDiagram'] ? anim : { ...anim, templates: templateLibrary() }
      commit({ ...withLib, nodes: [...withLib.nodes, node] })
      setSel([node.id].filter(Boolean))
    },
    [anim, commit],
  )

  const insertTemplate = useCallback(
    (templateId: string) => {
      const node: Node = {
        id: uid('use'),
        type: 'use',
        template: templateId,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      } as Node
      const withLib = anim.templates?.['freeBodyDiagram'] ? anim : { ...anim, templates: templateLibrary() }
      commit({ ...withLib, nodes: [...withLib.nodes, node] })
      setSel([node.id].filter(Boolean))
    },
    [anim, commit],
  )

  const groupSelected = useCallback(() => {
    if (!selected) return
    const node = findNode(anim.nodes, selected)
    if (!node) return
    const group: Node = {
      id: uid('group'),
      type: 'group',
      name: 'گروه',
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      children: [node],
    } as Node
    commit({ ...anim, nodes: anim.nodes.map((n) => (n.id === selected ? group : n)) })
    setSel([group.id].filter(Boolean))
  }, [anim, selected, commit])

  const ungroupSelected = useCallback(() => {
    if (!selected) return
    const node = findNode(anim.nodes, selected)
    // Only a top-level group can be dissolved into the top level.
    const index = anim.nodes.findIndex((n) => n.id === selected)
    if (index < 0 || !node || (node.type !== 'group' && node.type !== 'axes')) return
    const children = node.children ?? []
    commit({ ...anim, nodes: [...anim.nodes.slice(0, index), ...children, ...anim.nodes.slice(index + 1)] })
    setSel([children[0]?.id ?? ''].filter(Boolean))
  }, [anim, selected, commit])

  /** Apply a set of dotted-path writes to one node. */
  const applyEdit = useCallback(
    (nodeId: string, patch: Record<string, unknown>, coalesceKey?: string) => {
      const found = findNode(anim.nodes, nodeId)
      if (!found) return
      let next = found
      for (const [path, value] of Object.entries(patch)) next = writePath(next, path, value) as Node
      updateNode(nodeId, next, coalesceKey)
    },
    [anim.nodes, updateNode],
  )

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
        return
      }
      if (typing) return

      switch (e.key) {
        // Time always moves forward with Right, whatever the text direction.
        case 'ArrowRight':
          e.preventDefault()
          clock.step(1 / 30)
          break
        case 'ArrowLeft':
          e.preventDefault()
          clock.step(-1 / 30)
          break
        case ' ':
          e.preventDefault()
          clock.toggle()
          break
        case 'Home':
          clock.restart()
          break
        case 'End':
          clock.seek(clock.duration)
          break
        case 'Delete':
        case 'Backspace':
          if (sel.length === 0) break
          e.preventDefault()
          removeSelection()
          break
        case ',':
          clock.step(-1 / 10)
          break
        case '.':
          clock.step(1 / 10)
          break
        default:
          if (e.ctrlKey || e.metaKey) {
            const k = e.key.toLowerCase()
            if (k === 'c') doCopy()
            else if (k === 'x') {
              doCopy()
              removeSelection()
            } else if (k === 'v') doPaste()
            else if (k === 'd') {
              e.preventDefault()
              doDuplicate()
            } else if (k === 'a') {
              e.preventDefault()
              setSel(selectAll(anim.nodes))
            }
            break
          }
          if (/^[1-9]$/.test(e.key)) {
            setSel([anim.nodes[Number(e.key) - 1]?.id ?? ''].filter(Boolean))
          }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clock, anim, sel, selected, commit, doCopy, doPaste, doDuplicate, removeSelection])

  if (!step) {
    return <div className="p-6 text-sm text-ink-3">گام یافت نشد.</div>
  }

  const selectedNode = selected ? findNode(anim.nodes, selected) ?? null : null

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="flex items-center gap-2 border-b border-hairline bg-surface px-3 py-2">
        <button type="button" onClick={() => router.push(`/view/${presId}`)} className="rounded-lg px-2 py-1 text-2xs font-bold text-ink-3 hover:bg-sunken">
          بازگشت
        </button>
        <span className="truncate text-xs font-black text-ink-2">{anim.title || 'بدون عنوان'}</span>
        <span className={cn('rounded px-1.5 py-0.5 text-2xs font-bold', dirty ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>
          {dirty ? 'ذخیره خودکار…' : 'ذخیره شد'}
        </span>
        {importWarnings.length > 0 ? (
          <span
            role="status"
            className="max-w-64 truncate text-2xs text-warn"
            title={importWarnings.join('\n')}
          >
            {importWarnings[0]}
            {importWarnings.length > 1 ? ` (+${importWarnings.length - 1})` : ''}
          </span>
        ) : null}
        <div className="ms-auto flex items-center gap-1">
          <button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={!canUndo(history)} aria-label="واگرد" className="grid size-7 place-items-center rounded-lg border border-hairline disabled:opacity-40">
            <Undo2 className="size-3.5" />
          </button>
          <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={!canRedo(history)} aria-label="ازنو" className="grid size-7 place-items-center rounded-lg border border-hairline disabled:opacity-40">
            <Redo2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setRecord((v) => !v)}
            aria-pressed={record}
            className={cn(
              'flex items-center gap-1 rounded-lg border px-2 py-1 text-2xs font-bold',
              record ? 'border-danger bg-danger text-white' : 'border-hairline text-ink-3',
            )}
          >
            ضبط (R)
          </button>
          <button
            type="button"
            onClick={() => saveStep(presId, slideId, stepId, { anim: anim as never })}
            className="flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-2xs font-bold text-white"
          >
            <Save className="size-3" />
            ذخیره
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[15rem_1fr_18rem]">
        <aside className="surface flex min-h-0 flex-col overflow-hidden rounded-none border-e border-hairline border-t-0 border-s-0">
          <SceneTreePanel
            nodes={anim.nodes}
            selected={selected}
            expanded={expanded}
            onSelect={select}
            onToggleExpand={toggleExpanded}
            onToggleVisible={(id) => {
              const n = findNode(anim.nodes, id)
              if (n) toggleOn(id, 'visible', n.visible === false)
            }}
            onToggleLock={(id) => {
              const n = findNode(anim.nodes, id)
              if (n) toggleOn(id, 'locked', n.locked !== true)
            }}
            onToggleExpandNode={toggleExpanded}
            onAdd={addNode}
            onGroup={groupSelected}
            onUngroup={ungroupSelected}
          />
        </aside>

        <main className="flex min-h-0 flex-col overflow-hidden">
          <div ref={laneRef} className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="surface rounded-2xl p-2">
              <SceneToolbar
                anim={anim}
                svgRef={sceneSvgRef}
                onImport={(next, warnings) => {
                  setImportWarnings(warnings)
                  commit(next, 'import')
                  setSel([])
                }}
              />
              <EditorCanvas
                svgRef={sceneSvgRef}
                runtimeRef={canvasRuntime}
                anim={anim}
                clock={clock}
                selected={selected}
                record={record}
                onSelect={select}
                onScrub={(time) => clock.seek(time)}
                onBegin={() => dispatch({ type: 'begin' })}
                onPreview={(edit) => applyEdit(edit.nodeId, edit.patch, undefined)}
                onCommit={(edit) => {
                  applyEdit(edit.nodeId, edit.patch, edit.coalesceKey)
                  // Close the transaction. Without this the drag stays
                  // "open" forever and nothing ever reaches the undo stack.
                  dispatch({ type: 'commit' })
                }}
              />
              <p className="mt-1 px-1 text-[10px] text-ink-3">
                روی شکل کلیک کنید تا انتخاب شود؛ بکشید تا جابه‌جا شود. دستگیره‌ها اندازه و چرخش را عوض می‌کنند.
                {record ? ' — حالت ضبط: کشیدن، کی‌فریم می‌سازد.' : ''}
              </p>
            </div>
          </div>
        </main>

        <aside className="surface flex min-h-0 flex-col overflow-hidden rounded-none border-s border-t-0 border-e-0 border-hairline">
          <div className="flex gap-1 border-b border-hairline p-1">
            {(['node', 'params', 'templates'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 rounded-lg px-2 py-1 text-2xs font-bold transition',
                  tab === t ? 'bg-brand text-white' : 'text-ink-3 hover:bg-sunken',
                )}
              >
                {t === 'node' ? 'گره' : t === 'params' ? 'پارامتر' : 'قالب‌ها'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
            {tab === 'node' ? (
              selectedNode ? (
                <NodeInspector
                  node={selectedNode}
                  anim={anim}
                  onNode={(id, next) => updateNode(id, next, `prop:${id}:${JSON.stringify(next.transform)}`)}
                />
              ) : (
                <p className="p-3 text-2xs text-ink-3">گرهی انتخاب نشده.</p>
              )
            ) : null}
            {tab === 'params' ? (
              <ParamsPanel
                anim={anim}
                onAction={(_name, actions) => canvasRuntime.current?.run(actions)}
                onParam={(name, patch) => {
                  if (name === '__duration') {
                    commit({ ...anim, duration: Number((patch as { duration: number }).duration) || 6 })
                    setView(fullView(Number((patch as { duration: number }).duration) || 6))
                    return
                  }
                  if (name === '__loop') {
                    commit({ ...anim, loop: Boolean((patch as { loop: boolean }).loop) })
                    return
                  }
                  if (patch === null) {
                    const params = { ...anim.params }
                    delete params[name]
                    commit({ ...anim, params })
                    return
                  }
                  commit({ ...anim, params: { ...anim.params, [name]: { ...anim.params[name], ...patch } } }, `param:${name}`)
                }}
              />
            ) : null}
            {tab === 'templates' ? <TemplateGallery onInsert={insertTemplate} /> : null}
          </div>
        </aside>
      </div>

      <div className="shrink-0">
        <Timeline
          anim={anim}
          nodes={anim.nodes}
          t={clock.t}
          width={laneWidth}
          selected={selected}
          view={view}
          onView={setView}
          onSeek={(t) => clock.seek(t)}
          onSelect={select}
          onEdit={(nodeId, path, next, coalesceKey) => {
            const node = findNode(anim.nodes, nodeId)
            if (!node) return
            updateNode(nodeId, writePath(node, path, next) as Node, coalesceKey)
          }}
          onBegin={() => dispatch({ type: 'begin' })}
          onPreview={(nodeId, path, next) => {
            const node = findNode(anim.nodes, nodeId)
            if (!node) return
            updateNode(nodeId, writePath(node, path, next) as Node)
          }}
        />
      </div>

      <p className="flex items-center gap-1 border-t border-hairline bg-surface px-3 py-1 text-[10px] text-ink-3">
        <ArrowRight className="size-3" />
        زمان همیشه از چپ به راست است. فاصله یک قاب: ‎. و , — پخش: Space — واگرد: Ctrl+Z — ضبط کی‌فریم: R
      </p>
    </div>
  )
}