'use client'

import { useSyncExternalStore } from 'react'
import type { BankQuestion, Presentation, QuestionBank } from '../types'
import {
  deleteQuestion,
  deletePresentation,
  duplicatePresentation,
  importBank,
  importPresentations,
  loadBank,
  loadPresentations,
  savePresentation,
  upsertQuestion,
} from '../storage'

/**
 * Thin external stores over the storage layer.
 *
 * Components subscribe with `useSyncExternalStore`, so the editor, the bank
 * and the presenter always agree without prop-drilling a library array.
 *
 * The stores start empty and fill once the API answers. They used to be filled
 * synchronously at import time, which meant a component could read a store that
 * had never been loaded and silently see an empty library; `isReady` makes the
 * difference explicit now.
 */

function createStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: T) => {
      value = next
      for (const l of listeners) l()
    },
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
}

const presStore = createStore<Presentation[]>([])
const bankStore = createStore<QuestionBank>({ schema: 1, questions: [], updatedAt: 0 })

/**
 * Both stores start empty and fill once the API answers.
 *
 * They used to be filled synchronously from `localStorage` at import time,
 * which meant a component could read a store that had never been loaded and
 * silently see an empty library. Now `ready` is explicit: callers that care can
 * wait, and nothing pretends to be loaded before it is.
 */
let ready = false
const readyListeners = new Set<() => void>()

function markReady() {
  if (ready) return
  ready = true
  for (const l of readyListeners) l()
}

export function isReady(): boolean {
  return ready
}

export function onReady(cb: () => void): () => void {
  readyListeners.add(cb)
  return () => {
    readyListeners.delete(cb)
  }
}

let booted = false
async function boot() {
  if (booted) return
  booted = true
  // Settled separately: one failing must not leave the other empty forever.
  const [pres, bank] = await Promise.allSettled([loadPresentations(), loadBank()])
  if (pres.status === 'fulfilled') presStore.set(pres.value)
  if (bank.status === 'fulfilled') bankStore.set(bank.value)
  markReady()
}
void boot()

export const usePresentations = (): Presentation[] => useSyncExternalStore(presStore.subscribe, presStore.get, presStore.get)

export const useBank = (): QuestionBank => useSyncExternalStore(bankStore.subscribe, bankStore.get, bankStore.get)

export const useQuestions = (): BankQuestion[] => {
  const bank = useBank()
  return bank.questions
}

/* ---- mutations ---------------------------------------------------
 *
 * Writes update the store *first* and reconcile with the server afterwards.
 * The previous version awaited the server before touching the store, which
 * broke the editor: `Create.tsx` derives its working deck from the store, so a
 * keystroke whose result had not arrived yet was applied to the previous
 * document, and rapid edits raced each other.
 *
 * The server still wins. On success the authoritative list replaces the
 * optimistic one; on failure the optimistic value is rolled back and the caller
 * is told, rather than the change being silently dropped.
 */

/**
 * How many writes are in flight or queued per deck.
 *
 * A write that started before a newer local edit must not install its result:
 * the response describes an older document, and letting it land replaces the
 * user's next keystroke with stale text. This is why typing "RoundTripProbe"
 * used to arrive as "RuTpPoe".
 */
const inflight = new Map<string, number>()

export async function putPresentation(pres: Presentation): Promise<Presentation[]> {
  const id = pres.id
  const seq = (inflight.get(id) ?? 0) + 1
  inflight.set(id, seq)

  const before = presStore.get()
  presStore.set(upsertLocally(before, pres))
  try {
    const next = await savePresentation(pres)
    // Only accept this response if nothing newer has been written meanwhile.
    if (inflight.get(id) === seq) {
      inflight.delete(id)
      presStore.set(next)
    }
    return next
  } catch (e) {
    if (inflight.get(id) === seq) {
      inflight.delete(id)
      presStore.set(before)
    }
    throw e
  }
}

/** Put a deck into a list without a round trip. */
function upsertLocally(list: Presentation[], pres: Presentation): Presentation[] {
  const stamped: Presentation = { ...pres, updatedAt: Date.now() }
  const i = list.findIndex((p) => p.id === stamped.id)
  return i >= 0 ? list.map((p) => (p.id === stamped.id ? stamped : p)) : [...list, stamped]
}

export async function removePresentation(id: string): Promise<Presentation[]> {
  const next = await deletePresentation(id)
  presStore.set(next)
  return next
}

export async function copyPresentation(id: string): Promise<Presentation | undefined> {
  const copy = await duplicatePresentation(id)
  if (copy) presStore.set(await loadPresentations())
  return copy
}

/** Re-read from the database. */
export async function refreshStores(): Promise<void> {
  const [pres, bank] = await Promise.allSettled([loadPresentations(), loadBank()])
  if (pres.status === 'fulfilled') presStore.set(pres.value)
  if (bank.status === 'fulfilled') bankStore.set(bank.value)
}

export async function ingestPresentations(input: unknown): Promise<Presentation[]> {
  const next = await importPresentations(input)
  presStore.set(next)
  return next
}

export async function putQuestion(q: BankQuestion): Promise<QuestionBank> {
  const next = await upsertQuestion(q)
  bankStore.set(next)
  return next
}

export async function removeQuestion(id: string): Promise<QuestionBank> {
  const next = await deleteQuestion(id)
  bankStore.set(next)
  return next
}

export async function ingestBank(input: unknown): Promise<QuestionBank> {
  const next = await importBank(input)
  bankStore.set(next)
  return next
}
