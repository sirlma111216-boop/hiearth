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
        bindings: { APP_ENV: 'test' },
      },
    }),
  ],
  test: {
    include: ['tests/workers/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
