/**
 * Local-first mode for development and smoke testing.
 *
 * The production app still uses Supabase for authentication and catalog writes,
 * but the game itself can be exercised without a Supabase connection through
 * the local Cloudflare Worker and the test catalog fixtures.
 */
export const isOfflineTestMode = import.meta.env.VITE_OFFLINE_TEST_MODE === 'true'

export const localWorkerBaseUrl =
  import.meta.env.VITE_LOCAL_WORKER_URL?.trim() || 'http://127.0.0.1:8787'
