/* ------------------------------------------------------------------ *
 *  Domain normalisation — no framework, no browser, no database.
 *
 *  Both sides of the wire use this: the browser when it reads its cache,
 *  the Route Handlers when they validate whatever a client posts. That is
 *  the whole point of splitting it out of `storage.ts` — a `'use client'`
 *  module cannot be called from a server, and this logic has to run in both.
 * ------------------------------------------------------------------ */

import type {
  AnimLayer,
  AnimSeries,
  Animation,
  AnswerKey,
  BankQuestion,
  BlockSpan,
  Difficulty,
  Presentation,
  Slide,
  SlideStep,
  StepKind,
} from '../types'
import { KIND_LABEL, SCHEMA_VERSION, defaultSpanFor, emptyAnimation, splitTags, uid } from '../types'


/* ------------------------------------------------------------------ *
 *  Predicates (shared with the cache layer in `storage.ts`)
 * ------------------------------------------------------------------ */

export function isStr(v: unknown): v is string {
  return typeof v === 'string'
}

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isDifficulty(v: unknown): v is Difficulty {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5
}

export function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

const SPANS: BlockSpan[] = ['full', 'half', 'third']

export function migrateAnswerKey(raw: unknown): AnswerKey | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const steps = arr<unknown>(r.steps)
    .map(migrateStep)
    .filter((s): s is SlideStep => s !== null)
  if (steps.length === 0) return undefined
  return { title: isStr(r.title) ? r.title : undefined, steps }
}

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
    case 'quiz': {
      // Block lists go through the same migration as deck blocks, so a figure
      // built from an animation survives a round-trip.
      const blocks = (v: unknown) => (arr<unknown>(v).map(migrateStep).filter(Boolean) as SlideStep[])
      return {
        id,
        span,
        kind,
        question: isStr(r.question) ? r.question : '',
        options: arr<unknown>(r.options).filter(isStr),
        answerIndex: isNum(r.answerIndex) ? r.answerIndex : 0,
        explanation: isStr(r.explanation) ? r.explanation : undefined,
        bankId: isStr(r.bankId) ? r.bankId : undefined,
        questionBlocks: blocks(r.questionBlocks),
        optionBlocks: arr<unknown>(r.optionBlocks).map(blocks),
      }
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

export /** Any list of blocks, normalised the same way deck steps are. */
function blockList(raw: unknown): SlideStep[] | undefined {
  const list = arr<unknown>(raw).map(migrateStep).filter((s): s is SlideStep => s !== null)
  return list.length ? list : undefined
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
    difficulty: isDifficulty(r.difficulty) ? r.difficulty : 3,
    answerKey: migrateAnswerKey(r.answerKey),
    questionBlocks: blockList(r.questionBlocks),
    optionBlocks: arr<unknown>(r.optionBlocks).map((o) => blockList(o) ?? []),
    starred: r.starred === true,
    createdAt: isNum(r.createdAt) ? r.createdAt : Date.now(),
    updatedAt: isNum(r.updatedAt) ? r.updatedAt : Date.now(),
    used: isNum(r.used) ? r.used : 0,
  }
}
