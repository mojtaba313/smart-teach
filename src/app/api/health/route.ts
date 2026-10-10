import { NextResponse } from 'next/server'
import { prisma } from '../../../server/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [questions, presentations] = await Promise.all([prisma.question.count(), prisma.presentation.count()])
  return NextResponse.json({ ok: true, questions, presentations })
}
