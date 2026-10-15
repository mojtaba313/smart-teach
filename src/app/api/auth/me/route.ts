import { NextResponse } from 'next/server'
import { currentUser } from '../../../../server/auth'

export const dynamic = 'force-dynamic'

/** Who am I. Returns `{ user: null }` rather than 401 so the client can branch. */
export async function GET() {
  return NextResponse.json({ user: await currentUser() })
}
