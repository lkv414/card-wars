/**
 * Smoke tests for saveFullGameState — verifies the Worker calls
 * PATCH /rest/v1/games with the expected JSON body containing `state`
 * (the snapshot column added in migration 20260902100000) plus the
 * legacy compatibility columns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('saveFullGameState', () => {
  let originalFetch: typeof fetch | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch
    } else {
      // Strict TS treats `fetch` as required, so we restore via
      // assignment to undefined rather than `delete`.
      ;(globalThis as { fetch?: typeof fetch }).fetch = undefined
    }
  })

  it('sends a PATCH with the snapshot column and compatibility fields', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = init
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const env = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    } as any

    const { saveFullGameState } = await import('./supabase.js')
    await saveFullGameState(env, 'g1', {
      state: { id: 'g1', status: 'active', players: [] },
      version: 5,
      status: 'active',
    })

    expect(capturedUrl).toBe('https://example.supabase.co/rest/v1/games?id=eq.g1')
    expect(capturedInit?.method).toBe('PATCH')
    const body = JSON.parse(String(capturedInit?.body))
    expect(body.state).toBeDefined()
    expect(body.state.id).toBe('g1')
    expect(body.state.status).toBe('active')
    expect(body.version).toBe(5)
    expect(body.status).toBe('active')
  })

  it('throws when the response is not OK', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('{"message":"DB error"}', { status: 500, headers: { 'Content-Type': 'application/json' } }),
    ) as typeof fetch

    const env = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    } as any

    const { saveFullGameState } = await import('./supabase.js')
    await expect(
      saveFullGameState(env, 'g1', { state: {}, version: 1 }),
    ).rejects.toThrow(/saveFullGameState failed/)
  })
})