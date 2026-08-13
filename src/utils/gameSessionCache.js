/** In-memory cache so game board survives React Strict Mode remounts. */

/** @type {Map<string, object>} */
const sessions = new Map()

export function peekGameSession(gameId) {
  if (!gameId) return null
  return sessions.get(gameId) ?? null
}

export function rememberGameSession(gameId, game) {
  if (gameId && game) sessions.set(gameId, game)
}

export function forgetGameSession(gameId) {
  if (gameId) sessions.delete(gameId)
}
