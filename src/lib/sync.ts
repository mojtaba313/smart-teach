'use client'

import { useSyncExternalStore } from 'react'

/**
 * The HTTP client for the Prisma-backed API.
 *
 * PostgreSQL is the only store, so this module no longer decides what is
 * durable — it just reports whether the server answered. `online`/`offline` is
 * surfaced to the user rather than papered over with a local mirror, because a
 * write that silently failed is the failure mode that actually costs work.
 *
 * Every request returns `null` when the server could not be reached, so callers
 * can tell "no" from "unknown" and report which it was.
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

function set(next: SyncState) {
  if (state === next) return
  state = next
  for (const l of listeners) l()
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => state,
    () => state,
  )
}

/**
 * Long enough for a slow database round trip, short enough that a dead server
 * is reported promptly. There is no retry loop: the user is looking at the
 * screen, and a spinner that never resolves is worse than an error.
 */
const TIMEOUT_MS = 8000

async function send(path: string, init: RequestInit = {}): Promise<Response | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })
    set('online')
    return res
  } catch {
    set('offline')
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function read<T>(path: string): Promise<T | null> {
  const res = await send(path)
  if (!res || !res.ok) return null
  return res.json().catch(() => null)
}

/** Writes answer true only when the server confirmed. */
async function write(path: string, method: string, body?: unknown): Promise<boolean> {
  const res = await send(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return !!res && res.ok
}

export const api = {
  health: () => send('/api/health'),
  questions: () => read<unknown[]>('/api/questions'),
  saveQuestions: (list: unknown[]) => write('/api/questions/bulk', 'POST', list),
  deleteQuestion: (id: string) => write(`/api/questions/${encodeURIComponent(id)}`, 'DELETE'),
  presentations: () => read<unknown[]>('/api/presentations'),
  savePresentation: (p: unknown) =>
    write(`/api/presentations/${encodeURIComponent((p as { id: string }).id)}`, 'PUT', p),
  bulkPresentations: (list: unknown[]) => write('/api/presentations/bulk', 'POST', list),
  deletePresentation: (id: string) => write(`/api/presentations/${encodeURIComponent(id)}`, 'DELETE'),
  saveProgress: (id: string, step: number) =>
    write(`/api/progress/${encodeURIComponent(id)}`, 'PUT', { step }),
  getProgress: (id: string) =>
    read<{ step?: number }>(`/api/progress/${encodeURIComponent(id)}`),
}

/**
 * Report whether the database is reachable.
 *
 * This used to mirror every row into `localStorage` and reconcile the two on
 * boot. That reconciliation was the sync problem: a stale tab wrote back decks
 * that had since been deleted, two devices disagreed about which version was
 * current, and a full copy of every lesson sat on a student's machine.
 */
export async function syncOnBoot(): Promise<void> {
  const [questions, decks] = await Promise.all([api.questions(), api.presentations()])
  set(questions && decks ? 'online' : 'offline')
}

/** Always zero: nothing is buffered now. */
export function pendingCount(): number {
  return 0
}

/** No queue to drain. Kept so callers need not change. */
export async function flushPending(): Promise<void> {
  /* nothing is buffered */
}

export const SYNC_BASE = BASE