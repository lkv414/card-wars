/**
 * usePlayCard — розыгрыш карты из руки в зону.
 *
 * Логика:
 *  1. Берёт карту из hand
 *  2. Кладёт в zone (через RPC play_card, чтобы refill был атомарным и валидированным)
 *  3. Обновляет log через writeGameState
 *
 * Серверная валидация: RPC читает текущий hand/deck_pile из БД (НЕ верит клиенту),
 * проверяет лимит 5 карт в руке, кладёт карту в зону, делает refill.
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId, withGuestId } from '../../utils/guestSession'

export function usePlayCard(game, writeGameState, reload) {
  return useCallback(
    async (cardIndex, zoneIndex, actionCost = 1) => {
      if (!game?.players) return { error: 'Игра не загружена' }
      await ensureGuestId()
      const me = game.players.find((p) => p.player_id === game.current_player_id)
      if (!me) return { error: 'Сейчас не ваш ход' }

      const hand = me.hand || []
      if (cardIndex < 0 || cardIndex >= hand.length) return { error: 'Неверный индекс карты' }
      const card = hand[cardIndex]
      if (card.cost > actionCost) return { error: 'Карта дороже доступного действия' }

      const logEntry = {
        timestamp: Date.now(),
        message: `${me.nickname || 'Игрок'} сыграл ${card.name} в зону ${zoneIndex + 1}`,
      }
      const newLog = [...(game.game_state?.log || []), logEntry]

      try {
        const { data, error: rpcErr } = await supabase.rpc('play_card', {
          p_game_id: game.id,
          p_player_id: me.player_id,
          p_card_index: cardIndex,
          p_zone_position: zoneIndex + 1,
        })
        console.log('[usePlayCard] RPC response:', { data, rpcErr })
        if (!rpcErr && data?.success) {
          // RPC уже обновил hand/zones и bumpнул games.version — пишем log поверх актуальной version
          const logResult = await writeGameState(
            { game_state: { log: newLog } },
            { expectedVersion: data.version, softFail: true },
          )
          if (logResult?.error) {
            console.warn('[usePlayCard] log sync failed after RPC play:', logResult.error)
            if (typeof reload === 'function') await reload()
            return { success: true }
          }
          return { success: true, logResult }
        }
        if (rpcErr) {
          console.warn('[usePlayCard] RPC failed:', rpcErr.message, '— fallback')
          if (!/function .* does not exist/i.test(rpcErr.message || '')) {
            return { error: rpcErr.message }
          }
        } else if (data?.error) {
          return { error: data.error }
        }
      } catch (e) {
        console.warn('[usePlayCard] RPC threw:', e?.message)
      }

      // === Fallback: клиентская логика (3 параллельных UPDATE'а) ===
      console.log('[usePlayCard] Using fallback writeGameState')

      // Импортируем формат-утилиты на лету (используются только в fallback)
      const { clampZones } = await import('./format')
      const { STARTING_HAND_SIZE } = await import('../../constants/game')

      // Безопасная замена splice: создаём НОВЫЙ массив без удалённой карты.
      // Раньше hand.splice(cardIndex, 1) мутировал массив из game.players,
      // что ломало React-оптимизацию (та же ссылка → нет ре-рендера).
      const newHand = hand.filter((_, i) => i !== cardIndex)
      const zones = clampZones(me.zones)
      const instanceId = card.instanceId || card.id || `card-${Date.now()}-${cardIndex}`
      zones[zoneIndex] = [
        ...(zones[zoneIndex] || []),
        { ...card, id: card.id, instanceId, tapped: false, flipped: false },
      ]
      // Refill: добираем максимум до STARTING_HAND_SIZE из deck_pile.
      const deckPile = Array.isArray(me.deck_pile) ? [...me.deck_pile] : []
      while (newHand.length < STARTING_HAND_SIZE && deckPile.length > 0) {
        newHand.push(deckPile.pop())
        if (newHand.length >= STARTING_HAND_SIZE) break
      }
      const newDeckRemaining = deckPile.length

      // withGuestId оборачивает весь блок: перед каждым запросом PostgREST
      // получает свежий app.guest_id (избегаем RLS-гонки из-за пула соединений).
      const [playersRes, zonesRes, gameRes] = await withGuestId(() =>
        Promise.all([
          supabase
            .from('game_players')
            .update({
              hand: newHand,
              deck_pile: deckPile,
              deck_remaining: newDeckRemaining,
            })
            .eq('game_id', game.id)
            .eq('player_id', me.player_id),
          supabase
            .from('game_zones')
            .update({ cards: zones[zoneIndex] })
            .eq('game_id', game.id)
            .eq('player_id', me.player_id)
            .eq('zone_position', zoneIndex + 1),
          writeGameState({ game_state: { log: newLog } }),
        ])
      )

      const err = playersRes.error || zonesRes.error || gameRes?.error
      if (err) {
        return { error: `Розыгрыш не сохранился: ${err.message || err}` }
      }
      return { success: true }
    },
    [game, writeGameState, reload]
  )
}