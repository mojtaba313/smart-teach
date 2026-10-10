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
 * One client for the process.
 *
 * Prisma 7 takes a driver adapter rather than a URL, so the connection string
 * is read here and handed to the pg adapter — the same DATABASE_URL the CLI
 * migrates with, so there is exactly one place that knows the database.
 */
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL تنظیم نشده — .env را بسازید یا متغیر محیطی بدهید.')

const adapter = new PrismaPg({ connectionString: url })

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
