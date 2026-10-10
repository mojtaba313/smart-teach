import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'

/**
 * Standalone scripts (`tsx prisma/seed.ts`) do not go through Next, so they do
 * not get `.env` loaded for them. Reading it here means one rule — "the
 * connection string lives in .env" — holds for the app and the tools alike.
 */
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no .env — rely on the environment */
  }
}

/**
 * The client is built on first use, not at import time.
 *
 * `next build` imports every Route Handler in order to trace it. If the
 * connection string were required at module scope, a build on a machine
 * without a database would fail — and a build must not need a live database.
 * The throw now happens when someone actually queries, which is the only
 * moment it can be acted on.
 */
let client: PrismaClient | null = null

function make(): PrismaClient {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL تنظیم نشده است. در محیط استقرار این متغیر را با رشتهٔ اتصال PostgreSQL تنظیم کنید.',
    )
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    client ??= make()
    const value = Reflect.get(client as object, prop)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

/** Warm the connection early so the first request is not the one that fails. */
export function assertDatabase(): void {
  client ??= make()
}
