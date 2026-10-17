/**
 * Smoke test for useCatalog: каталог приходит из локального бандла
 * (`src/data/catalog.js`), без сети, IndexedDB и Supabase.
 *
 * Runs under `npm run test:smoke` (vitest jsdom env, react plugin).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('useCatalog — локальный каталог', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loadCatalog cards возвращает карты из бандла и не ходит в сеть', async () => {
    let fetchCalled = false
    globalThis.fetch = vi.fn(() => {
      fetchCalled = true
      return Promise.reject(new Error('fetch should not be called'))
    })

    const { loadCatalog } = await import('./useCatalog.js')
    const data = await loadCatalog('cards')

    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty('id')
    expect(data[0]).toHaveProperty('image_url')
    expect(fetchCalled).toBe(false)
  })

  it('loadCatalog lands отдаёт земли, выведенные из LAND_DEFS', async () => {
    const { loadCatalog } = await import('./useCatalog.js')
    const lands = await loadCatalog('lands')

    expect(lands.map((l) => l.id).sort()).toEqual(['blue', 'corn', 'good', 'ice', 'sand', 'swamp'])
    for (const land of lands) {
      expect(land.land_type).toBe(land.id)
      expect(typeof land.name).toBe('string')
    }
  })

  it('неизвестный ключ каталога даёт пустой массив', async () => {
    const { loadCatalog } = await import('./useCatalog.js')
    expect(await loadCatalog('nope')).toEqual([])
  })

  it('invalidateCatalog больше не сбрасывает данные (каталог статичен)', async () => {
    const { loadCatalog, invalidateCatalog } = await import('./useCatalog.js')
    const first = await loadCatalog('cards')
    invalidateCatalog('cards')
    const second = await loadCatalog('cards')
    expect(second).toBe(first)
  })
})
