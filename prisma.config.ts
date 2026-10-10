import { defineConfig } from 'prisma/config'
import { readFileSync } from 'node:fs'

/**
 * Prisma 7 reads neither the schema's `url` nor `.env` on its own, so this
 * file owns both: load the env, then point the CLI at PostgreSQL.
 */
function loadEnv() {
  if (process.env.DATABASE_URL) return
  for (const file of ['.env', '.env.local']) {
    try {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
        if (!m) continue
        process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
      }
    } catch {
      /* no such file */
    }
  }
}
loadEnv()

const FALLBACK = 'postgresql://smart:smart@localhost:5432/smart_teach?schema=public'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? FALLBACK },
})
