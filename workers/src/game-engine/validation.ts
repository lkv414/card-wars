/**
 * validation.ts — pure pre-flight checks for actions.
 *
 * Returns `{ ok: true }` or `{ ok: false, error: string }`. The engine
 * (`engine.applyAction`) calls `validateAction` first and short-circuits
 * to a worker-side error if validation fails — this keeps `apply*` pure
 * and surfaces the same error message to the client that the legacy
 * SQL RPCs used to.
 */

import type { Action, Card, GameState, PlayerState } from './types'
import { getActivePlayer, getAlivePlayers, getPlayer, getZone } from './utils'
import { canPlayerDealDamage, pickBattleTarget } from './combat'
import { effectiveAttackForCombat } from './mechanics-runtime'

const ZONE_LIMIT = 10

export type ValidationResult = { ok: true } | { ok: false; error: string }

function ok(): ValidationResult {
  return { ok: true }
}
function fail(msg: string): ValidationResult {
  return { ok: false, error: msg }
}

function getCardCost(state: GameState, card: Card): number {
  const cat = state.catalog?.[card.id]
  const base = cat?.cost ?? (typeof card.cost === 'number' ? card.cost : 1)
  const me = getActivePlayer(state)
  const reduced = Math.max(0, base - Number(me?.cost_reduction ?? 0))
  return me?.free_play_next ? 0 : reduced
}

