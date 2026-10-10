import { NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { questionToDomain, questionToRow } from '../../../../server/mapping'
import { migrateQuestion } from '../../../../model/migrate'

export const dynamic = 'force-dynamic'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  const q = migrateQuestion({ ...(body ?? {}), id })
  if (!q) return NextResponse.json({ error: 'سؤال معتبر نیست' }, { status: 400 })
  const row = questionToRow(q)
  const saved = await prisma.question.upsert({ where: { id: row.id }, create: row, update: row })
  return NextResponse.json(questionToDomain(saved))
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.question.delete({ where: { id } }).catch(() => undefined)
  await prisma.quizLink.deleteMany({ where: { question: id } }).catch(() => undefined)
  return NextResponse.json({ id })
}
