/**
 * supabase.ts — REST клиент к Supabase из Cloudflare Workers.
 *
 * Что улучшено по PERFORMANCE_AUDIT_WORKERS.md (🔴 Критично K3, K8):
 *   - Все RPC/PATCH/GET оборачиваются в `fetchWithTimeout(8s)` через AbortController.
 *     Если Supabase висит — DO не подвисает на 30+ с, ошибка приходит за ~8 с
 *     и heartbeat других клиентов не страдает.
 *   - In-memory кеш `getPlayerGameState` (TTL 5с). На hot room auth-check не
 *     ходит в Supabase на каждый reconnect — это самая частая RPC в DO.
 *   - Защита `persistSnapshot` через `blockConcurrencyWhile` (game-room.ts) —
 *     два одновременных PATCH'а не перетрут друг друга.
 */

import type { Env } from './env'

type RpcResult = Record<string, unknown> & { error?: string }

const SUPABASE_TIMEOUT_MS = 8_000

function requireSupabase(env: Env) {
  const url = env.SUPABASE_URL?.trim()
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the Worker')
  }
  return { url, key }
}

/**
 * fetch с timeout через AbortController — гарантирует, что DO не подвисает
 * на зависшей Supabase RPC. На AbortError выбрасываем с понятным сообщением.
 */
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = SUPABASE_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Supabase request timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function callRpc(
  env: Env,
  fn: string,
  args: Record<string, unknown>
): Promise<RpcResult> {
  const { url, key } = requireSupabase(env)
  const res = await fetchWithTimeout(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(args),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(text || `RPC ${fn} failed (${res.status})`)
  }

  if (!text) return {}
  try {
    return JSON.parse(text) as RpcResult
  } catch {
    return { raw: text }
  }
}

/**
 * In-memory кеш для hot rooms (PERFORMANCE_AUDIT_WORKERS K8):
 * auth-check не должен ходить в Supabase на каждый WS reconnect, если state
 * не менялся. TTL 5с — auth-данные редко меняются в пределах одной партии.
 *
 * Лимит: 256 ключей = защита от утечки памяти при DoS-открытии новых комнат.
 */
const PLAYER_CACHE_TTL_MS = 5_000
const PLAYER_CACHE_MAX = 256
const playerCache = new Map<string, { value: Record<string, unknown>; ts: number }>()

function cacheKey(gameId: string, playerId: string): string {
  return `${gameId}:${playerId}`
}

function prunePlayerCache(now: number): void {
  if (playerCache.size <= PLAYER_CACHE_MAX) return
  // Простейшая FIFO-eviction: удаляем самые старые записи.
  for (const [key, entry] of playerCache) {
    if (now - entry.ts > PLAYER_CACHE_TTL_MS) playerCache.delete(key)
  }
  // Если всё ещё переполнен — удаляем первый ключ (Map сохраняет порядок вставки).
  if (playerCache.size > PLAYER_CACHE_MAX) {
    const oldest = playerCache.keys().next().value
    if (oldest) playerCache.delete(oldest)
  }
}

export async function getPlayerGameState(
  env: Env,
  gameId: string,
  playerId: string
): Promise<Record<string, unknown>> {
  const key = cacheKey(gameId, playerId)
  const now = Date.now()
  const hit = playerCache.get(key)
  if (hit && now - hit.ts < PLAYER_CACHE_TTL_MS) {
    return hit.value
  }
  const data = await callRpc(env, 'get_player_game_state', {
    p_game_id: gameId,
    p_player_id: playerId,
  })
  if (data.error) {
    throw new Error(String(data.error))
  }
  prunePlayerCache(now)
  playerCache.set(key, { value: data, ts: now })
  return data
}

/**
 * Full (unredacted) snapshot for the Worker's in-memory GameRoom.
 * Reads every player's full hand/deck/discard so the engine can mutate
 * state without going back to Supabase.
 */
export async function getFullGameState(
  env: Env,
  gameId: string
): Promise<Record<string, unknown> | null> {
  // The Worker snapshot is authoritative. Prefer games.state and only use the
  // legacy normalized-table RPC for games created before the state column.
  try {
    const { url, key } = requireSupabase(env)
    const res = await fetchWithTimeout(
      `${url}/rest/v1/games?id=eq.${encodeURIComponent(gameId)}&select=state`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: 'return=representation',
        },
      },
    )
    if (res.ok) {
      const rows = (await res.json()) as Array<{ state?: unknown }>
      const snapshot = rows[0]?.state
      if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
        return snapshot as Record<string, unknown>
      }
    }
  } catch {
    // Fall through to the legacy RPC when the snapshot column is absent.
  }

  try {
    const data = await callRpc(env, 'get_full_game_state', {
      p_game_id: gameId,
    })
    if (data.error) return null
    return data
  } catch {
    return null
  }
}

/**
 * Persist the full game state back to Supabase. Called periodically
 * by GameRoom to keep the database as a snapshot of the latest version
 * the Worker has seen.
 */
export async function saveFullGameState(
  env: Env,
  gameId: string,
  state: Record<string, unknown>
): Promise<void> {
  const { url, key } = requireSupabase(env)
  const res = await fetchWithTimeout(
    `${url}/rest/v1/games?id=eq.${encodeURIComponent(gameId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(state),
    },
  )
  if (!res.ok) {
    throw new Error(`saveFullGameState failed: ${res.status} ${await res.text()}`)
  }
}

/** Verify guest is a participant before accepting WS join. */
export async function assertPlayerInGame(
  env: Env,
  gameId: string,
  clientId: string
): Promise<void> {
  await getPlayerGameState(env, gameId, clientId)
}

export async function assertPlayerInLobby(
  env: Env,
  lobbyId: string,
  clientId: string
): Promise<void> {
  const { url, key } = requireSupabase(env)
  const res = await fetchWithTimeout(
    `${url}/rest/v1/lobby_players?lobby_id=eq.${lobbyId}&player_id=eq.${encodeURIComponent(clientId)}&select=player_id`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    },
  )
  if (!res.ok) {
    throw new Error(`Lobby membership check failed (${res.status})`)
  }
  const rows = (await res.json()) as unknown[]
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Игрок не в этом лобби')
  }
}

/**
 * Fetch full lobby snapshot including nested lobby_players + deck. Использует
 * общий `fetchWithTimeout` (PERFORMANCE_AUDIT_WORKERS K3).
 */
export async function fetchLobbyRow(
  env: Env,
  lobbyId: string,
): Promise<unknown> {
  const { url, key } = requireSupabase(env)
  const res = await fetchWithTimeout(
    `${url}/rest/v1/lobbies?id=eq.${encodeURIComponent(lobbyId)}&select=*,lobby_players(*,deck)`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    },
  )
  if (!res.ok) {
    throw new Error(`Lobby fetch failed (${res.status})`)
  }
  const rows = (await res.json()) as unknown[]
  return Array.isArray(rows) ? rows[0] ?? null : rows
}

/** Только для тестов: сбросить кеш. */
export function __resetSupabaseCaches(): void {
  playerCache.clear()
}