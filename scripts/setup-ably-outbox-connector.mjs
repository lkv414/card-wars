#!/usr/bin/env node
/**
 * Full Ably outbox connector setup:
 * - sets ably_connector password in Supabase
 * - writes ABLY_CONNECTOR_DATABASE_URL to .env.secure
 * - creates Postgres integration rule + channel namespace rules (if ABLY_ACCOUNT_TOKEN set)
 *
 * Usage:
 *   node scripts/setup-ably-outbox-connector.mjs --apply
 *   node scripts/setup-ably-outbox-connector.mjs            # dry-run / status
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const securePath = resolve(root, '.env.secure')
const apply = process.argv.includes('--apply')
const PROJECT_REF = '<supabase-project>'

function readSecure() {
  if (!existsSync(securePath)) return {}
  const out = {}
  for (const line of readFileSync(securePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

function upsertSecure(vars) {
  let content = existsSync(securePath) ? readFileSync(securePath, 'utf8') : ''
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`^${key}=.*\\n?`, 'm')
    const line = `${key}=${value}\n`
    content = re.test(content) ? content.replace(re, line) : content + line
  }
  writeFileSync(securePath, content)
}

function genPassword() {
  return randomBytes(24).toString('base64url')
}

async function supabaseSql(accessToken, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase SQL ${res.status}: ${text}`)
  return text
}

async function ablyControl(token, appId, method, path, body) {
  const res = await fetch(`https://control.ably.net/v1/apps/${appId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
}

async function ensureNamespace(token, appId, id) {
  const list = await ablyControl(token, appId, 'GET', '/namespaces')
  if (list.ok && list.text.includes(`"id":"${id}"`)) {
    console.log(`Namespace ${id} already exists`)
    return
  }
  const created = await ablyControl(token, appId, 'POST', '/namespaces', {
    id,
    persistLast: true,
    authenticated: true,
    tlsOnly: true,
  })
  if (created.ok) {
    console.log(`Created namespace rule: ${id}`)
  } else {
    console.warn(`Namespace ${id} failed (${created.status}): ${created.text}`)
  }
}

async function ensurePostgresRule(token, appId, dbUrl, primarySite) {
  const list = await ablyControl(token, appId, 'GET', '/rules')
  if (list.ok && /ingress-postgres-outbox/i.test(list.text)) {
    console.log('Postgres outbox integration rule already exists')
    return
  }
  const created = await ablyControl(token, appId, 'POST', '/rules', {
    ruleType: 'ingress-postgres-outbox',
    source: { channelFilter: '.*' },
    target: {
      url: dbUrl,
      outboxTableSchema: 'public',
      outboxTableName: 'ably_outbox',
      nodesTableSchema: 'public',
      nodesTableName: 'ably_nodes',
      sslMode: 'require',
      primarySite,
    },
  })
  if (created.ok) {
    console.log('Created Postgres outbox integration rule')
  } else {
    console.warn(`Integration rule failed (${created.status}): ${created.text}`)
  }
}

const env = readSecure()
const ablyKey = env.ABLY_API_KEY || ''
const appId = env.ABLY_APP_ID || ablyKey.split('.')[0] || ''
const accountToken = env.ABLY_ACCOUNT_TOKEN || ''
const accessToken = env.SUPABASE_ACCESS_TOKEN || ''
let dbUrl = env.ABLY_CONNECTOR_DATABASE_URL || ''

console.log('Ably outbox connector setup')
console.log(`- apply mode: ${apply}`)
console.log(`- ABLY_API_KEY: ${ablyKey ? 'set' : 'missing'}`)
console.log(`- ABLY_APP_ID: ${appId || 'missing'}`)
console.log(`- ABLY_ACCOUNT_TOKEN: ${accountToken ? 'set' : 'missing'}`)
console.log(`- SUPABASE_ACCESS_TOKEN: ${accessToken ? 'set' : 'missing'}`)
console.log(`- ABLY_CONNECTOR_DATABASE_URL: ${dbUrl ? 'set' : 'will generate'}`)

if (!apply) {
  console.log('\nRun with --apply to configure connector password, .env.secure, and Ably rules.')
  process.exit(0)
}

if (!accessToken) {
  console.error('Need SUPABASE_ACCESS_TOKEN in .env.secure')
  process.exit(1)
}

const password = env.ABLY_CONNECTOR_PASSWORD || genPassword()
if (!dbUrl) {
  dbUrl = `postgresql://ably_connector:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`
}

console.log('\nSetting ably_connector password in Supabase…')
await supabaseSql(
  accessToken,
  `ALTER ROLE ably_connector WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}' VALID UNTIL 'infinity';`
)

upsertSecure({
  ABLY_CONNECTOR_PASSWORD: password,
  ABLY_CONNECTOR_DATABASE_URL: dbUrl,
  ABLY_APP_ID: appId,
})

console.log('Updated .env.secure (connector URL + password)')

if (!accountToken) {
  console.warn('\nABLY_ACCOUNT_TOKEN missing — create at https://ably.com/users/access_tokens')
  console.warn('Then re-run: node scripts/setup-ably-outbox-connector.mjs --apply')
  console.warn('\nManual Ably dashboard steps:')
  console.warn('- Integrations → Postgres → ably_outbox / ably_nodes')
  console.warn('- Channel rules: game + lobby namespaces → Persist last message + Identification required')
  process.exit(0)
}

const primarySite = env.ABLY_PRIMARY_SITE || 'eu-central-1-A'
console.log('\nConfiguring Ably Control API…')
await ensurePostgresRule(accountToken, appId, dbUrl, primarySite)
await ensureNamespace(accountToken, appId, 'game')
await ensureNamespace(accountToken, appId, 'lobby')
console.log('\nDone.')
