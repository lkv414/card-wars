#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sql = readFileSync(
  resolve(root, 'supabase/migrations/20260813110000_ably_outbox_rpc_patches.sql'),
  'utf8'
)
const chunks = sql.split(/(?=CREATE OR REPLACE FUNCTION)/).filter(Boolean)
const dir = resolve(root, 'scripts/.outbox-chunks')
mkdirSync(dir, { recursive: true })
chunks.forEach((chunk, i) => {
  writeFileSync(resolve(dir, `chunk-${String(i + 1).padStart(2, '0')}.sql`), chunk.trim())
})
console.log(`Wrote ${chunks.length} chunks to ${dir}`)