export function validateAction(state: GameState, action: Action, actorId: string): ValidationResult {
  // Universal guards.
  if (state.status === 'finished') return fail('Игра уже завершена')
  if (state.status === 'abandoned') return fail('Игра прервана')

  // confirm_land_setup is the only action valid in setup phase.
  if (state.status === 'setup' && action.type !== 'confirm_land_setup') {
    return fail('Сейчас фаза подтверждения земель')
  }

  // Player-scoped guards (current player).
  const isCurrentTurn = state.current_player_id === actorId
  const me = isCurrentTurn ? getActivePlayer(state) : getPlayer(state, actorId)

  switch (action.type) {
    case 'play_card': {
      if (!isCurrentTurn) return fail('Сейчас не ваш ход')
      if (!me) return fail('Сейчас не ваш ход')
      const card = me.hand[action.cardIndex]
      if (!card) return fail('Неверный индекс карты')
      if (action.slotType) {
        const expected = state.catalog?.[card.id]?.card_type === 'building' || card.card_type === 'building' ? 'building' : 'creature'
        if (action.slotType !== expected) return fail('Недопустимый тип слота для этой карты')
      }
      if (action.zonePosition < 1 || action.zonePosition > 4) return fail('Неверная позиция зоны (1-4)')
      const zone = getZone(me, action.zonePosition)
      if (!zone) return fail('Зона не найдена')
      if (zone.cards.length >= ZONE_LIMIT) return fail('Земля полная')
      if ((me.actions_remaining ?? 0) < getCardCost(state, card)) return fail('Недостаточно действий')
      return ok()
    }
    case 'use_ability': {
      if (!isCurrentTurn) return fail('Сейчас не ваш ход')
      if (!me) return fail('Сейчас не ваш ход')
      const zone = getZone(me, action.zonePosition)
      if (!zone) return fail('Зона не найдена')
      const card = zone.cards.find((c) => (c.instanceId ?? c.id) === action.cardId || c.id === action.cardId)
      if (!card) return fail('Карта не найдена в зоне')
      if (action.mechanicIndex < 0) return fail('Неверный индекс механики')
      return ok()
    }
    case 'draw_free': {
      if (!isCurrentTurn) return fail('Сейчас не ваш ход')
      if (!me) return fail('Сейчас не ваш ход')
      if (me.free_draw_used) return fail('Бесплатный добор уже использован')
      if (me.deck_pile.length === 0 && me.discard_pile.length === 0) {
        return fail('Колода и сброс пусты')
      }
      return ok()
    }
    case 'draw_paid': {
      if (!isCurrentTurn) return fail('Сейчас не ваш ход')
      if (!me) return fail('Сейчас не ваш ход')
      if (me.paid_draw_used) return fail('Платный добор уже использован')
      if ((me.actions_remaining ?? 0) < 1) return fail('Нет доступных действий')
      if (me.deck_pile.length === 0 && me.discard_pile.length === 0) {
        return fail('Колода и сброс пусты')
      }
      return ok()
    }
    case 'shuffle_deck': {
      if (!isCurrentTurn) return fail('Сейчас не ваш ход')
      return ok()
    }
    case 'discard_from_hand': {
      if (!isCurrentTurn) return fail('Сейчас не ваш ход')
      if (!me) return fail('Сейчас не ваш ход')
      if (!me.hand[action.cardIndex]) return fail('Неверный индекс карты')
      return ok()
    }
    case 'discard_from_zone': {
      if (!isCurrentTurn) return fail('Сейчас не ваш ход')
      if (!me) return fail('Сейчас не ваш ход')
      const zone = getZone(me, action.zonePosition)
      if (!zone) return fail('Зона не найдена')
      const found = zone.cards.some((c) => c.instanceId === action.cardId || c.id === action.cardId)
      if (!found) return fail('Карта не найдена в зоне')
      return ok()
    }
    case 'flip_card': {
      if (!isCurrentTurn) return fail('Сейчас не ваш ход')
      if (!me) return fail('Сейчас не ваш ход')
      const zone = getZone(me, action.zonePosition)
      if (!zone) return fail('Зона не найдена')
      const found = zone.cards.some((c) => c.instanceId === action.cardId || c.id === action.cardId)
      if (!found) return fail('Карта не найдена в зоне')
      return ok()
    }
    case 'attack': {
      if (!isCurrentTurn) return fail('Сейчас не ваш ход')
      if (!me) return fail('Сейчас не ваш ход')
      const opponent = getPlayer(state, action.toPlayerId)
      if (!opponent) return fail('Целевой игрок не найден')
      if (opponent.player_id === me.player_id) return fail('Нельзя атаковать себя')
      if ((opponent.health ?? 0) <= 0) return fail('Целевой игрок уже побеждён')

      const aliveCount = getAlivePlayers(state).length
      if (!canPlayerDealDamage(me.player_order, aliveCount, state.current_turn ?? 0)) {
        return fail('Урон ещё недоступен (первый ход)')
      }
      const legalTarget = pickBattleTarget(me.player_id, action.fromZone, getAlivePlayers(state))
      if (!legalTarget || legalTarget.defenderId !== action.toPlayerId || legalTarget.toZone !== action.toZone) {
        return fail('Недопустимая цель атаки для этой линии')
      }

      const myZone = getZone(me, action.fromZone)
      if (!myZone) return fail('Зона не найдена')
      const attacker = myZone.cards.find((c) => c.instanceId === action.attackerCardId || c.id === action.attackerCardId)
      if (!attacker) return fail('Карта не найдена в зоне')
      if (attacker.tapped) return fail('Существо уже атаковало в этом ходу')
      if (attacker.flipped || attacker.isFlipped) return fail('Перевёрнутое существо не может атаковать')
      if (effectiveAttackForCombat(attacker) <= 0) return fail('Эта карта не может атаковать')
      return ok()
    }
    case 'end_turn': {
      if (!isCurrentTurn) return fail('Сейчас не ваш ход')
      if (!me) return fail('Сейчас не ваш ход')
      return ok()
    }
    case 'forfeit': {
      if (!me) return fail('Игрок не найден')
      return ok()
    }
    case 'reorder_lands': {
      if (!me) return fail('Игрок не найден')
      return ok()
    }
    case 'confirm_land_setup': {
      if (!me) return fail('Игрок не найден')
      // All players must have at least one bound land unless bypass=true.
      if (!action.bypass) {
        const allReady = state.players.every((p) => p.zones.some((z) => z.land_id))
        if (!allReady) return fail('Не у всех игроков выбраны земли')
      }
      return ok()
    }
    default: {
      const exhaustive: never = action
      void exhaustive
      return fail('Неизвестное действие')
    }
  }
}