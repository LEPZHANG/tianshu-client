import { defineConfig } from 'vitest/config'

// This project sits inside the Harness checkout it builds against, so vitest's
// upward config search would otherwise find that repository's root config and
// run its suites instead of this one. Pin the root and the test glob here.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['test/**/*.test.ts'],
  },
})
