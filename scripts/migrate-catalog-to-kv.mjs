#!/usr/bin/env node
/**
 * Migrate the read-only game catalog (cards + lands) from Supabase into the
 * Cloudflare KV namespace bound as `CATALOG` on the Worker.
 *
 * KV layout:
 *   key 'cards' → JSON array of card blueprints
 *   key 'lands' → JSON array of landscape blueprints
 *
 * The Worker reads via `env.CATALOG.get(key, 'json')` — no Supabase RPC,
 * no `enrich_card_array` plpgsql on the hot path.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=ey... \
 *   KV_NAMESPACE_ID=abcd1234... \
 *   node scripts/migrate-catalog-to-kv.mjs
 *
 * Re-running is safe: `wrangler kv:bulk put` overwrites existing keys.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPABASE_URL = process.env.SUPABASE_URL?.trim()
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID?.trim()
const WRANGLER = process.env.WRANGLER?.trim() || 'npx wrangler'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role key — full read access).',
  )
  process.exit(1)
}
if (!KV_NAMESPACE_ID) {
  console.error(
    'Set KV_NAMESPACE_ID to the Cloudflare KV namespace id from wrangler.jsonc (catalog binding).',
  )
  process.exit(1)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const tmpDir = path.join(here, '.tmp-catalog')

async function fetchTable(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*`
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch ${table}: HTTP ${res.status} ${await res.text()}`)
  }
  return res.json()
}

function wranglerKvPut(key, json) {
  const filePath = path.join(tmpDir, `${key}.json`)
  writeFileSync(filePath, json, 'utf8')
  const result = spawnSync(
    WRANGLER,
    [
      'kv',
      'bulk',
      'put',
      '--namespace-id',
      KV_NAMESPACE_ID,
      filePath,
      `--binding=CATALOG`,
    ],
    {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (result.status !== 0) {
    console.error(`✗ wrangler kv:bulk put failed for "${key}"`)
    console.error(result.stderr || result.stdout)
    process.exit(result.status ?? 1)
  }
}

async function main() {
  mkdirSync(tmpDir, { recursive: true })
  try {
    console.log('→ Fetching cards from Supabase…')
    const cards = await fetchTable('cards')
    console.log(`  fetched ${cards.length} cards`)

    console.log('→ Fetching lands from Supabase…')
    const lands = await fetchTable('lands')
    console.log(`  fetched ${lands.length} lands`)

    console.log('→ Writing to KV namespace…')
    wranglerKvPut('cards', JSON.stringify(cards))
    console.log('  ✓ cards')

    wranglerKvPut('lands', JSON.stringify(lands))
    console.log('  ✓ lands')

    console.log('\nDone. Worker can now serve catalog via env.CATALOG.get("cards").')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})