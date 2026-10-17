/**
 * Vitest config for the Workers game-engine — separate from the frontend
 * vitest config so we can target engine-specific paths without dragging
 * in the React/Supabase setup file.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/game-engine/**/*.test.ts', 'src/state-broadcast.smoke.test.ts', 'src/bot.test.ts'],
  },
})