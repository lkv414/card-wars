/**
 * Catalog access layer — single point of contact with the Cloudflare KV
 * namespace bound as `CATALOG` on the Worker.
 *
 * Both keys (`cards`, `lands`) are populated by `npm run catalog:migrate`,
 * which copies the read-only Supabase tables into KV once. After that, the
 * hot path never touches Supabase for catalog data — `enrich_card_array` and
 * similar plpgsql helpers can be retired in a follow-up.
 *
 * The Worker edge cache is short (KV writes propagate globally within ~60s),
 * and we keep a per-isolate in-memory cache on top to avoid re-parsing JSON
 * for every request.
 */
import type { Env } from './env'

export type Card = Record<string, unknown>
export type Land = Record<string, unknown>

export type CatalogKey = 'cards' | 'lands'

const VALID_KEYS: readonly CatalogKey[] = ['cards', 'lands'] as const

export function isCatalogKey(value: string): value is CatalogKey {
  return (VALID_KEYS as readonly string[]).includes(value)
}

interface CacheEntry {
  readonly data: ReadonlyArray<Record<string, unknown>>
  readonly fetchedAt: number
}

// Per-isolate cache — KV reads are fast but still ~5-15ms; we only want
// to hit KV once per isolate per TTL window.
const CACHE_TTL_MS = 60_000
const cache = new Map<CatalogKey, CacheEntry>()

async function readCatalog(
  env: Env,
  key: CatalogKey,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.data
  }

  const value = await env.CATALOG.get(key, { type: 'json', cacheTtl: 300 })
  if (value === null) {
    // KV miss — likely the operator hasn't run `npm run catalog:migrate` yet.
    // Fall back to an empty list so the route still answers (and so the
    // client can surface a meaningful "catalog empty" error instead of a 500).
    cache.set(key, { data: [], fetchedAt: now })
    return []
  }

  const arr = Array.isArray(value) ? value : []
  cache.set(key, { data: arr, fetchedAt: now })
  return arr
}

/** Read the full cards catalog. */
export async function getCards(env: Env): Promise<ReadonlyArray<Card>> {
  return readCatalog(env, 'cards')
}

/** Read the full lands catalog. */
export async function getLands(env: Env): Promise<ReadonlyArray<Land>> {
  return readCatalog(env, 'lands')
}

/**
 * Build a `{id → row}` index for a catalog. Worker code uses this when it
 * needs to enrich a card referenced inside a saved game state without
 * going back to Supabase.
 */
export async function getCardIndex(env: Env): Promise<Map<string, Card>> {
  const cards = await getCards(env)
  const idx = new Map<string, Card>()
  for (const card of cards) {
    const id = (card as { id?: unknown }).id
    if (typeof id === 'string') idx.set(id, card)
  }
  return idx
}