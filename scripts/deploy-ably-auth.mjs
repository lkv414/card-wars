#!/usr/bin/env node
/**
 * Деплой Edge Function ably-auth и секрета ABLY_API_KEY из .env.secure
 *
 * Usage: node scripts/deploy-ably-auth.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const securePath = resolve(root, '.env.secure')

if (!existsSync(securePath)) {
  console.error('Missing .env.secure — add ABLY_API_KEY=your_key')
  process.exit(1)
}

const lines = readFileSync(securePath, 'utf8').split('\n')
let ablyKey = ''
let accessToken = ''
for (const line of lines) {
  const trimmed = line.trim()
  const ably = /^ABLY_API_KEY=(.+)$/.exec(trimmed)
  const token = /^SUPABASE_ACCESS_TOKEN=(.+)$/.exec(trimmed)
  if (ably) ablyKey = ably[1].trim()
  if (token) accessToken = token[1].trim()
}

if (!ablyKey) {
  console.error('ABLY_API_KEY not found in .env.secure')
  process.exit(1)
}

const env = { ...process.env }
if (accessToken) env.SUPABASE_ACCESS_TOKEN = accessToken

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: true, env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

console.log('Linking Supabase project <supabase-project>…')
run('npx', ['supabase', 'link', '--project-ref', '<supabase-project>'])

console.log('Setting ABLY_API_KEY secret…')
run('npx', ['supabase', 'secrets', 'set', `ABLY_API_KEY=${ablyKey}`])

console.log('Deploying ably-auth function…')
run('npx', ['supabase', 'functions', 'deploy', 'ably-auth', '--no-verify-jwt'])

console.log('Done. Ably auth endpoint: {SUPABASE_URL}/functions/v1/ably-auth')
