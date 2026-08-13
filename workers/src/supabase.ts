import type { Env } from './env'

type RpcResult = Record<string, unknown> & { error?: string }

function requireSupabase(env: Env) {
  const url = env.SUPABASE_URL?.trim()
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the Worker')
  }
  return { url, key }
}

export async function callRpc(
  env: Env,
  fn: string,
  args: Record<string, unknown>
): Promise<RpcResult> {
  const { url, key } = requireSupabase(env)
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
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

export async function getPlayerGameState(
  env: Env,
  gameId: string,
  playerId: string
): Promise<Record<string, unknown>> {
  const data = await callRpc(env, 'get_player_game_state', {
    p_game_id: gameId,
    p_player_id: playerId,
  })
  if (data.error) {
    throw new Error(String(data.error))
  }
  return data
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
  const res = await fetch(
    `${url}/rest/v1/lobby_players?lobby_id=eq.${lobbyId}&player_id=eq.${encodeURIComponent(clientId)}&select=player_id`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    }
  )
  if (!res.ok) {
    throw new Error(`Lobby membership check failed (${res.status})`)
  }
  const rows = (await res.json()) as unknown[]
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Игрок не в этом лобби')
  }
}
