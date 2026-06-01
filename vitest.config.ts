import { defineConfig } from 'vitest/config'

// Unit tests cover the pure lib logic only (no Next runtime, no Supabase,
// no network). Anything importing `server-only` is intentionally excluded.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
})
