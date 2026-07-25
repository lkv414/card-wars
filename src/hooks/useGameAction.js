/**
 * useGameAction
 * Hook for game actions: playCard, attack, endTurn.
 * Writes to Supabase with version check (optimistic lock).
 *
 * Phase 4 (deck refill):
 *   - `playCard` добирает карту из deck_pile в hand, если hand < STARTING_HAND_SIZE
 *   - `endTurn` (draw-фаза) добирает 1 карту из deck_pile нового активного игрока
 *
 * Phase 5 (server-side validation):
 *   Все UPDATE/INSERT в games / game_players / game_zones проходят через
 *   Postgres-триггеры из миграции `20260725010000_phase5_server_validation.sql`:
 *   - games: проверка status, current_player_id, version (optimistic lock + 1),
 *     winner_id обязателен при status='finished'.
 *   - game_players: hand — массив длиной ≤ STARTING_HAND_SIZE (5),
 *     health ∈ [0..25], deck_pile — массив, deck_remaining авто-синхронизируется
 *     с длиной deck_pile.
 *   - game_zones: zone_position ∈ [1..4], cards — массив длиной ≤ 10.
 *   Клиент шлёт согласованные данные; триггер прозрачен для легитимных операций.
 *
 * @param {object} game - current game state from useGameState
 * @param {function} reload - callback to reload after successful action
 * @returns {object} - { playCard, attack, endTurn, isApplying, error }
 */
