'use client'

import type { BankQuestion, Presentation, QuestionBank } from './types'
import { api } from './lib/sync'
import { arr, isStr } from './model/migrate'
import { migrateAnswerKey, migratePresentation, migrateQuestion } from './model/migrate'
import { SCHEMA_VERSION, blankPresentation, uid } from './types'

// The normalisation rules live in `model/migrate.ts` so the Route Handlers can
// share them; they are re-rexported here because that is where callers expect
// them.
export { migrateAnswerKey, migratePresentation, migrateQuestion }

/**
 * Storage.
 *
 * PostgreSQL is the only store. There is no `localStorage` mirror and no offline
 * queue, because two writers that can disagree are two sources of truth wearing
 * a hat — the last browser to write won, a stale tab could resurrect deleted
 * work, and a student's own machine held a full copy of every lesson. Every
 * read goes to the API and every write waits for it to succeed, which means a
 * failed write fails loudly instead of disappearing.
 *
 * The tradeoff is honest: the app now needs the server. That was always true;
 * it just used to be hidden behind a cache that pretended otherwise.
 *
 * Everything here is async, because everything is a round trip.
 */

/** Thrown when the API cannot be reached, so the UI can say so plainly. */
export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

const OFFLINE = 'سرور در دسترس نیست. اتصال خود را بررسی کنید؛ تغییرات ذخیره نشده‌اند.'

/* ------------------------------------------------------------------ *
 *  Presentations
 * ------------------------------------------------------------------ */

async function fetchPresentations(): Promise<Presentation[]> {
  const rows = await api.presentations()
  if (!rows) throw new StorageError(OFFLINE)
  return rows
    .map(migratePresentation)
    .filter((p): p is Presentation => p !== null)
}

export async function loadPresentations(): Promise<Presentation[]> {
  return fetchPresentations()
}

export async function savePresentation(pres: Presentation): Promise<Presentation[]> {
  const stamped: Presentation = { ...pres, schema: SCHEMA_VERSION, updatedAt: Date.now() }
  // Wait for the write rather than firing and forgetting: a save that appears
  // to succeed and then does not is worse than one that visibly failed.
  const saved = await api.savePresentation(stamped)
  if (!saved) throw new StorageError(OFFLINE)
  return fetchPresentations()
}

export async function deletePresentation(id: string): Promise<Presentation[]> {
  const ok = await api.deletePresentation(id)
  if (!ok) throw new StorageError(OFFLINE)
  return fetchPresentations()
}

export async function duplicatePresentation(id: string): Promise<Presentation | undefined> {
  const all = await fetchPresentations()
  const found = all.find((p) => p.id === id)
  if (!found) return undefined
  const copy: Presentation = {
    ...structuredClone(found),
    id: uid('pres'),
    title: `${found.title} (کپی)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  const saved = await api.savePresentation(copy)
  if (!saved) throw new StorageError(OFFLINE)
  await fetchPresentations()
  return copy
}

export async function importPresentations(input: unknown): Promise<Presentation[]> {
  const list = Array.isArray(input) ? input : [input]
  const incoming = list.map(migratePresentation).filter((p): p is Presentation => p !== null)
  if (incoming.length === 0) throw new Error('فایل JSON معتبر نیست')
  const ok = await api.bulkPresentations(incoming)
  if (!ok) throw new StorageError(OFFLINE)
  return fetchPresentations()
}

export function downloadJSON(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '')
  return `${cleaned || 'deck'}.json`
}

/* ------------------------------------------------------------------ *
 *  Question bank
 * ------------------------------------------------------------------ */

async function fetchBank(): Promise<QuestionBank> {
  const rows = await api.questions()
  if (!rows) throw new StorageError(OFFLINE)
  const questions = rows.map(migrateQuestion).filter((q): q is BankQuestion => q !== null)
  return { schema: 1, questions, updatedAt: Date.now() }
}

export async function loadBank(): Promise<QuestionBank> {
  return fetchBank()
}

export async function upsertQuestion(q: BankQuestion): Promise<QuestionBank> {
  const stamp: BankQuestion = { ...q, updatedAt: Date.now() }
  const ok = await api.saveQuestions([stamp])
  if (!ok) throw new StorageError(OFFLINE)
  return fetchBank()
}

export async function deleteQuestion(id: string): Promise<QuestionBank> {
  const ok = await api.deleteQuestion(id)
  if (!ok) throw new StorageError(OFFLINE)
  return fetchBank()
}

export async function importBank(input: unknown): Promise<QuestionBank> {
  const raw = Array.isArray(input) ? input : (input as { questions?: unknown[] })?.questions
  const questions = (Array.isArray(raw) ? raw : []).map(migrateQuestion).filter((q): q is BankQuestion => q !== null)
  if (questions.length === 0) throw new Error('فایل بانک سؤال معتبر نیست')
  const ok = await api.saveQuestions(questions)
  if (!ok) throw new StorageError(OFFLINE)
  return fetchBank()
}

/* ------------------------------------------------------------------ *
 *  Viewer progress
 *
 *  Progress is disposable, but it is still per-presentation state and belongs
 *  with the rest of it. Keeping it in localStorage made the deck's progress
 *  depend on which browser you happened to present from.
 * ------------------------------------------------------------------ */

export async function loadProgress(id: string): Promise<number | undefined> {
  const p = await api.getProgress(id)
  const step = p?.step
  return typeof step === 'number' ? step : undefined
}

export async function saveProgress(id: string, step: number): Promise<void> {
  await api.saveProgress(id, step)
}

/** The API stores the furthest step; there is nothing to clear. */
export function clearProgress(_id: string): void {
  /* kept for callers that used to reset a local key */
}

export { blankPresentation, arr as toArray, isStr }