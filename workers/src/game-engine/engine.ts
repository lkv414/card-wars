/**
 * engine.ts — top-level dispatcher. The Worker calls
 * `applyAction(state, action, actorId)` and gets either an updated state
 * or an error envelope back. The action's behavior lives in the
 * per-action modules (cards, combat, turn) — engine just routes.
 *
 * This is the single seam between WebSocket handlers and pure game logic.
 */

import type { Action, ApplyResult, EngineError, GameState } from './types'
import { isEngineError } from './types'
import {
  confirmLandSetup,
  discardFromHand,
  discardFromZone,
  drawFree,
  drawPaid,
  flipCard,
  playCard,
  reorderLands,
  shuffleDeckAction,
} from './cards'
import { activateAbility, dispatchMechanicEvent } from './mechanics-runtime'
import { endTurn, forfeitGame } from './turn'
import { validateAction } from './validation'
import { bumpVersion } from './utils'

export { validateAction } from './validation'
export { isEngineError } from './types'

/** Top-level entry point: validate, then apply. */
export function applyAction(
  state: GameState,
  action: Action,
  actorId: string,
): ApplyResult | EngineError {
  const check = validateAction(state, action, actorId)
  if (!check.ok) return { error: check.error }

  switch (action.type) {
    case 'play_card':
      return playCard(state, action)
    case 'draw_free':
      return drawFree(state)
    case 'draw_paid':
      return drawPaid(state)
    case 'shuffle_deck':
      return shuffleDeckAction(state)
    case 'discard_from_hand':
      return discardFromHand(state, action)
    case 'discard_from_zone':
      return discardFromZone(state, action)
    case 'flip_card':
      return flipCard(state, action)
    case 'use_ability': {
      const result = activateAbility(state, {
        actorId,
        zonePosition: action.zonePosition,
        cardId: action.cardId,
        mechanicIndex: action.mechanicIndex,
        targetCardIds: action.targetCardIds,
      })
      if (result.error) return { error: result.error }
      return { state: bumpVersion(result.state) }
    }
    case 'attack':
      // Attack goes through the same path that endTurn uses internally —
      // resolveAttack — but we expose a single-call wrapper here for the
      // per-attack client action. The endTurn pipeline calls it four
      // times directly without re-entering applyAction.
      return applySingleAttack(state, action, actorId)
    case 'end_turn':
      return endTurn(state)
    case 'forfeit':
      return forfeitGame(state, actorId)
    case 'reorder_lands':
      return reorderLands(state, action, actorId)
    case 'confirm_land_setup':
      return confirmLandSetup(state, action)
    default: {
      const exhaustive: never = action
      void exhaustive
      return { error: 'Неизвестное действие' }
    }
  }
}

/**
 * Per-attack wrapper used by `applyAction('attack')`. Mirrors
 * `perform_attack` — the SQL RPC actually wrapped `resolve_lane_battle`
 * for one lane. We do the same here.
 */
import { resolveAttack } from './combat'

function applySingleAttack(
  state: GameState,
  action: Extract<Action, { type: 'attack' }>,
  actorId: string,
): ApplyResult | EngineError {
  const { state: resolved, event } = resolveAttack(state, actorId, action.fromZone, {
    attackerCardId: action.attackerCardId,
    defenderId: action.toPlayerId,
    toZone: action.toZone,
  })
  const next = dispatchMechanicEvent(resolved, {
    type: 'on_creature_attacks',
    actorId,
    cardId: event.attacker_instance_id || undefined,
    targetCardIds: [],
  })
  // If face damage killed the last opponent, finish the game.
  let gameFinished = false
  let winnerId: string | null = null
  if (event.face_damage > 0) {
    const aliveAfter = next.players.filter((p) => (p.health ?? 0) > 0)
    if (aliveAfter.length <= 1) {
      gameFinished = true
      winnerId = actorId
    }
  }
  if (gameFinished) {
    return {
      state: {
        ...next,
        status: 'finished',
        winner_id: winnerId,
        ended_at: new Date().toISOString(),
        version: (next.version ?? 0) + 1,
      },
      battleEvents: [event],
      gameFinished: true,
      winnerId,
    }
  }
  if (event.damage === 0 && event.face_damage === 0) {
    return { error: 'Нет подходящей цели' }
  }
  return {
    state: { ...next, version: (next.version ?? 0) + 1 },
    battleEvents: [event],
  }
}

/**
 * Convenience: re-export the engine error guard so callers don't have
 * to import the type module separately.
 */
export function isError(r: ApplyResult | EngineError): r is EngineError {
  return isEngineError(r)
}