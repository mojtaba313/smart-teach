import type {
  AnimLayer,
  AnimSeries,
  Animation,
  BankQuestion,
  BlockSpan,
  Presentation,
  QuestionBank,
  Slide,
  SlideStep,
  StepKind,
} from './types'
import {
  KIND_LABEL,
  SCHEMA_VERSION,
  blankPresentation,
  defaultSpanFor,
  emptyAnimation,
  splitTags,
  uid,
} from './types'

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

function isStr(v: unknown): v is string {
  return typeof v === 'string'
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

const SPANS: BlockSpan[] = ['full', 'half', 'third']

/* ------------------------------------------------------------------ *
 *  Migration — v1 (no schema, id-less steps) → v2
 * ------------------------------------------------------------------ */

function migrateStep(raw: unknown): SlideStep | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const declared = isStr(r.kind) ? r.kind : ''
  // An unknown kind is kept as prose rather than dropped — losing a teacher's
  // content silently is far worse than losing its presentation.
  const kind: StepKind = declared in KIND_LABEL ? (declared as StepKind) : 'text'
  const span: BlockSpan = SPANS.includes(r.span as BlockSpan) ? (r.span as BlockSpan) : defaultSpanFor(kind)
  const id = isStr(r.id) && r.id ? r.id : uid('step')
  const value = isStr(r.value) ? r.value : declared ? `[${declared}] ${isStr(r.value) ? r.value : JSON.stringify(r)}` : ''

  switch (kind) {
    case 'list':
      return { id, span, kind, items: arr<unknown>(r.items).filter(isStr), ordered: r.ordered === true }
    case 'quiz':
      return {
        id,
        span,
        kind,
        question: isStr(r.question) ? r.question : '',
        options: arr<unknown>(r.options).filter(isStr),
        answerIndex: isNum(r.answerIndex) ? r.answerIndex : 0,
        explanation: isStr(r.explanation) ? r.explanation : undefined,
        bankId: isStr(r.bankId) ? r.bankId : undefined,
      }
    case 'callout':
      return {
        id,
        span,
        kind,
        value,
        tone: (r.tone as 'info') && ['info', 'tip', 'warn', 'idea'].includes(r.tone as string)
          ? (r.tone as 'info' | 'tip' | 'warn' | 'idea')
          : 'info',
      }
    case 'animation': {
      // Animation payloads are owned by the studio; anything unrecognised
      // falls back to a blank scene rather than crashing the deck.
      const base = emptyAnimation()
      const a = r.anim && typeof r.anim === 'object' ? (r.anim as Record<string, unknown>) : {}
      const anim: Animation = {
        ...base,
        ...(a as Partial<Animation>),
        scene: { ...base.scene, ...((a.scene as object) ?? {}) },
        layers: Array.isArray(a.layers) ? (a.layers as AnimLayer[]) : base.layers,
        series: Array.isArray(a.series) ? (a.series as AnimSeries[]) : base.series,
      }
      return { id, span, kind, anim }
    }
    case 'image':
      return { id, span, kind, value, alt: isStr(r.alt) ? r.alt : undefined, caption: isStr(r.caption) ? r.caption : undefined }
    case 'video':
    case 'code':
      return { id, span, kind, value, caption: isStr(r.caption) ? r.caption : undefined }
    default:
      return { id, span, kind, value } as SlideStep
  }
}

function migrateSlide(raw: unknown, i: number): Slide | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const steps = arr<unknown>(r.steps)
    .map(migrateStep)
    .filter((s): s is SlideStep => s !== null)
  return {
    id: isStr(r.id) && r.id ? r.id : `slide-${i}`,
    title: isStr(r.title) ? r.title : `بخش ${i + 1}`,
    steps,
    notes: isStr(r.notes) ? r.notes : '',
  }
}

export function migratePresentation(raw: unknown): Presentation | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const slides = arr<unknown>(r.slides).map(migrateSlide).filter((s): s is Slide => s !== null)
  if (slides.length === 0) return null
  return {
    schema: SCHEMA_VERSION,
    id: isStr(r.id) && r.id ? r.id : uid('pres'),
    title: isStr(r.title) && r.title ? r.title : 'بدون عنوان',
    description: isStr(r.description) ? r.description : '',
    theme: r.theme === 'dark' || r.theme === 'paper' ? r.theme : 'light',
    layout: r.layout === 'stack' ? 'stack' : 'flow',
    slides,
    createdAt: isNum(r.createdAt) ? r.createdAt : Date.now(),
    updatedAt: isNum(r.updatedAt) ? r.updatedAt : Date.now(),
  }
}

export function migrateQuestion(raw: unknown): BankQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isStr(r.stem) || !r.stem.trim()) return null
  const options = arr<unknown>(r.options).filter(isStr)
  const rawTags = Array.isArray(r.tags)
    ? r.tags.filter(isStr)
    : isStr(r.tags)
      ? splitTags(r.tags)
      : []
  const answerIndex = isNum(r.answerIndex) ? Math.max(0, Math.min(r.answerIndex, Math.max(0, options.length - 1))) : 0
  return {
    id: isStr(r.id) && r.id ? r.id : uid('q'),
    stem: r.stem,
    options,
    answerIndex,
    explanation: isStr(r.explanation) ? r.explanation : '',
    tags: rawTags.map((t) => t.trim()).filter(Boolean),
    source: isStr(r.source) ? r.source : '',
    year: isNum(r.year) ? r.year : undefined,
    difficulty: r.difficulty === 1 || r.difficulty === 2 || r.difficulty === 3 ? r.difficulty : 2,
    starred: r.starred === true,
    createdAt: isNum(r.createdAt) ? r.createdAt : Date.now(),
    updatedAt: isNum(r.updatedAt) ? r.updatedAt : Date.now(),
    used: isNum(r.used) ? r.used : 0,
  }
}

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
  return persist(next)
}

export function deletePresentation(id: string): Presentation[] {
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
  const idx = bank.questions.findIndex((x) => x.id === q.id)
  const questions = idx >= 0 ? bank.questions.map((x) => (x.id === q.id ? stamp : x)) : [...bank.questions, stamp]
  return saveBank({ ...bank, questions })
}

export function deleteQuestion(id: string): QuestionBank {
  const bank = loadBank()
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
