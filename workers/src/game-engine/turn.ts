/**
 * Turn lifecycle: endTurn (the meat of the game loop), plus the
 * pre-game setup helpers that already live in `cards.ts` but are exposed
 * from one place.
 *
 * `endTurn` mirrors the legacy `end_turn` plpgsql:
 *   1. Validate that the actor is the current player and the game is active.
 *   2. If `canPlayerDealDamage`, resolve 4 lane battles (lanes 1..4).
 *   3. If face damage killed the last opponent, finish the game.
 *   4. Pick the next alive player (circular).
 *   5. Draw +1 from their deck.
 *   6. Untap every card on every zone for that player.
 *   7. Reset `actions_remaining=2`, `free_draw_used=false`, `paid_draw_used=false`.
 *   8. Bump version, increment `current_turn`, refresh `turn_started_at`.
 *
 * No I/O — pure.
 */

import { bumpVersion, getActivePlayer, getAlivePlayers } from './utils'
import { canPlayerDealDamage, resolveAttack } from './combat'
import { drawTopCard, reshuffleIfNeeded } from './utils'
import { clearFlipMarks } from './cards'
import { cleanupTemporaryEffects, dispatchMechanicEvent } from './mechanics-runtime'
import type { ApplyResult, Card, EngineError, GameState, PlayerState } from './types'

function err(msg: string): EngineError {
  return { error: msg }
}

/**
 * forfeit — current player concedes the game. The next alive player (in
 * player_order) is declared the winner. If nobody is alive, `winnerId`
 * stays null.
 */
export function forfeitGame(state: GameState, actorId: string): ApplyResult | EngineError {
  const me = state.players.find((p) => p.player_id === actorId)
  if (!me) return err('Игрок не найден')
  if (state.status === 'finished') return err('Игра уже завершена')

  const aliveOthers = state.players
    .filter((p) => (p.health ?? 0) > 0 && p.player_id !== actorId)
    .sort((a, b) => (a.player_order ?? 0) - (b.player_order ?? 0))

  const winnerId = aliveOthers[0]?.player_id ?? null
  const updatedPlayers = state.players.map((p) =>
    p.player_id === actorId ? { ...p, health: 0 } : p,
  )

  const next = bumpVersion({
    ...state,
    status: 'finished' as const,
    winner_id: winnerId,
    ended_at: new Date().toISOString(),
    players: updatedPlayers,
  })

  return {
    state: next,
    gameFinished: true,
    winnerId,
    logEntry: `${me.nickname ?? actorId} сдался`,
  }
}

/**
 * Untap every creature card on every zone for the given player.
 * Untapping means clearing the `tapped` flag (which marks "already
 * attacked this turn").
 */
function untapAll(player: PlayerState): PlayerState {
  return {
    ...player,
    zones: player.zones.map((z) => ({
      ...z,
      cards: z.cards.map((c) =>
        c.card_type === 'building' || c.card_type === 'spell' ? c : { ...c, tapped: false },
      ),
    })),
  }
}

/**
 * Refill `actions_remaining` to 2 and clear draw flags for the player whose
 * turn is starting.
 */
function resetTurnCounters(player: PlayerState): PlayerState {
  return {
    ...player,
    actions_remaining: 2,
    free_draw_used: false,
    paid_draw_used: false,
    cost_reduction: 0,
    free_play_next: false,
  }
}

