/**
 * Lands catalog hook — public read-only consumer.
 *
 * Источник — локальный бандл каталога (`src/data/catalog.js`): земли выведены
 * из `LAND_DEFS`, потому что id земли совпадает с её типом.
 *
 * Хук сохраняет прежний API (`{ lands, loading, error, loadLands }`),
 * чтобы потребители и тесты не менялись.
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