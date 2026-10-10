'use client'

import { useSyncExternalStore } from 'react'
import type { BankQuestion, Presentation, QuestionBank } from '../types'
import {
  deleteQuestion,
  deletePresentation,
  duplicatePresentation,
  importBank,
  importPresentations,
  invalidateCaches,
  loadBank,
  loadPresentations,
  saveBank,
  savePresentation,
  upsertQuestion,
} from '../storage'

/**
 * Thin external stores over the storage layer.
 *
 * Components subscribe with `useSyncExternalStore`, so the editor, the bank
 * and the presenter always agree without prop-drilling a library array.
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

let booted = false
function boot() {
  if (booted) return
  booted = true
  presStore.set(loadPresentations())
  bankStore.set(loadBank())
}
boot()

export const usePresentations = (): Presentation[] => useSyncExternalStore(presStore.subscribe, presStore.get, presStore.get)

export const useBank = (): QuestionBank => useSyncExternalStore(bankStore.subscribe, bankStore.get, bankStore.get)

export const useQuestions = (): BankQuestion[] => {
  const bank = useBank()
  return bank.questions
}

/* ---- mutations --------------------------------------------------- */

export function putPresentation(pres: Presentation) {
  presStore.set(savePresentation(pres))
}

export function removePresentation(id: string) {
  presStore.set(deletePresentation(id))
}

export function copyPresentation(id: string): Presentation | undefined {
  const copy = duplicatePresentation(id)
  presStore.set(loadPresentations())
  return copy
}

/** Re-read the cache after the database reconciliation. */
export function refreshStores() {
  invalidateCaches()
  presStore.set(loadPresentations())
  bankStore.set(loadBank())
}

export function ingestPresentations(input: unknown): Presentation[] {
  const next = importPresentations(input)
  presStore.set(next)
  return next
}

export function putQuestion(q: BankQuestion) {
  bankStore.set(upsertQuestion(q))
}

export function removeQuestion(id: string) {
  bankStore.set(deleteQuestion(id))
}

export function ingestBank(input: unknown): QuestionBank {
  const next = saveBank(importBank(input))
  bankStore.set(next)
  return next
}
