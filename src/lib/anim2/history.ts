/**
 * Undo/redo as a pure reducer.
 *
 * v1 kept `past` and `future` in refs and pushed history from inside state
 * updaters in two places, so undo silently skipped those edits. It also had no
 * transaction concept, which meant a drag produced one undo step per frame.
 *
 * Here the whole thing is one value and one function. Three rules:
 *
 * - **Nothing happens inside a state updater.** Everything is a plain return.
 * - **A drag is one step.** `begin` remembers the starting value, `preview`
 *   changes the present without touching history, `commit` pushes the old
 *   value exactly once.
 * - **Typing coalesces.** Two edits to the same field within half a second
 *   are one undo step, so ctrl-Z removes a word rather than a letter.
 */

import type { Animation2 } from '../../types/anim2'

export type History = {
  present: Animation2
  past: Animation2[]
  future: Animation2[]
  /** Value at the moment the current transaction opened. */
  baseline: Animation2 | null
  /** Field the last coalesced edit touched, and when. */
  lastKey: string | null
  lastAt: number
}

export type HistoryAction =
  | { type: 'set'; next: Animation2; coalesceKey?: string; now?: number }
  | { type: 'begin' }
  | { type: 'preview'; next: Animation2 }
  | { type: 'commit'; now?: number }
  | { type: 'cancel' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'replace'; next: Animation2 }

export const HISTORY_LIMIT = 80
export const COALESCE_MS = 500

export function initHistory(present: Animation2): History {
  return { present, past: [], future: [], baseline: null, lastKey: null, lastAt: 0 }
}

const push = (past: Animation2[], value: Animation2): Animation2[] => {
  const next = [...past, value]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}

export function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case 'set': {
      // Inside an open transaction, an edit belongs to the drag: it changes
      // the present and the commit will record the baseline once.
      if (state.baseline) return { ...state, present: action.next }

      const now = action.now ?? 0
      const sameField =
        action.coalesceKey !== undefined &&
        action.coalesceKey === state.lastKey &&
        now - state.lastAt < COALESCE_MS &&
        state.baseline === null

      // Same field, inside the window: replace the present without growing
      // history, so ctrl-Z takes back the whole edit rather than one keystroke.
      if (sameField) {
        return { ...state, present: action.next, lastAt: now }
      }
      return {
        ...state,
        present: action.next,
        past: push(state.past, state.present),
        future: [],
        lastKey: action.coalesceKey ?? null,
        lastAt: now,
      }
    }

    case 'begin':
      // Opening a transaction that is already open is a no-op, so a stray
      // pointerdown cannot corrupt the baseline.
      if (state.baseline) return state
      return { ...state, baseline: state.present, lastKey: null, lastAt: 0 }

    case 'preview':
      // The present moves; history does not. A cancelled drag leaves no scar.
      return { ...state, present: action.next }

    case 'commit': {
      if (!state.baseline) return { ...state, lastKey: null, lastAt: 0 }
      const unchanged = sameDocument(state.baseline, state.present)
      return {
        ...state,
        present: state.present,
        past: unchanged ? state.past : push(state.past, state.baseline),
        future: [],
        baseline: null,
        lastKey: null,
        lastAt: action.now ?? 0,
      }
    }

    case 'cancel':
      return state.baseline
        ? { ...state, present: state.baseline, baseline: null, lastKey: null, lastAt: 0 }
        : state

    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return {
        ...state,
        present: previous,
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future].slice(0, HISTORY_LIMIT),
        baseline: null,
        lastKey: null,
        lastAt: 0,
      }
    }

    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      return {
        ...state,
        present: next,
        past: push(state.past, state.present),
        future: state.future.slice(1),
        baseline: null,
        lastKey: null,
        lastAt: 0,
      }
    }

    case 'replace':
      // Loading a different document: history is for that document only.
      return initHistory(action.next)

    default:
      return state
  }
}

function sameDocument(a: Animation2, b: Animation2): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

export const canUndo = (h: History): boolean => h.past.length > 0
export const canRedo = (h: History): boolean => h.future.length > 0