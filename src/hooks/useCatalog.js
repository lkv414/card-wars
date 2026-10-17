/**
 * useCatalog — каталог игры (карты + земли) из локального бандла.
 *
 * История: раньше читал Worker `/catalog/{cards|lands}` (KV), с фолбэком на
 * Supabase REST и кэшем в IndexedDB. С этапа 5 каталог лежит в бандле
 * (`src/data/catalog.js`), поэтому сеть, IndexedDB и Supabase здесь не нужны.
 *
 * Публичный API сохранён, чтобы потребители (`useLands`, `LibraryContext`,
 * `GameScreen`) не менялись: `{ rows, loading, error, source, reload }`.
 */
import { useCallback } from 'react'
import { CATALOG } from '../data/catalog'

/** Асинхронная обёртка для совместимости с прежним контрактом. */
export function loadCatalog(key) {
  return Promise.resolve(CATALOG[key] ?? [])
}

/** Раньше сбрасывал кэши памяти и IndexedDB; с локальным каталогом — no-op. */
export function invalidateCatalog() {}

export function useCatalog(key) {
  const rows = CATALOG[key] ?? []
  const reload = useCallback(() => loadCatalog(key), [key])

  return { rows, loading: false, error: null, source: 'local', reload }
}

export function useCardsCatalog() {
  return useCatalog('cards')
}

export function useLandsCatalog() {
  return useCatalog('lands')
}
