/**
 * Lands catalog hook — public read-only consumer.
 *
 * Source of truth is Cloudflare KV served by the Worker at
 * `/catalog/lands`. See `useCatalog` for the full cache chain
 * (memory → IndexedDB → Worker → Supabase fallback).
 *
 * This hook keeps its old API (`{ lands, loading, error, loadLands }`)
 * so existing callers and tests don't have to change.
 */
import { useCallback, useMemo } from 'react'
import { useCatalog } from './useCatalog'

export function useLands() {
  const { rows, loading, error, reload } = useCatalog('lands')

  const loadLands = useCallback(
    (force) => reload(Boolean(force)),
    [reload],
  )

  return useMemo(
    () => ({ lands: rows, loading, error, loadLands }),
    [rows, loading, error, loadLands],
  )
}