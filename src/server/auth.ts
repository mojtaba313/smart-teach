import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { createHash, randomBytes } from 'node:crypto'
import { prisma } from './db'
import type { Role } from '@prisma/client'

/**
 * Sessions.
 *
 * A signed JWT identifies the user; a row in `Session` decides whether that
 * token is still allowed to work. The split matters: a stateless token alone
 * cannot be revoked before it expires, so "disable this account" and "log out
 * everywhere" would be impossible. The row is the authority, the token is just
 * a pointer to it.
 *
 * The cookie value is random and is never stored — only its SHA-256 is, so a
 * database dump does not hand out live sessions.
 */

export { hashPassword, verifyPassword } from './password'

export const SESSION_COOKIE = 'st_session'
const SESSION_DAYS = 30

/**
 * Secret for signing. A missing secret must not fall back to a default: that
 * would mean anyone could mint a valid session.
 */
function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET is not set. Generate one with: openssl rand -base64 32')
  }
  return new TextEncoder().encode(s)
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export type SessionUser = {
  id: string
  username: string
  role: Role
  displayName: string
}

export async function createSession(userId: string): Promise<void> {
  const raw = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000)
  await prisma.session.create({
    data: { id: hashToken(raw), userId, expiresAt: expires },
  })

  const jwt = await new SignJWT({ sid: hashToken(raw) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expires.getTime() / 1000))
    .sign(secret())

  const jar = await cookies()
  jar.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  })
}

/** The signed-in user, or null. Verifies the signature *and* the session row. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null

  let sid: string
  try {
    const { payload } = await jwtVerify(token, secret())
    sid = String(payload.sid ?? '')
  } catch {
    return null
  }
  if (!sid) return null

  const row = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: true },
  })
  if (!row || row.expiresAt < new Date() || row.user.disabled) return null

  return {
    id: row.user.id,
    username: row.user.username,
    role: row.user.role,
    displayName: row.user.displayName || row.user.username,
  }
}

export async function destroySession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret())
      if (payload.sid) await prisma.session.deleteMany({ where: { id: String(payload.sid) } })
    } catch {
      /* already invalid; the cookie still needs clearing */
    }
  }
  jar.delete(SESSION_COOKIE)
}

/** Drop expired rows. Cheap, and called opportunistically rather than on a cron. */
export async function pruneSessions(): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
}

/* ------------------------------------------------------------------ *
 *  Guards
 * ------------------------------------------------------------------ */

export class ForbiddenError extends Error {
  constructor(message = 'دسترسی ندارید.') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/**
 * Require a session, optionally with one of `roles`.
 *
 * Throws rather than returning null: a route that needs a user and quietly
 * proceeds without one is how a permission check gets forgotten. Callers that
 * can cope with anonymous use `currentUser` instead.
 */
export async function requireUser(...roles: Role[]): Promise<SessionUser> {
  const user = await currentUser()
  if (!user) throw new ForbiddenError('باید وارد شوید.')
  if (roles.length > 0 && !roles.includes(user.role)) {
    throw new ForbiddenError('این بخش برای نقش شما در دسترس نیست.')
  }
  return user
}

/** Wrap a Route Handler so a thrown ForbiddenError becomes a clean 403. */
export function guarded<Args extends unknown[]>(
  handler: (user: SessionUser, ...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      const user = await requireUser()
      return await handler(user, ...args)
    } catch (e) {
      if (e instanceof ForbiddenError) {
        return Response.json({ error: e.message }, { status: 403 })
      }
      throw e
    }
  }
}