import { Prisma } from '@prisma/client'
import type { BankQuestion, Difficulty, Presentation } from '../types'
import { migrateAnswerKey, migratePresentation } from '../model/migrate'

/**
 * Row ⇄ domain mapping.
 *
 * The browser and the server must agree on this exactly, so it lives in one
 * place that both sides import — a Route Handler validates whatever a client
 * posts through the same migration the client would have used.
 *
 * PostgreSQL gives us native `text[]` for the list fields and `jsonb` for the
 * documents, so almost nothing is stringly-typed any more.
 */

type QuestionRow = {
  id: string
  stem: string
  options: string[]
  answerIndex: number
  explanation: string
  tags: string[]
  source: string
  year: number | null
  difficulty: number
  starred: boolean
  used: number
  answerKey: unknown
  figure: unknown
  createdAt: Date
  updatedAt: Date
}

export type QuestionRowShape = QuestionRow

export function questionToDomain(row: QuestionRow): BankQuestion {
  const fig = (row.figure ?? null) as { questionBlocks?: BankQuestion['questionBlocks']; optionBlocks?: BankQuestion['optionBlocks'] } | null
  return {
    id: row.id,
    stem: row.stem,
    options: row.options ?? [],
    answerIndex: row.answerIndex,
    explanation: row.explanation || undefined,
    tags: row.tags ?? [],
    source: row.source || undefined,
    year: row.year ?? undefined,
    difficulty: clampDifficulty(row.difficulty),
    starred: row.starred,
    used: row.used,
    answerKey: row.answerKey ? migrateAnswerKey(row.answerKey) : undefined,
    questionBlocks: fig?.questionBlocks,
    optionBlocks: fig?.optionBlocks,
    createdAt: ms(row.createdAt, row.updatedAt),
    updatedAt: ms(row.updatedAt, row.createdAt),
  }
}

export function questionToRow(q: BankQuestion) {
  return {
    id: q.id,
    stem: q.stem,
    options: q.options ?? [],
    answerIndex: q.answerIndex ?? 0,
    explanation: q.explanation ?? '',
    tags: q.tags ?? [],
    source: q.source ?? '',
    year: q.year ?? null,
    difficulty: clampDifficulty(q.difficulty),
    starred: q.starred === true,
    used: q.used ?? 0,
    answerKey: (q.answerKey ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
    figure:
      q.questionBlocks?.length || q.optionBlocks?.some((o) => o?.length)
        ? ({ questionBlocks: q.questionBlocks, optionBlocks: q.optionBlocks } as Prisma.InputJsonValue)
        : Prisma.JsonNull,
  }
}

/* ------------------------------------------------------------------ *
 *  Presentations
 * ------------------------------------------------------------------ */

type PresentationRow = {
  id: string
  title: string
  description: string
  theme: string
  layout: string
  schema: number
  data: unknown
  createdAt: Date
  updatedAt: Date
}

export function presentationToDomain(row: PresentationRow): Presentation {
  const parsed = migratePresentation(row.data)
  if (parsed) return parsed
  // A row whose document no longer parses must not take the app down; rebuild
  // the minimum the UI needs from the indexed columns.
  return {
    schema: row.schema,
    id: row.id,
    title: row.title,
    description: row.description,
    theme: row.theme as Presentation['theme'],
    layout: row.layout as Presentation['layout'],
    slides: [],
    createdAt: ms(row.createdAt, row.updatedAt),
    updatedAt: ms(row.updatedAt, row.createdAt),
  }
}

export function presentationToRow(p: Presentation) {
  return {
    id: p.id,
    title: p.title,
    description: p.description ?? '',
    theme: p.theme ?? 'light',
    layout: p.layout ?? 'flow',
    schema: p.schema ?? 2,
    data: p as unknown as Prisma.InputJsonValue,
  }
}

/* ------------------------------------------------------------------ *
 *  Progress
 * ------------------------------------------------------------------ */

export function progressToRow(id: string, step: number) {
  return { presentationId: id, step }
}

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

function clampDifficulty(v: unknown): Difficulty {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5 ? v : 3
}

/**
 * The domain stores epoch milliseconds; Postgres gives back a `Date`. When a
 * row predates the columns (or a fallback was built by hand), fall back to
 * whichever timestamp exists so an id still sorts sensibly.
 */
function ms(date: Date | null | undefined, fallback: Date | null | undefined): number {
  const d = date ?? fallback
  return d instanceof Date ? d.getTime() : Date.now()
}