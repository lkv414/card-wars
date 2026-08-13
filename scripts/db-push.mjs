#!/usr/bin/env node
/**
 * Apply pending Supabase migrations using token from .env.secure
 * Usage: node scripts/db-push.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const securePath = resolve(root, '.env.secure')

if (!existsSync(securePath)) {
  console.error('Missing .env.secure')
  process.exit(1)
}

const env = { ...process.env }
for (const line of readFileSync(securePath, 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.+)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].trim()
}

if (!env.SUPABASE_ACCESS_TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN not found in .env.secure')
  process.exit(1)
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: true, env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('npx', ['supabase', 'link', '--project-ref', '<supabase-project>'])
run('npx', ['supabase', 'db', 'push', '--yes'])
console.log('Migrations applied.')
