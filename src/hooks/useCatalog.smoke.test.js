/**
 * Smoke test for useCatalog's load order:
 *   memory cache (within TTL), then IndexedDB, then Worker fetch,
 *   with Supabase fallback when the Worker is unreachable.
 *
 * Runs under `npm run test:smoke` (vitest jsdom env, react plugin).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the supabase proxy at the module boundary so the Supabase fallback
// path resolves instantly instead of trying to reach the real network.
const mockSupabaseFrom = vi.fn()
vi.mock('../utils/supabase.js', () => ({
  supabase: {
    from: (...args) => mockSupabaseFrom(...args),
  },
}))

const sampleCards = [{ id: 'c1', name: 'Test Card' }]

function setupSupabaseFallback(data) {
  mockSupabaseFrom.mockImplementation(() => ({
    select: () => ({
      order: () => ({
        abortSignal: () => Promise.resolve({ data, error: null }),
      }),
    }),
  }))
}

describe('useCatalog fallback chain', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockSupabaseFrom.mockReset()
  })

  afterEach(() => {
    delete globalThis.fetch
    delete process.env.VITE_GAME_WS_URL
  })

  it('calls Worker first, then falls back when Worker returns 5xx', async () => {
    setupSupabaseFallback(sampleCards)
    process.env.VITE_GAME_WS_URL = 'https://card-wars-game.example.workers.dev'
    const { loadCatalog, invalidateCatalog } = await import('./useCatalog.js')
    invalidateCatalog('cards')

    let workerCalls = 0
    let supabaseCalls = 0
    globalThis.fetch = vi.fn((url) => {
      if (typeof url === 'string' && url.includes('/catalog/cards')) {
        workerCalls += 1
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'boom' }), { status: 503 }),
        )
      }
      return Promise.reject(new Error('unexpected fetch: ' + url))
    })
    const wrappedSupabase = mockSupabaseFrom.mockImplementation(() => {
      supabaseCalls += 1
      return {
        select: () => ({
          order: () => ({
            abortSignal: () => Promise.resolve({ data: sampleCards, error: null }),
          }),
        }),
      }
    })
    void wrappedSupabase

    const data = await loadCatalog('cards')
    expect(workerCalls).toBe(1)
    expect(supabaseCalls).toBe(1)
    expect(data).toEqual(sampleCards)
  })

  it('serves from memory cache on the second call without hitting Worker again', async () => {
    setupSupabaseFallback(sampleCards)
    process.env.VITE_GAME_WS_URL = 'https://card-wars-game.example.workers.dev'
    const { loadCatalog, invalidateCatalog } = await import('./useCatalog.js')
    invalidateCatalog('cards')

    let workerCalls = 0
    globalThis.fetch = vi.fn((url) => {
      if (typeof url === 'string' && url.includes('/catalog/cards')) {
        workerCalls += 1
        return Promise.resolve(
          new Response(JSON.stringify({ data: sampleCards }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.reject(new Error('unexpected fetch: ' + url))
    })

    await loadCatalog('cards')
    await loadCatalog('cards')
    expect(workerCalls).toBe(1)
  })

  it('skips Worker when VITE_GAME_WS_URL is not configured', async () => {
    delete process.env.VITE_GAME_WS_URL
    setupSupabaseFallback(sampleCards)
    const { loadCatalog, invalidateCatalog } = await import('./useCatalog.js')
    invalidateCatalog('cards')

    let fetchCalled = false
    globalThis.fetch = vi.fn(() => {
      fetchCalled = true
      return Promise.reject(new Error('fetch should not be called'))
    })

    const data = await loadCatalog('cards')
    expect(fetchCalled).toBe(false)
    expect(data).toEqual(sampleCards)
  })
})