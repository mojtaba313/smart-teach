import { NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { questionToDomain, questionToRow } from '../../../../server/mapping'
import { migrateQuestion } from '../../../../model/migrate'

export const dynamic = 'force-dynamic'

/**
 * Bulk replace from the JSON page: the teacher saw exactly this list in the
 * preview, so an id that exists updates and an unknown id inserts. Anything
 * that cannot be migrated comes back with the reason and the line number.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const list = Array.isArray(body) ? body : Array.isArray(body?.questions) ? body.questions : null
  if (!list) return NextResponse.json({ error: 'انتظار آرایه‌ای از سؤال‌ها را داشتیم' }, { status: 400 })

  const accepted: NonNullable<ReturnType<typeof migrateQuestion>>[] = []
  const rejected: { index: number; reason: string }[] = []
  list.forEach((raw: unknown, index: number) => {
    const q = migrateQuestion(raw)
    if (!q) {
      rejected.push({ index, reason: 'صورت سؤال خالی است یا ساختار درست نیست' })
      return
    }
    accepted.push(q)
  })

  for (const q of accepted) {
    const row = questionToRow(q)
    await prisma.question.upsert({ where: { id: row.id }, create: row, update: row })
  }
  const rows = await prisma.question.findMany({ where: { id: { in: accepted.map((q) => q.id) } } })
  return NextResponse.json({ saved: rows.map(questionToDomain), rejected })
}
