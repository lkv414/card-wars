export interface Env {
  GAME_ROOM: DurableObjectNamespace
  LOBBY_ROOM: DurableObjectNamespace
  /**
   * Cloudflare KV namespace holding the read-only game catalog:
   *   - key 'cards'  → array of card blueprints (JSON)
   *   - key 'lands'  → array of landscape blueprints (JSON)
   * Populated by `node scripts/migrate-catalog-to-kv.mjs`.
   * Worker fetches the catalog via `env.CATALOG.get(key, 'json')` — no Supabase RPC.
   */
  CATALOG: KVNamespace
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  ENVIRONMENT?: string
}