import { useState, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { STARTING_HAND_SIZE } from '../constants/game'

function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function clampZones(zones) {
  // Ensure exactly 4 zones of arrays
  const out = [[], [], [], []]
  for (let i = 0; i < 4; i++) {
    if (Array.isArray(zones?.[i])) out[i] = zones[i]
  }
  return out
}

/**
 * Convert GameScreen's flat game object into GameEngine's format:
 *   { gameState, player1, player2 }
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

export function useGameAction(game, reload) {
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState(null)

  const writeGameState = useCallback(async (patch) => {
    if (!game?.id) {
      const e = 'Игра не загружена'
      setError(e)
      return { error: e }
    }
    setIsApplying(true)
    setError(null)
    try {
      // optimistic lock: only update if version matches
      const expectedVersion = game.version
      const next = {
        ...game,
        ...patch,
        game_state: { ...(game.game_state || {}), ...(patch.game_state || {}) },
        version: expectedVersion + 1,
        updated_at: new Date().toISOString(),
      }

      const { data, error: updateErr } = await supabase
        .from('games')
        .update({
          game_state: next.game_state,
          current_turn: next.current_turn,
          current_player_id: next.current_player_id,
          status: next.status,
          winner_id: next.winner_id,
          ended_at: next.ended_at,
          version: next.version,
          updated_at: next.updated_at,
        })
        .eq('id', game.id)
        .eq('version', expectedVersion)
        .select('version')
        .maybeSingle()

      if (updateErr) throw new Error(updateErr.message)
      if (!data) {
        // version conflict — reload
        if (reload) await reload()
        throw new Error('Конфликт версий — состояние перечитано')
      }

      if (reload) await reload()
      return { success: true, version: data.version }
    } catch (err) {
      const msg = err?.message || 'Не удалось обновить игру'
      setError(msg)
      return { error: msg }
    } finally {
      setIsApplying(false)
    }
  }, [game, reload])

  /**
   * Move a card from player's hand to a zone.
   * Local simulation: pull card out of hand, place in zone, decrement actions.
   */
  const playCard = useCallback(async (cardIndex, zoneIndex, actionCost = 1) => {
    if (!game?.players) return { error: 'Игра не загружена' }
    const me = game.players.find((p) => p.player_id === game.current_player_id)
    if (!me) return { error: 'Сейчас не ваш ход' }

    const hand = [...(me.hand || [])]
    if (cardIndex < 0 || cardIndex >= hand.length) return { error: 'Неверный индекс карты' }
    const card = hand[cardIndex]
    if (card.cost > actionCost) return { error: 'Карта дороже доступного действия' }

    const newLog = [
      ...(game.game_state?.log || []),
      { timestamp: Date.now(), message: `${me.nickname || 'Игрок'} сыграл ${card.name} в зону ${zoneIndex + 1}` },
    ]

    hand.splice(cardIndex, 1)
    const zones = clampZones(me.zones)
    zones[zoneIndex] = [...(zones[zoneIndex] || []), { ...card, id: card.id || `card-${Date.now()}`, tapped: false, flipped: false }]

    // Refill: добираем из deck_pile пока рука < STARTING_HAND_SIZE
    const deckPile = Array.isArray(me.deck_pile) ? [...me.deck_pile] : []
    while (hand.length < STARTING_HAND_SIZE && deckPile.length > 0) {
      hand.push(deckPile.pop())
    }
    const newDeckRemaining = deckPile.length

    // Persist hand + deck_pile + deck_remaining + zones
    await supabase
      .from('game_players')
      .update({
        hand,
        deck_pile: deckPile,
        deck_remaining: newDeckRemaining,
      })
      .eq('game_id', game.id)
      .eq('player_id', me.player_id)

    await supabase
      .from('game_zones')
      .update({ cards: zones[zoneIndex] })
      .eq('game_id', game.id)
      .eq('player_id', me.player_id)
      .eq('zone_position', zoneIndex + 1)

    return writeGameState({ game_state: { log: newLog } })
  }, [game, writeGameState])

  /**
   * Attack from a card in one zone to opponent's zone.
   */
  const attack = useCallback(async (fromZone, cardId, toOpponentZone) => {
    if (!game?.players) return { error: 'Игра не загружена' }
    const me = game.players.find((p) => p.player_id === game.current_player_id)
    if (!me) return { error: 'Сейчас не ваш ход' }
    const opponent = game.players.find((p) => p.player_id !== me.player_id)
    if (!opponent) return { error: 'Противник не найден' }

    const myZones = clampZones(me.zones)
    const card = (myZones[fromZone] || []).find((c) => c.id === cardId)
    if (!card) return { error: 'Карта не найдена' }
    if (card.tapped) return { error: 'Карта уже использовалась' }

    const oppZones = clampZones(opponent.zones)
    const defenders = oppZones[toOpponentZone] || []
    const damage = card.attack || 0
    const totalDefense = defenders.reduce((sum, c) => sum + (c.health || 0), 0)

    let newOppHealth = opponent.health
    let newOppZones = { ...oppZones }
    if (damage > totalDefense) {
      const excess = damage - totalDefense
      newOppHealth = opponent.health - excess
    }
    const surviving = defenders
      .map((c) => ({ ...c, health: (c.health || 0) - damage }))
      .filter((c) => c.health > 0)
    newOppZones[toOpponentZone] = surviving

    // Mark attacking card tapped
    myZones[fromZone] = myZones[fromZone].map((c) =>
      c.id === cardId ? { ...c, tapped: true } : c
    )

    const newLog = [
      ...(game.game_state?.log || []),
      {
        timestamp: Date.now(),
        message: `${me.nickname || 'Игрок'} атаковал ${card.name} (${damage} урона). Защита: ${totalDefense}`,
      },
    ]

    // Determine winner
    let patch = { game_state: { log: newLog } }
    if (newOppHealth <= 0) {
      patch.status = 'finished'
      patch.winner_id = me.player_id
      patch.ended_at = new Date().toISOString()
    }

    // Persist: my zones (tapped), opponent health, opponent zones
    await supabase
      .from('game_zones')
      .update({ cards: myZones[fromZone] })
      .eq('game_id', game.id)
      .eq('player_id', me.player_id)
      .eq('zone_position', fromZone + 1)

    await supabase
      .from('game_players')
      .update({ health: newOppHealth })
      .eq('game_id', game.id)
      .eq('player_id', opponent.player_id)

    await supabase
      .from('game_zones')
      .update({ cards: newOppZones[toOpponentZone] })
      .eq('game_id', game.id)
      .eq('player_id', opponent.player_id)
      .eq('zone_position', toOpponentZone + 1)

    return writeGameState(patch)
  }, [game, writeGameState])

  /**
   * End turn: switch to next player.
   * Computes simple alternation: player1 -> player2 -> player1.
   * Draw-фаза: новый активный добирает 1 карту из своего deck_pile в hand.
   */
  const endTurn = useCallback(async () => {
    if (!game?.players) return { error: 'Игра не загружена' }
    const players = game.players
    const currentIdx = players.findIndex((p) => p.player_id === game.current_player_id)
    if (currentIdx === -1) return { error: 'Активный игрок не найден' }
    const nextPlayer = players[(currentIdx + 1) % players.length]

    // Draw-фаза: добрать 1 карту из deck_pile нового активного
    const nextDeckPile = Array.isArray(nextPlayer.deck_pile) ? [...nextPlayer.deck_pile] : []
    const nextHand = Array.isArray(nextPlayer.hand) ? [...nextPlayer.hand] : []
    const drewCard = nextDeckPile.length > 0
    if (drewCard) {
      nextHand.push(nextDeckPile.pop())
    }
    const nextDeckRemaining = nextDeckPile.length

    const newLog = [
      ...(game.game_state?.log || []),
      {
        timestamp: Date.now(),
        message: drewCard
          ? `Ход переходит к ${nextPlayer.nickname || 'следующему'} · добрал 1 карту`
          : `Ход переходит к ${nextPlayer.nickname || 'следующему'} · колода пуста`,
      },
    ]

    // Сохранить изменения руки нового активного игрока
    if (drewCard) {
      await supabase
        .from('game_players')
        .update({
          hand: nextHand,
          deck_pile: nextDeckPile,
          deck_remaining: nextDeckRemaining,
        })
        .eq('game_id', game.id)
        .eq('player_id', nextPlayer.player_id)
    }

    return writeGameState({
      current_player_id: nextPlayer.player_id,
      current_turn: (game.current_turn || 0) + 1,
      game_state: { log: newLog },
    })
  }, [game, writeGameState])

  return { playCard, attack, endTurn, isApplying, error }
}
