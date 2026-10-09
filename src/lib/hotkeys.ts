import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { comboFromEvent, isEditableTarget } from './utils'

/**
 * A single keyboard shortcut.
 *
 * `combo` is a normalised, `+`-separated string:
 *   'mod+k'  ·  'shift+?'  ·  'arrowleft'  ·  'space'  ·  'mod+shift+e'
 * `mod` maps to ⌘ on macOS and Ctrl elsewhere.
 */
/**
 * `?` needs three registrations: browsers report it as `?` (no shift) or
 * `shift+?`, and some layouts send the bare `/` with shift held.
 */
export const HELP_COMBOS = ['?', 'shift+?', 'shift+/'] as const

export type Hotkey = {
  id: string
  combo: string
  label: string
  group: string
  run: (e: KeyboardEvent) => void
  /** still fire while the caret is inside an input/textarea */
  allowInInput?: boolean
  /** fire even while a modal is open (defaults to false) */
  overOverlay?: boolean
  /** higher wins when two handlers share a combo */
  priority?: number
  hidden?: boolean
}

type Entry = Hotkey & { _seq: number }

const registry = new Map<string, Entry>()
const listeners = new Set<() => void>()
let seq = 0

function emit() {
  for (const l of listeners) l()
}

function currentSeq() {
  return seq
}

export function registerHotkeys(defs: Hotkey[]): () => void {
  const stamp = currentSeq()
  const added: [string, Entry][] = []
  for (const def of defs) {
    const combo = def.combo.toLowerCase()
    const prev = registry.get(combo)
    // A duplicate mount of the same definition is a no-op.
    if (prev && prev.id === def.id) continue
    if (prev && (prev.priority ?? 0) > (def.priority ?? 0)) continue
    seq += 1
    const entry: Entry = { ...def, combo, _seq: stamp * 1000 + seq }
    registry.set(combo, entry)
    added.push([combo, entry])
  }
  emit()
  return () => {
    for (const [combo, entry] of added) {
      // Only remove it if nothing overwrote it in the meantime.
      if (registry.get(combo) === entry) registry.delete(combo)
    }
    emit()
  }
}

/** Subscribe to registry changes so the help sheet stays live. */
/**
 * The live shortcut list, sorted by registration order. Re-computed whenever
 * the registry changes so the help sheet can never go stale.
 */
export function useHotkeyIndex(): Hotkey[] {
  const [tick, bump] = useState(0)
  useEffect(() => {
    const l = () => bump((x) => x + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  // `tick` is the invalidation signal — the registry is a plain module Map, so
  // React needs to be told to look at it again.
  void tick
  return [...registry.values()].sort((a, b) => a._seq - b._seq)
}

/**
 * A container-level handler (the animation studio, the timeline) marks the
 * native event as claimed when it consumes a keystroke. The global listener
 * then stands down — without a stopPropagation, which would also starve the
 * inner React handlers that run later in the bubble.
 */
const CLAIM = '__stClaimed'

let overlayDepth = 0
export function pushOverlay() {
  overlayDepth += 1
}
export function popOverlay() {
  overlayDepth = Math.max(0, overlayDepth - 1)
}
function overlayOpen() {
  return overlayDepth > 0
}

function handle(e: KeyboardEvent) {
  if (e.isComposing) return
  if ((e as unknown as Record<string, unknown>)[CLAIM]) return
  const combo = comboFromEvent(e)
  const entry = registry.get(combo)
  if (!entry) return
  if (entry.overOverlay !== true && overlayOpen()) return
  if (isEditableTarget(e.target) && entry.allowInInput !== true) return
  e.preventDefault()
  entry.run(e)
}

let bound = false
function ensureBound() {
  if (bound) return
  bound = true
  window.addEventListener('keydown', handle, { capture: false })
}

/**
 * Registers a set of shortcuts for the lifetime of the component.
 *
 * Layout effect on purpose: shortcuts must be live before the first paint, so
 * a keystroke that arrives immediately after mount is never dropped.
 */
export function useHotkeys(defs: Hotkey[], deps: unknown[] = []) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => registerHotkeys(defs), deps)
}

/**
 * Key handling scoped to a container — used by the animation studio, where
 * Space/arrows/K must work even while a slider has focus.
 *
 * The handler calls `preventDefault()` on anything it consumes; that marks
 * the event as claimed so the global shortcuts don't also fire, while the
 * event still reaches the inner React handlers below the container.
 */
export function useLocalKeys<T extends HTMLElement>(
  handler: (e: React.KeyboardEvent<T>) => void,
  deps: unknown[] = [],
) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      const fake = {
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        target: e.target,
        currentTarget: el,
        defaultPrevented: e.defaultPrevented,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => e.stopPropagation(),
      } as unknown as React.KeyboardEvent<T>
      handler(fake)
      if (e.defaultPrevented) (e as unknown as Record<string, unknown>)[CLAIM] = true
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

if (typeof window !== 'undefined') {
  // One listener for the whole app, installed at module load. Every route
  // registers/unregisters its own entries in the registry above.
  ensureBound()
}
