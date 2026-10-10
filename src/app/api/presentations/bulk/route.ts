import { NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { presentationToRow } from '../../../../server/mapping'
import { migratePresentation } from '../../../../model/migrate'
import { syncQuizLinks } from '../../../../server/links'

export const dynamic = 'force-dynamic'

/** First-run migration: whatever the browser already had goes up. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const list = Array.isArray(body) ? body : body?.presentations ?? []
  let saved = 0
  for (const raw of list) {
    const p = migratePresentation(raw)
    if (!p) continue
    const row = presentationToRow(p)
    await prisma.presentation.upsert({ where: { id: row.id }, create: row, update: row })
    await syncQuizLinks(row.id, p)
    saved += 1
  }
  return NextResponse.json({ saved })
}
