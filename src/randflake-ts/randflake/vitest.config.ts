import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      sparx64: new URL('../sparx64/src/index.ts', import.meta.url).pathname
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
