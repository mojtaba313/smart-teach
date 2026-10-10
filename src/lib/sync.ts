'use client'

import { useSyncExternalStore } from 'react'

/**
 * The database is the durable store; `localStorage` is a write-through cache
 * in front of it.
 *
 * That ordering is deliberate. The app must stay instant and must survive the
 * API being down (offline class, server restart, laptop on a train), so every
 * write lands in the cache first and is pushed to Prisma in the background.
 * On boot the two reconcile: whatever the server has wins, and anything the
 * server has never seen is pushed up — which is also how the existing local
 * library migrates itself without an export/import step.
 */

/**
 * Same-origin by default: in Next the Route Handlers are served by the very
 * app that calls them, so the browser needs no configuration. Set
 * `NEXT_PUBLIC_API_URL` only when the API lives on another host.
 */
export const BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export type SyncState = 'starting' | 'online' | 'offline'

let state: SyncState = 'starting'
const listeners = new Set<() => void>()
let online = true

function set(next: SyncState) {
  if (state === next) return
  state = next
  for (const l of listeners) l()
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
    () => state,
  )
}

function subscribe(path: string, init: RequestInit = {}): Promise<Response | null> {
  if (!online) return Promise.resolve(null)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  return fetch(`${BASE}${path}`, {
    ...init,
    signal: ctrl.signal,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
    .then((r) => {
      set('online')
      return r
    })
    .catch(() => {
      online = false
      set('offline')
      // Try again on the next write rather than hammering a dead server.
      setTimeout(() => {
        online = true
      }, 5000)
      return null
    })
    .finally(() => clearTimeout(timer))
}

async function send(path: string, method: string, body?: unknown) {
  const res = await subscribe(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  return res && res.ok ? res.json() : null
}

/* ------------------------------------------------------------------ *
 *  Pushes — every one of these is best-effort by design
 * ------------------------------------------------------------------ */

export const api = {
  health: () => send('/api/health', 'GET'),
  questions: () => send('/api/questions', 'GET') as Promise<unknown[] | null>,
  saveQuestions: (list: unknown[]) => send('/api/questions/bulk', 'POST', list),
  deleteQuestion: (id: string) => send(`/api/questions/${encodeURIComponent(id)}`, 'DELETE'),
  presentations: () => send('/api/presentations', 'GET') as Promise<unknown[] | null>,
  savePresentation: (p: unknown) => send(`/api/presentations/${encodeURIComponent((p as { id: string }).id)}`, 'PUT', p),
  bulkPresentations: (list: unknown[]) => send('/api/presentations/bulk', 'POST', list),
  deletePresentation: (id: string) => send(`/api/presentations/${encodeURIComponent(id)}`, 'DELETE'),
  saveProgress: (id: string, step: number) => send(`/api/progress/${encodeURIComponent(id)}`, 'PUT', { step }),
  getProgress: (id: string) => send(`/api/progress/${encodeURIComponent(id)}`, 'GET') as Promise<{ step?: number } | null>,
}

/**
 * Load from the database, at boot.
 *
 * PostgreSQL is the source of truth. When the API answers, its rows *replace*
 * the cache — the cache is a mirror, not a second opinion. When it does not
 * answer, the cache is all there is, and the UI says so.
 *
 * The old behaviour merged the two (cache rows the server had never seen got
 * pushed up). That was right once, when the database was new; now it would let
 * a stale browser quietly resurrect deleted work, so it is opt-in instead —
 * see `pushLocalToServer`.
 */
export async function syncOnBoot(): Promise<void> {
  const serverQuestions = await api.questions()
  if (serverQuestions) {
    writeCache('smart-teach:question-bank:v1', { schema: 1, questions: serverQuestions, updatedAt: Date.now() })
  }

  const serverDecks = await api.presentations()
  if (serverDecks) {
    writeCache('smart-teach:presentations:v2', serverDecks)
  }

  if (serverQuestions || serverDecks) {
    set('online')
    // Anything written while the API was unreachable goes up now, in order.
    void flushPending()
  } else {
    set('offline')
  }
}

/* ------------------------------------------------------------------ *
 *  Offline queue
 *
 *  A write that cannot reach the server is not lost: it is parked in
 *  `pending`, and flushed on the next successful load. That is what keeps the
 *  cache worth having at all — it is the queue, not a shadow database.
 * ------------------------------------------------------------------ */

const PENDING_KEY = 'smart-teach:pending:v1'
type Pending = { kind: 'questions' | 'presentations'; data: unknown[]; at: number }

function readPending(): Pending[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    return raw ? (JSON.parse(raw) as Pending[]) : []
  } catch {
    return []
  }
}

function writePending(list: Pending[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list))
  } catch {
    /* the cache is already full; the lesson above says so */
  }
}

/** Park a write for later. Bounded, so an offline week cannot eat the quota. */
function enqueue(kind: Pending['kind'], data: unknown) {
  const list = readPending()
  const item = list.find((p) => p.kind === kind)
  if (item) item.data = data as unknown[]
  else list.push({ kind, data: [data], at: Date.now() })
  writePending(list.slice(-20))
}

/**
 * Send a write, queueing it if the server cannot be reached.
 *
 * The caller has already written to the cache — this is the second half of the
 * write-through. Failing to reach the API must not fail the edit, but it must
 * not silently drop it either.
 */
export async function push(kind: 'questions' | 'presentations', ...data: unknown[]): Promise<boolean> {
  if (data.length === 0) return true
  const ok = kind === 'questions' ? await api.saveQuestions(data) : await api.savePresentation(data[0])
  if (!ok) enqueue(kind, kind === 'questions' ? data : data[0])
  return !!ok
}

export function pendingCount(): number {
  return readPending().reduce((n, p) => n + p.data.length, 0)
}

/** Drain the queue oldest-first; anything still failing stays queued. */
export async function flushPending(): Promise<void> {
  const list = readPending()
  if (list.length === 0) return
  for (const item of list) {
    const ok = item.kind === 'questions' ? await api.saveQuestions(item.data) : await api.bulkPresentations(item.data)
    if (!ok) return // still offline; try again next time
  }
  writePending([])
}

/** Explicit, user-initiated: hand the whole browser library to the server. */
export async function pushLocalToServer(): Promise<{ questions: number; presentations: number }> {
  const questions = (readCache<{ questions?: unknown[] }>('smart-teach:question-bank:v1', {}).questions ?? [])
  const presentations = readCache<unknown[]>('smart-teach:presentations:v2', [])
  if (questions.length > 0) await api.saveQuestions(questions)
  if (presentations.length > 0) await api.bulkPresentations(presentations)
  await syncOnBoot()
  return { questions: questions.length, presentations: presentations.length }
}

/* ------------------------------------------------------------------ *
 *  Cache helpers — the same keys storage.ts uses
 * ------------------------------------------------------------------ */

function readCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* full or blocked — the API still has the data */
  }
}

export const SYNC_BASE = BASE