export function endTurn(state: GameState): ApplyResult | EngineError {
  if (state.status !== 'active') return err('Игра не активна')
  const attacker = getActivePlayer(state)
  if (!attacker) return err('Сейчас не ваш ход')

  // Сбрасываем flipped_this_turn у атакующего (чтобы в следующий ход снова можно было флипнуть)
  const cleaned = clearFlipMarks(state)
  const attackerFromCleaned = getActivePlayer(cleaned)
  if (!attackerFromCleaned) return err('Сейчас не ваш ход')

  const alivePlayers = getAlivePlayers(cleaned)
  if (alivePlayers.length < 1) return err('Нет живых игроков')
  if (alivePlayers.length === 1 && alivePlayers[0].player_id === attacker.player_id) {
    return err('Вы единственный живой — игра окончена')
  }

  let workingState = cleanupTemporaryEffects(cleaned)
  workingState = dispatchMechanicEvent(workingState, { type: 'end_of_turn', actorId: attacker.player_id })
  let battleEvents: ApplyResult['battleEvents'] = []
  let gameFinished = false
  let winnerId: string | null | undefined = undefined

  if (canPlayerDealDamage(attacker.player_order, alivePlayers.length, state.current_turn ?? 0)) {
    for (let lane = 1; lane <= 4; lane += 1) {
      const { state: after, event } = resolveAttack(workingState, attacker.player_id, lane)
      workingState = dispatchMechanicEvent(after, {
        type: 'on_creature_attacks',
        actorId: attacker.player_id,
        cardId: event.attacker_instance_id || undefined,
        targetCardIds: [],
      })
      battleEvents = [...(battleEvents ?? []), event]

      if (event.face_damage > 0) {
        const aliveAfter = workingState.players.filter((p) => (p.health ?? 0) > 0)
        if (aliveAfter.length <= 1) {
          gameFinished = true
          winnerId = attacker.player_id
          break
        }
      }
    }
  }

  if (gameFinished) {
    const next = bumpVersion(
      {
        ...workingState,
        status: 'finished',
        winner_id: winnerId ?? null,
        ended_at: new Date().toISOString(),
      },
      { status: 'finished', ended_at: new Date().toISOString(), winner_id: winnerId ?? null },
    )
    return {
      state: next,
      battleEvents,
      gameFinished: true,
      winnerId: winnerId ?? null,
      logEntry: `${attacker.nickname ?? attacker.player_id} победил после боя!`,
    }
  }

  // Pick the next alive player circularly.
  const attackerIdx = alivePlayers.findIndex((p) => p.player_id === attacker.player_id)
  if (attackerIdx === -1) return err('Игрок не найден среди живых')
  const nextIdx = (attackerIdx + 1) % alivePlayers.length
  const nextPlayer = alivePlayers[nextIdx]
  if (!nextPlayer) return err('Следующий игрок недоступен')
  if ((nextPlayer.health ?? 0) <= 0) return err('Следующий игрок недоступен')

  // Draw +1 from their deck (with reshuffle fallback).
  const reshuffled = reshuffleIfNeeded(nextPlayer.deck_pile ?? [], nextPlayer.discard_pile ?? [])
  let newHand = nextPlayer.hand ?? []
  let newDeck: Card[] = reshuffled.deck
  let newDiscard: Card[] = reshuffled.discard
  let drewCard = false
  if (newDeck.length > 0) {
    const { drawn, newDeck: nd } = drawTopCard(newDeck)
    newHand = [...newHand, drawn]
    newDeck = nd
    drewCard = true
  }

  let advancedNext: PlayerState = {
    ...nextPlayer,
    hand: newHand,
    deck_pile: newDeck,
    deck_remaining: newDeck.length,
    discard_pile: newDiscard,
  }
  advancedNext = resetTurnCounters(untapAll(advancedNext))

  const players = workingState.players.map((p) =>
    p.player_id === advancedNext.player_id ? advancedNext : p,
  )

  let nextTurnState: GameState = {
    ...workingState,
    current_player_id: advancedNext.player_id,
    current_turn: (workingState.current_turn ?? 0) + 1,
    players,
    game_state: { ...(workingState.game_state ?? {}), turnPhase: 'main' },
  }
  nextTurnState = dispatchMechanicEvent(nextTurnState, { type: 'start_of_next_turn', actorId: advancedNext.player_id })
  nextTurnState = dispatchMechanicEvent(nextTurnState, { type: 'start_of_turn', actorId: advancedNext.player_id })

  const logEntry = drewCard
    ? `Ход: ${advancedNext.nickname ?? advancedNext.player_id} · +1 карта · 2 действия`
    : `Ход: ${advancedNext.nickname ?? advancedNext.player_id} · колода пуста · 2 действия`

  const final = bumpVersion({
    ...nextTurnState,
    game_state: { ...(nextTurnState.game_state ?? {}), log: appendLog(nextTurnState, logEntry) },
  })

  return {
    state: final,
    battleEvents,
    gameFinished: false,
    logEntry,
  }
}

function appendLog(state: GameState, line: string): unknown[] {
  const raw = (state.game_state ?? {}).log
  const existing = Array.isArray(raw) ? (raw as unknown[]) : []
  return [
    ...existing,
    { timestamp: Date.now(), message: line },
  ]
}