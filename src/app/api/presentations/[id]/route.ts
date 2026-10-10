import { NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { presentationToDomain, presentationToRow } from '../../../../server/mapping'
import { migratePresentation } from '../../../../model/migrate'
import { syncQuizLinks } from '../../../../server/links'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await prisma.presentation.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: 'ارائه پیدا نشد' }, { status: 404 })
  return NextResponse.json(presentationToDomain(row))
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  const p = migratePresentation({ ...(body ?? {}), id })
  if (!p) return NextResponse.json({ error: 'ارائه معتبر نیست' }, { status: 400 })
  const row = presentationToRow({ ...p, id, updatedAt: Date.now() })
  const saved = await prisma.presentation.upsert({ where: { id: row.id }, create: row, update: row })
  await syncQuizLinks(id, p)
  return NextResponse.json(presentationToDomain(saved))
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Progress and quiz links cascade from the presentation.
  await prisma.presentation.delete({ where: { id } }).catch(() => undefined)
  return NextResponse.json({ id })
}
