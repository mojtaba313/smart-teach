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
 * Each one awaits the database and then re-reads it. The alternative — patch
 * the array in memory and push in the background — is what produced the sync
 * problems: the UI showed a change the server had never accepted.
 */

export async function putPresentation(pres: Presentation): Promise<Presentation[]> {
  const next = await savePresentation(pres)
  presStore.set(next)
  return next
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
