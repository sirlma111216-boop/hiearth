import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { TEACHER_SECRET: 'test-teacher-secret-0123456789', APP_ENV: 'test' },
      },
    }),
  ],
  test: {
    include: ['tests/workers/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
