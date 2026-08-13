/**
 * Диагностика перезагрузок игрового поля.
 *
 * Включено в DEV автоматически. В production: localStorage.setItem('gameDebug', '1')
 * Выключить в DEV: localStorage.setItem('gameDebug', '0')
 */

const PREFIX = '[gameReload]'

export function isGameDebugEnabled() {
  if (!import.meta.env.PROD) {
    try {
      if (localStorage.getItem('gameDebug') === '0') return false
    } catch {
      /* ignore */
    }
    return true
  }
  try {
    return localStorage.getItem('gameDebug') === '1'
  } catch {
    return false
  }
}

/**
 * @param {'load'|'sync'|'patch'|'poll'|'ably'|'suppress'|'skip'|'enrich'} category
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 */
export function gameDebugLog(category, message, detail) {
  if (!isGameDebugEnabled()) return
  const ts = new Date().toISOString().slice(11, 23)
  if (detail && Object.keys(detail).length > 0) {
    console.info(`${PREFIX}:${category} ${ts} ${message}`, detail)
  } else {
    console.info(`${PREFIX}:${category} ${ts} ${message}`)
  }
}

/** Сводка состояния для логов. */
export function gameDebugSnapshot(game, versionRef) {
  if (!game) return { game: null, versionRef: versionRef?.current ?? 0 }
  return {
    gameId: game.id,
    status: game.status,
    version: game.version ?? 0,
    versionRef: versionRef?.current ?? 0,
    currentPlayer: game.current_player_id,
    turn: game.current_turn,
    players: (game.players || []).length,
  }
}
