/**
 * useCatalog — read-only fetch of the game catalog (cards + lands) from the
 * Cloudflare Worker (KV-backed). Replaces the old Supabase-direct path that
 * `useCards` / `useLands` used for read-only consumers.
 *
 * Strategy:
 *   1. Synchronously return the in-memory cache (set by previous mounts).
 *   2. If empty, read from IndexedDB — usually an instant hit on warm loads.
 *   3. If still empty, fetch from the Worker `/catalog/{cards|lands}`.
 *   4. If the Worker is unreachable or returns 5xx, fall back to Supabase
 *      REST (`from('cards').select()`, `from('lands').select()`) so the
 *      app never breaks because the Worker is down.
 *
 * Admin write paths (CRUD on `cards`) still go through `useCards` →
 * Supabase directly. Worker is read-only for the catalog.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getGameWsBaseUrl, isGameWsConfigured } from '../utils/gameWebSocket'
import { supabase } from '../utils/supabase'
import { idbGet, idbSet, idbDelete } from '../utils/catalogIdb'
import { isOfflineTestMode } from '../utils/offlineMode'
import { TEST_CARDS, TEST_LANDS } from '../fixtures/testCatalog'

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const SUPABASE_TIMEOUT_MS = 8_000

// Module-level shared cache — every consumer in the same tab sees the
// same in-memory array without re-fetching. Cleared by `invalidateCatalog`.
const memoryCache = new Map() // key → { data, fetchedAt }

function catalogBaseUrl() {
  // Worker URL is HTTPS even for local dev (wrangler proxies http).
  return getGameWsBaseUrl().replace(/\/$/, '')
}

function httpBase(base) {
  if (base.startsWith('http://') || base.startsWith('https://')) return base
  return `https://${base.replace(/^wss?:\/\//, '')}`
}

async function fetchFromWorker(key) {
  const base = catalogBaseUrl()
  if (!isGameWsConfigured()) throw new Error('worker not configured')
  const res = await fetch(`${httpBase(base)}/catalog/${key}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`worker returned ${res.status}`)
  }
  const body = await res.json()
  if (!body || !Array.isArray(body.data)) {
    throw new Error('worker payload missing data array')
  }
  return body.data
}

async function fetchFromSupabase(key) {
  const table = key === 'cards' ? 'cards' : 'lands'
  const orderBy = key === 'cards' ? 'card_number' : 'name'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS)
  try {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(orderBy, { ascending: true })
      .abortSignal(controller.signal)
    if (error) throw error
    return data || []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Internal: read-through cache → IDB → Worker → Supabase fallback.
 * `forceRefresh` is used by `invalidateCatalog` and tests.
 */
export async function loadCatalog(key, { forceRefresh = false } = {}) {
  const now = Date.now()
  const hit = memoryCache.get(key)
  if (!forceRefresh && hit && now - hit.fetchedAt < CATALOG_TTL_MS) {
    return hit.data
  }

  if (!forceRefresh) {
    const persisted = await idbGet(`catalog:${key}`)
    if (persisted && Array.isArray(persisted.data) && now - (persisted.fetchedAt ?? 0) < CATALOG_TTL_MS) {
      memoryCache.set(key, persisted)
      return persisted.data
    }
  }

  let data = null
  let source = null
  if (isOfflineTestMode) {
    data = key === 'cards' ? TEST_CARDS : TEST_LANDS
    source = 'local-fixture'
  } else if (isGameWsConfigured()) {
    try {
      data = await fetchFromWorker(key)
      source = 'worker'
    } catch (err) {
      console.warn(`[catalog] worker fetch failed for ${key}:`, err?.message || err)
    }
  }

  if (data === null) {
    try {
      data = await fetchFromSupabase(key)
      source = 'supabase'
    } catch (err) {
      console.error(`[catalog] supabase fallback failed for ${key}:`, err?.message || err)
      data = []
    }
  }

  memoryCache.set(key, { data, fetchedAt: now, source })
  // IDB writes are best-effort; never throw out of here.
  idbSet(`catalog:${key}`, { data, fetchedAt: now, source }).catch(() => {})
  return data
}

/** Drop both memory and IDB caches. Useful after admin edits. */
export function invalidateCatalog(key) {
  if (key) {
    memoryCache.delete(key)
    idbDelete(`catalog:${key}`).catch(() => {})
  } else {
    memoryCache.clear()
  }
}

/**
 * React hook returning `{ rows, loading, error, source, reload }`.
 *
 * The first render serves from memory/IDB synchronously when possible,
 * then triggers a background refresh if the cache is stale.
 */
export function useCatalog(key) {
  const cached = memoryCache.get(key)
  const [rows, setRows] = useState(cached?.data ?? [])
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState(null)
  const [source, setSource] = useState(cached?.source ?? null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const reload = useCallback(
    async (force = false) => {
      setLoading(true)
      setError(null)
      try {
        const data = await loadCatalog(key, { forceRefresh: force })
        if (!mounted.current) return
        setRows(data)
        const entry = memoryCache.get(key)
        setSource(entry?.source ?? null)
      } catch (err) {
        if (!mounted.current) return
        setError(err?.message || String(err))
      } finally {
        if (mounted.current) setLoading(false)
      }
    },
    [key],
  )

  useEffect(() => {
    // Re-fetch only if memory cache is missing or stale.
    const entry = memoryCache.get(key)
    const isStale = !entry || Date.now() - entry.fetchedAt > CATALOG_TTL_MS
    /* eslint-disable react-hooks/set-state-in-effect --
       setLoading() внутри эффекта — это sync с внешней системой
       (WebSocket lifecycle): "stale → refetch", "fresh → готово". */
    if (isStale) reload(false)
    else setLoading(false)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key, reload])

  return { rows, loading, error, source, reload }
}

export function useCardsCatalog() {
  return useCatalog('cards')
}

export function useLandsCatalog() {
  return useCatalog('lands')
}