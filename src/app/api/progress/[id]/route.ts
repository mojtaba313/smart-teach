import { NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { progressToRow } from '../../../../server/mapping'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await prisma.progress.findUnique({ where: { presentationId: id } })
  return NextResponse.json(row ? { step: row.step } : {})
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const step = Number((await request.json().catch(() => null))?.step)
  if (!Number.isFinite(step)) return NextResponse.json({ error: 'شمارهٔ گام نامعتبر است' }, { status: 400 })
  const row = progressToRow(id, step)
  await prisma.progress.upsert({ where: { presentationId: id }, create: row, update: { step } })
  return NextResponse.json({ step })
}
