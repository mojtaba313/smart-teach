import { NextResponse } from 'next/server'
import { prisma } from '../../../server/db'
import { presentationToDomain } from '../../../server/mapping'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await prisma.presentation.findMany({ orderBy: { updatedAt: 'desc' } })
  return NextResponse.json(rows.map(presentationToDomain))
}
