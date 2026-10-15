import { NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { createSession, pruneSessions, verifyPassword } from '../../../../server/auth'

export const dynamic = 'force-dynamic'

/**
 * Sign in.
 *
 * There is no register route: accounts are created by an admin or a teacher,
 * so there is no signup path to attack and no way for an outsider to obtain a
 * role by POSTing to the right URL.
 *
 * A wrong username and a wrong password return the same message on purpose.
 * Distinguishing them turns the form into a username oracle.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { username?: string; password?: string } | null
  const username = body?.username?.trim().toLowerCase() ?? ''
  const password = body?.password ?? ''
  if (!username || !password) {
    return NextResponse.json({ error: 'نام کاربری و گذرواژه را وارد کنید.' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { username } })
  // Hash even when the user does not exist, so a missing account and a wrong
  // password take the same time and cannot be told apart by timing.
  const ok = user
    ? verifyPassword(password, user.passwordHash)
    : verifyPassword(password, '$2a$12$abcdefghijklmnopqrstuvCPMZRfNEB1eZ9NnUJlV9vJcVnKqYP1yC')
  if (!user || !ok) {
    return NextResponse.json({ error: 'نام کاربری یا گذرواژه درست نیست.' }, { status: 401 })
  }
  if (user.disabled) {
    return NextResponse.json({ error: 'این حساب غیرفعال شده است.' }, { status: 403 })
  }

  await createSession(user.id)
  void pruneSessions()
  return NextResponse.json({
    user: { id: user.id, username: user.username, role: user.role, displayName: user.displayName || user.username },
  })
}
