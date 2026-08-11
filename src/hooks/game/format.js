/**
 * format.js — утилиты преобразования game state.
 *
 * Раньше жили внутри useGameAction.js. Вынесены, чтобы можно было
 * использовать отдельно (например, в GameBoard.jsx нужно только
 * gameToEngineFormat, без хуков).
 */

export function clampZones(zones) {
  // Ensure exactly 4 zones of arrays
  const out = [[], [], [], []]
  for (let i = 0; i < 4; i++) {
    if (Array.isArray(zones?.[i])) out[i] = zones[i]
  }
  return out
}

/** Нормализует одну зону: Array<Card> или { cards: [] } → массив карт */
export function normalizeZoneCards(zone) {
  if (Array.isArray(zone)) return zone
  if (zone && typeof zone === 'object') return zone.cards || []
  return []
}

/** Нормализует все 4 зоны игрока */
export function normalizePlayerZones(zonesRaw) {
  if (Array.isArray(zonesRaw)) {
    return zonesRaw.map((zone) => normalizeZoneCards(zone))
  }
  if (zonesRaw && typeof zonesRaw === 'object') {
    return [0, 1, 2, 3].map((i) => normalizeZoneCards(zonesRaw[i]))
  }
  return [[], [], [], []]
}

/**
 * Convert GameScreen's flat game object into GameEngine format for 2-4 players:
 *   { gameState, self, opponents }
 *
 * `self` is the current player, `opponents` is the list of other players
 * (already excluding the current one). For 2 players we also keep the
 * `player1`/`player2` aliases for the legacy engine.
 */
export function gameToEngineFormat(game, playerId) {
  if (!game || !Array.isArray(game.players) || game.players.length < 1) return null

  const players = game.players
  let selfIndex = players.findIndex((p) => p.player_id === playerId)
  if (selfIndex === -1) selfIndex = 0
  const self = players[selfIndex]
  const opponents = players.filter((_, i) => i !== selfIndex)
  const player1 = players[0]
  const player2 = players[1] || null

  const gs = game.game_state || {}
  const defaults = { health: 25, hand: [], deck_remaining: 35, actionsRemaining: 2, hasAttacked: false }

  const normalize = (p, fallbackId) => ({
    id: p?.player_id ?? fallbackId,
    health: p?.health ?? defaults.health,
    hand: p?.hand || [],
    zones: clampZones(p?.zones),
    actionsRemaining: p?.actionsRemaining ?? defaults.actionsRemaining,
    hasAttacked: p?.hasAttacked ?? defaults.hasAttacked,
    deck_remaining: p?.deck_remaining ?? defaults.deck_remaining,
  })

  return {
    gameState: {
      status: gs.status || game.status || 'active',
      currentTurn: game.current_turn || 0,
      currentPlayerId: game.current_player_id || self?.player_id,
      turnPhase: gs.turnPhase || 'main',
      winner: game.winner_id || null,
      history: gs.history || [],
      log: gs.log || [],
    },
    self: normalize(self, selfIndex),
    opponents: opponents.map((p, i) => normalize(p, `${selfIndex + 1}_${i}`)),
    // legacy aliases for the 2-player engine
    player1: normalize(player1, 0),
    player2: player2 ? normalize(player2, 1) : null,
  }
}