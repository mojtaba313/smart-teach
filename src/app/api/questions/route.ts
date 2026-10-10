import { NextResponse } from 'next/server'
import { prisma } from '../../../server/db'
import { questionToDomain, questionToRow } from '../../../server/mapping'
import { migrateQuestion } from '../../../model/migrate'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await prisma.question.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json(rows.map(questionToDomain))
}

/** Upsert a batch. Unknown ids are inserted, known ids updated in place. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!Array.isArray(body)) return NextResponse.json({ error: 'انتظار آرایه‌ای از سؤال‌ها را داشتیم' }, { status: 400 })
  const accepted = body.map(migrateQuestion).filter((q): q is NonNullable<typeof q> => !!q)
  if (accepted.length === 0) return NextResponse.json({ error: 'هیچ سؤال معتبری پیدا نشد' }, { status: 400 })
  for (const q of accepted) {
    const row = questionToRow(q)
    await prisma.question.upsert({ where: { id: row.id }, create: row, update: row })
  }
  const rows = await prisma.question.findMany({ where: { id: { in: accepted.map((q) => q.id) } } })
  return NextResponse.json(rows.map(questionToDomain))
}


