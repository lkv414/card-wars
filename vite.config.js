import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

/* global process */

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname)

/**
 * Source of truth for VITE_* values per command:
 *   - `npm run build` (NODE_ENV=production) → bake `.env.production` into
 *     the bundle via `define`. `import.meta.env.VITE_X` references in
 *     source become string literals.
 *   - `npm run dev` → Vite auto-loads .env.development, .env, .env.local
 *     (in that order) and exposes them at runtime via
 *     `import.meta.env.VITE_*`. No transform needed — fresh checkouts
 *     without any local env still get the committed `.env.production`
 *     values via the plugin's dev transform below.
 *
 *   Local override: drop a .env.local (gitignored) with VITE_* keys and
 *   Vite will see them at runtime in the dev server, win for that run.
 *   `productionEnvDevPlugin.transform` then re-checks: if a VITE_ value
 *   is present in `.env.local`, it skips rewriting so the developer's
 *   override sticks. Otherwise it falls back to `.env.production`.
 */

const loadVite = (mode) => loadEnv(mode, projectRoot, 'VITE_')
const fromProduction = loadVite('production')

/**
 * Read .env.local directly (Vite won't expose it via loadEnv cleanly).
 */
function parseLocalEnv() {
  try {
    const file = resolve(projectRoot, '.env.local')
    if (!existsSync(file)) return {}
    const raw = readFileSync(file, 'utf-8')
    const out = {}
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/i)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (!m[1].startsWith('VITE_')) continue
      out[m[1]] = v
    }
    return out
  } catch {
    return {}
  }
}

const fromLocal = parseLocalEnv()
const isDevBuild = process.env.NODE_ENV !== 'production'
// Effective dev values: .env.local wins, then .env.production fallback.
const envFromProduction = isDevBuild ? { ...fromProduction, ...fromLocal } : fromProduction

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