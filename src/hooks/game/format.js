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

/**
 * Convert GameScreen's flat game object into GameEngine format:
 *   { gameState, player1, player2 }
 *
 * @param {object} game - flat game state from useGameState
 * @param {string} playerId - current player id
 * @returns {object|null} - engine format or null if not enough players
 */
export function gameToEngineFormat(game, playerId) {
  if (!game || !game.players || game.players.length < 2) return null

  const players = game.players
  const player1 = players[0]
  const player2 = players[1]

  const isPlayer1 = player1.player_id === playerId
  const self = isPlayer1 ? player1 : player2
  const opponent = isPlayer1 ? player2 : player1

  const gs = game.game_state || {}

  return {
    gameState: {
      status: gs.status || game.status || 'active',
      currentTurn: game.current_turn || 0,
      currentPlayerId: game.current_player_id || player1.player_id,
      turnPhase: gs.turnPhase || 'main',
      winner: game.winner_id || null,
      history: gs.history || [],
      log: gs.log || [],
    },
    player1: {
      id: player1.player_id,
      health: player1.health ?? 25,
      hand: player1.hand || [],
      zones: clampZones(player1.zones),
      actionsRemaining: self.actionsRemaining ?? 2,
      hasAttacked: self.hasAttacked ?? false,
      deck_remaining: player1.deck_remaining ?? 35,
    },
    player2: {
      id: player2.player_id,
      health: player2.health ?? 25,
      hand: opponent.hand || [],
      zones: clampZones(opponent.zones),
      actionsRemaining: opponent.actionsRemaining ?? 2,
      hasAttacked: opponent.hasAttacked ?? false,
      deck_remaining: player2.deck_remaining ?? 35,
    },
  }
}