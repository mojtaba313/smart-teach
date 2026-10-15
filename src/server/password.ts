import bcrypt from 'bcryptjs'

/**
 * Password hashing, kept apart from `auth.ts` so the seed script can use it.
 *
 * `auth.ts` imports `server-only`, which throws when loaded outside a React
 * Server Component context — correct for the app, but it makes the module
 * unusable from a plain Node script. Hashing needs no request context, so it
 * lives here and both sides import it.
 */

/** 12 rounds is the current sensible floor for bcrypt. */
const ROUNDS = 12

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, ROUNDS)
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash)
  } catch {
    // A malformed hash should read as "wrong password", not crash the login.
    return false
  }
}
