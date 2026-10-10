'use client'

import type { BankQuestion, Presentation, QuestionBank } from './types'
import { api, push } from './lib/sync'
import { arr, isNum, isStr } from './model/migrate'
import { migrateAnswerKey, migratePresentation, migrateQuestion } from './model/migrate'

// The normalisation rules live in `model/migrate.ts` so the Route Handlers can
// share them; they are re-exported here because that is where callers expect
// them.
export { migrateAnswerKey, migratePresentation, migrateQuestion }
import { SCHEMA_VERSION, blankPresentation, uid } from './types'

const K_PRES = 'smart-teach:presentations:v2'
const K_BANK = 'smart-teach:question-bank:v1'
const K_PROGRESS = 'smart-teach:progress:'

/** Legacy key from v1 of the app — migrated on first read, then left alone. */
const K_PRES_LEGACY = 'presentations'

/* ------------------------------------------------------------------ *
 *  Small helpers
 * ------------------------------------------------------------------ */

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}



/**
 * The answer key is a slide, so it goes through the same migration as deck
 * blocks: an animation block in it must not be dropped because it looks odd.
 */


/* ------------------------------------------------------------------ *
 *  Presentations
 * ------------------------------------------------------------------ */

let presCache: Presentation[] | null = null

function readPresentations(): Presentation[] {
  if (presCache) return presCache
  let list: Presentation[] = []
  const current = readJSON<unknown>(K_PRES, null)
  if (Array.isArray(current)) {
    list = current.map(migratePresentation).filter((p): p is Presentation => p !== null)
  } else {
    // First run after the upgrade: rescue the v1 bucket and write it straight
    // through, so the migration survives a reload instead of repeating.
    const legacy = readJSON<unknown>(K_PRES_LEGACY, null)
    if (legacy !== null) {
      list = (Array.isArray(legacy) ? legacy : [legacy])
        .map(migratePresentation)
        .filter((p): p is Presentation => p !== null)
      presCache = list
      if (list.length > 0) {
        try {
          writeJSON(K_PRES, list)
          localStorage.removeItem(K_PRES_LEGACY)
        } catch {
          /* keep the legacy copy around as a fallback */
        }
      }
      return list
    }
  }
  presCache = list
  return list
}

function writePresentations(list: Presentation[]): void {
  presCache = list
  writeJSON(K_PRES, list)
}

function persist(list: Presentation[]): Presentation[] {
  try {
    writePresentations(list)
    return list
  } catch {
    throw new Error('حافظهٔ مرورگر پر است؛ از دکمهٔ «خروجی» پشتیبان بگیرید.')
  }
}

export function loadPresentations(): Presentation[] {
  return readPresentations()
}

export function savePresentation(pres: Presentation): Presentation[] {
  const stamped: Presentation = { ...pres, schema: SCHEMA_VERSION, updatedAt: Date.now() }
  const all = readPresentations()
  const idx = all.findIndex((p) => p.id === stamped.id)
  const next = idx >= 0 ? all.map((p) => (p.id === stamped.id ? stamped : p)) : [...all, stamped]
  void push('presentations', stamped)
  return persist(next)
}

export function deletePresentation(id: string): Presentation[] {
  void api.deletePresentation(id)
  return persist(readPresentations().filter((p) => p.id !== id))
}

export function duplicatePresentation(id: string): Presentation | undefined {
  const all = readPresentations()
  const found = all.find((p) => p.id === id)
  if (!found) return undefined
  const copy: Presentation = {
    ...structuredClone(found),
    id: uid('pres'),
    title: `${found.title} (کپی)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  persist([...all, copy])
  return copy
}

export function importPresentations(input: unknown): Presentation[] {
  const list = Array.isArray(input) ? input : [input]
  const incoming = list.map(migratePresentation).filter((p): p is Presentation => p !== null)
  if (incoming.length === 0) throw new Error('فایل JSON معتبر نیست')
  const byId = new Map(readPresentations().map((p) => [p.id, p]))
  for (const p of incoming) byId.set(p.id, { ...p, updatedAt: Date.now() })
  void api.bulkPresentations(incoming)
  return persist([...byId.values()])
}

export function downloadJSON(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFilename(name: string): string {
  return (name || 'presentation').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)
}

/* ------------------------------------------------------------------ *
 *  Question bank
 * ------------------------------------------------------------------ */

let bankCache: QuestionBank | null = null

/** Drop the in-memory caches so the next read comes from localStorage. */
export function invalidateCaches() {
  presCache = null
  bankCache = null
}

export function loadBank(): QuestionBank {
  if (bankCache) return bankCache
  const raw = readJSON<unknown>(K_BANK, null)
  const questions = Array.isArray(raw)
    ? raw.map(migrateQuestion).filter((q): q is BankQuestion => q !== null)
    : ((raw as { questions?: unknown[] } | null)?.questions ?? [])
        .map(migrateQuestion)
        .filter((q): q is BankQuestion => q !== null)
  bankCache = { schema: 1, questions, updatedAt: Date.now() }
  bankCache.questions = questions
  return bankCache
}

export function saveBank(next: QuestionBank): QuestionBank {
  const stamped = { ...next, updatedAt: Date.now() }
  try {
    writeJSON(K_BANK, stamped)
  } catch {
    throw new Error('حافظهٔ مرورگر پر است؛ بانک سؤال را خروجی بگیرید.')
  }
  bankCache = stamped
  return stamped
}

export function upsertQuestion(q: BankQuestion): QuestionBank {
  const bank = loadBank()
  const stamp: BankQuestion = { ...q, updatedAt: Date.now() }
  void push('questions', stamp)
  const idx = bank.questions.findIndex((x) => x.id === q.id)
  const questions = idx >= 0 ? bank.questions.map((x) => (x.id === q.id ? stamp : x)) : [...bank.questions, stamp]
  return saveBank({ ...bank, questions })
}

export function deleteQuestion(id: string): QuestionBank {
  const bank = loadBank()
  void api.deleteQuestion(id)
  return saveBank({ ...bank, questions: bank.questions.filter((q) => q.id !== id) })
}

export function importBank(input: unknown): QuestionBank {
  const raw = Array.isArray(input) ? input : (input as { questions?: unknown[] })?.questions
  const questions = (Array.isArray(raw) ? raw : []).map(migrateQuestion).filter((q): q is BankQuestion => q !== null)
  if (questions.length === 0) throw new Error('فایل بانک سؤال معتبر نیست')
  const bank = loadBank()
  const byId = new Map(bank.questions.map((q) => [q.id, q]))
  for (const q of questions) byId.set(q.id, q)
  return saveBank({ ...bank, questions: [...byId.values()] })
}

/* ------------------------------------------------------------------ *
 *  Viewer progress
 * ------------------------------------------------------------------ */

export function loadProgress(id: string): number | undefined {
  const p = readJSON<{ step?: unknown; slide?: unknown }>(K_PROGRESS + id, {})
  if (isNum(p.step)) return p.step
  return undefined
}

export function saveProgress(id: string, step: number) {
  try {
    writeJSON(K_PROGRESS + id, { step })
  } catch {
    /* ignore — progress is disposable */
  }
}

export function clearProgress(id: string) {
  try {
    localStorage.removeItem(K_PROGRESS + id)
  } catch {
    /* ignore */
  }
}

export { blankPresentation, arr as toArray, isNum, isStr }
