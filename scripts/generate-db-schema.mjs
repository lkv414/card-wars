#!/usr/bin/env node
/**
 * Dump remote Postgres schema via Supabase CLI.
 * Usage: SUPABASE_PROJECT_REF=xxx npm run db:schema
 * Output: supabase/CURRENT_DB_SCHEMA.sql
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRef = process.env.SUPABASE_PROJECT_REF
if (!projectRef) {
  console.error('Set SUPABASE_PROJECT_REF to your Supabase project ref.')
  process.exit(1)
}

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'CURRENT_DB_SCHEMA.sql')

const result = spawnSync(
  'npx',
  ['supabase', 'db', 'dump', '--project-ref', projectRef, '--schema', 'public'],
  { encoding: 'utf8', shell: process.platform === 'win32' },
)

if (result.status !== 0) {
  console.error(result.stderr || result.stdout)
  process.exit(result.status ?? 1)
}

writeFileSync(outPath, result.stdout, 'utf8')
console.log(`Wrote ${outPath}`)
