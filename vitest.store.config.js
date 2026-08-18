import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react({ jsxRuntime: 'automatic' })],
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/store/**/*.test.{js,jsx}', 'src/utils/wsQueue.test.js', 'src/utils/stabilizeGameState.test.js'],
    css: true,
  },
})
