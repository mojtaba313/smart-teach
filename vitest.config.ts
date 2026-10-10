import { defineConfig } from 'vitest/config'

/**
 * The animation core (expr, engine, migration) is deliberately free of React
 * and DOM, so it can be tested in a plain node environment. Anything that
 * needs a DOM opts in per-file with `@vitest-environment jsdom`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: ['dot'],
  },
})
