import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname)

/**
 * Reads `.env.production` once and exposes its values through Vite's
 * `define` for **build** runs, plus a tiny dev-server middleware that
 * injects the same keys into `import.meta.env.VITE_*` for `npm run dev`.
 *
 * Why: Vite by default only loads .env / .env.local / .env.development in
 * dev mode. Without this plugin, a fresh `npm install && npm run dev`
 * would print the "Supabase не настроен" warning and show the
 * SupabaseConfigMissing UI even though `.env.production` is committed.
 *
 * Local overrides: a developer can drop a `.env.local` (gitignored) and
 * any value defined there will win because Vite loads it after this
 * plugin runs.
 */
const envFromProduction = loadEnv('production', projectRoot, 'VITE_')

/** Convert {VITE_X: "value"} → {`import.meta.env.VITE_X`: JSON.stringify(value)}. */
function toDefine(env) {
  const out = {}
  for (const [k, v] of Object.entries(env)) {
    out[`import.meta.env.${k}`] = JSON.stringify(v)
  }
  return out
}

/** Vite plugin that injects .env.production values into the dev server's
 *  module graph by rewriting `import.meta.env.VITE_*` references. */
const productionEnvDevPlugin = {
  name: 'card-wars-production-env-in-dev',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes('src/')) return null
    if (!code.includes('import.meta.env')) return null
    let out = code
    let touched = false
    for (const [k, v] of Object.entries(envFromProduction)) {
      const token = `import.meta.env.${k}`
      if (out.includes(token)) {
        out = out.split(token).join(JSON.stringify(v))
        touched = true
      }
    }
    return touched ? { code: out, map: null } : null
  },
}

export default defineConfig(() => ({
  plugins: [react(), productionEnvDevPlugin],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // For `npm run build`: bake the same values into the bundle via define.
  define: toDefine(envFromProduction),
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/three')
            || id.includes('node_modules/@react-three/fiber')
            || id.includes('node_modules/@react-three/drei')
          ) {
            return 'three-vendor'
          }
        },
      },
    },
  },
}))