import { describe, expect, it } from 'vitest'
import {
  canRedo,
  canUndo,
  COALESCE_MS,
  historyReducer,
  initHistory,
  type History,
} from './history'
import type { Animation2 } from '../../types/anim2'

const doc = (title: string): Animation2 => ({
  schema: 2,
  title,
  duration: 6,
  params: {},
  cues: [],
  nodes: [],
})

const run = (state: History, ...actions: Parameters<typeof historyReducer>[1][]): History =>
  actions.reduce(historyReducer, state)

describe('undo and redo', () => {
  it('does nothing when there is no history', () => {
    const h = initHistory(doc('a'))
    expect(canUndo(h)).toBe(false)
    expect(historyReducer(h, { type: 'undo' })).toBe(h)
  })

  it('goes back and forward', () => {
    const h = run(initHistory(doc('a')), { type: 'set', next: doc('b') }, { type: 'set', next: doc('c') })
    expect(canUndo(h)).toBe(true)
    const back = historyReducer(h, { type: 'undo' })
    expect(back.present.title).toBe('b')
    const forward = historyReducer(back, { type: 'redo' })
    expect(forward.present.title).toBe('c')
    expect(canRedo(forward)).toBe(false)
  })

  it('drops the redo stack once a new edit lands', () => {
    const h = run(initHistory(doc('a')), { type: 'set', next: doc('b') }, { type: 'undo' }, { type: 'set', next: doc('c') })
    expect(canRedo(h)).toBe(false)
  })
})

describe('transactions', () => {
  /**
   * The v1 behaviour: a drag pushed one history entry per pointermove, so
   * undoing a single drag took forty presses.
   */
  it('records one undo step for a whole drag', () => {
    const h = run(
      initHistory(doc('a')),
      { type: 'begin' },
      { type: 'preview', next: doc('b') },
      { type: 'preview', next: doc('c') },
      { type: 'preview', next: doc('d') },
      { type: 'commit' },
    )
    expect(h.past).toHaveLength(1)
    expect(h.past[0].title).toBe('a')
    expect(historyReducer(h, { type: 'undo' }).present.title).toBe('a')
  })

  it('never touches history while previewing', () => {
    let h = historyReducer(initHistory(doc('a')), { type: 'begin' })
    for (let i = 0; i < 10; i += 1) h = historyReducer(h, { type: 'preview', next: doc(`t${i}`) })
    expect(h.past).toHaveLength(0)
    expect(h.present.title).toBe('t9')
  })

  it('reverts cleanly when a drag is cancelled', () => {
    const h = run(
      initHistory(doc('a')),
      { type: 'begin' },
      { type: 'preview', next: doc('b') },
      { type: 'cancel' },
    )
    expect(h.present.title).toBe('a')
    expect(h.past).toHaveLength(0)
  })

  it('ignores a second begin, so a stray pointerdown cannot corrupt it', () => {
    const first = historyReducer(initHistory(doc('a')), { type: 'begin' })
    const again = historyReducer(first, { type: 'begin' })
    expect(again).toBe(first)
  })

  it('records nothing for a drag that changed nothing', () => {
    const h = run(initHistory(doc('a')), { type: 'begin' }, { type: 'preview', next: doc('a') }, { type: 'commit' })
    expect(h.past).toHaveLength(0)
  })

  it('clears the transaction on undo', () => {
    const h = run(initHistory(doc('a')), { type: 'set', next: doc('b') }, { type: 'begin' })
    expect(historyReducer(h, { type: 'undo' }).baseline).toBe(null)
  })
})

describe('typing coalesces', () => {
  it('treats repeated edits to one field as one undo step', () => {
    let h = initHistory(doc('a'))
    h = historyReducer(h, { type: 'set', next: doc('ab'), coalesceKey: 'title', now: 0 })
    h = historyReducer(h, { type: 'set', next: doc('abc'), coalesceKey: 'title', now: 100 })
    h = historyReducer(h, { type: 'set', next: doc('abcd'), coalesceKey: 'title', now: 200 })
    expect(h.past).toHaveLength(1)
    expect(historyReducer(h, { type: 'undo' }).present.title).toBe('a')
  })

  it('starts a new step after the window closes', () => {
    let h = initHistory(doc('a'))
    h = historyReducer(h, { type: 'set', next: doc('ab'), coalesceKey: 'title', now: 0 })
    h = historyReducer(h, { type: 'set', next: doc('abc'), coalesceKey: 'title', now: COALESCE_MS + 1 })
    expect(h.past).toHaveLength(2)
  })

  it('does not coalesce different fields', () => {
    let h = initHistory(doc('a'))
    h = historyReducer(h, { type: 'set', next: doc('ab'), coalesceKey: 'title', now: 0 })
    h = historyReducer(h, { type: 'set', next: doc('cd'), coalesceKey: 'other', now: 10 })
    expect(h.past).toHaveLength(2)
  })

  it('does not coalesce while a transaction is open', () => {
    let h = run(initHistory(doc('a')), { type: 'begin' })
    h = historyReducer(h, { type: 'set', next: doc('b'), coalesceKey: 'x', now: 0 })
    h = historyReducer(h, { type: 'set', next: doc('c'), coalesceKey: 'x', now: 10 })
    h = historyReducer(h, { type: 'commit' })
    expect(h.past).toHaveLength(1)
  })
})

describe('documents are independent', () => {
  it('clears history when a different document is loaded', () => {
    const h = run(initHistory(doc('a')), { type: 'set', next: doc('b') }, { type: 'replace', next: doc('other') })
    expect(canUndo(h)).toBe(false)
    expect(h.present.title).toBe('other')
  })

  it('caps the history so a long session cannot grow without bound', () => {
    let h = initHistory(doc('a'))
    for (let i = 0; i < 200; i += 1) {
      h = historyReducer(h, { type: 'set', next: doc(`t${i}`), coalesceKey: `f${i}` })
    }
    expect(h.past.length).toBeLessThanOrEqual(80)
  })
})

describe('the reducer is pure', () => {
  it('never mutates the state it is given', () => {
    const start = initHistory(doc('a'))
    const snapshot = JSON.stringify(start)
    run(start, { type: 'set', next: doc('b') }, { type: 'begin' }, { type: 'preview', next: doc('c') }, { type: 'commit' })
    expect(JSON.stringify(start)).toBe(snapshot)
  })

  it('is a pure function of its inputs, which is what StrictMode requires', () => {
    // StrictMode invokes an updater twice with the *same input state*. A
    // reducer that pushed history inside an updater would double every entry.
    const input = initHistory(doc('a'))
    const action = { type: 'set', next: doc('b') } as const
    const first = historyReducer(input, action)
    const second = historyReducer(input, action)
    expect(second).toEqual(first)
    expect(input.past).toHaveLength(0)
  })
})