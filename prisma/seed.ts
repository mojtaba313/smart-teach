import { prisma } from '../src/server/db'
import { hashPassword } from '../src/server/password'
import { Role } from '@prisma/client'
import { randomBytes } from 'node:crypto'

/**
 * First run: create the admin, and optionally a teacher who will own
 * everything that already exists in the database.
 *
 * The backfill matters. Decks and questions were created before there were
 * accounts, so they have no owner. Leaving them orphaned would mean the
 * teacher who has been building this library suddenly cannot see any of it —
 * so `OWNER_USERNAME` claims them.
 *
 * Run once:
 *   ADMIN_USERNAME=... ADMIN_PASSWORD=... OWNER_USERNAME=... npx tsx prisma/seed.ts
 *
 * Every credential may come from the environment instead of being typed here,
 * so nothing secret ends up in git.
 */

function req(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} is required`)
  return v
}

function weak(pw: string): boolean {
  return pw.length < 10
}

async function upsertUser(
  username: string,
  password: string,
  role: Role,
  displayName: string,
) {
  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) {
    // Deliberately does not reset the password: re-running the seed must not
    // silently lock anyone out of an account they have since changed.
    console.log(`user exists: ${username} (${existing.role})`)
    return existing
  }
  if (weak(password)) throw new Error('password must be at least 10 characters')
  return prisma.user.create({
    data: { id: randomBytes(8).toString('hex'), username, passwordHash: hashPassword(password), role, displayName },
  })
}

async function main() {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })

  const admin = await upsertUser(
    req('ADMIN_USERNAME'),
    req('ADMIN_PASSWORD'),
    Role.ADMIN,
    process.env.ADMIN_NAME?.trim() || 'مدیر',
  )
  console.log(`admin ready: ${admin.username}`)

  const ownerName = process.env.OWNER_USERNAME?.trim()
  if (ownerName) {
    const owner = await upsertUser(
      ownerName,
      process.env.OWNER_PASSWORD?.trim() || randomBytes(12).toString('base64url'),
      Role.TEACHER,
      process.env.OWNER_NAME?.trim() || ownerName,
    )
    // Only claim rows that nobody owns yet, so re-running never steals content
    // from a teacher who has since taken ownership of something.
    const { count: decks } = await prisma.presentation.updateMany({
      where: { ownerId: null },
      data: { ownerId: owner.id },
    })
    const { count: questions } = await prisma.question.updateMany({
      where: { ownerId: null },
      data: { ownerId: owner.id },
    })
    console.log(`owner: ${owner.username} — claimed ${decks} deck(s), ${questions} question(s)`)
    if (!process.env.OWNER_PASSWORD) {
      console.log('  (generated a password; set OWNER_PASSWORD to choose your own)')
    }
  } else {
    console.log('no OWNER_USERNAME: existing content stays unowned (admin-visible only)')
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())