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

/** Статус ревью механик: исполняется только 'implemented' (аудит §4.6, M1). */
const EXECUTABLE_MECHANICS_STATUS = 'implemented'

function mechanicsEnabled(card: Card, state: GameState): boolean {
  const cat = state.catalog?.[card.id]
  const status = cat?.mechanics_status ?? (card as Record<string, unknown>).mechanics_status
  return (status ?? 'unreviewed') === EXECUTABLE_MECHANICS_STATUS
}
import { getActivePlayer, getAlivePlayers, getPlayer, getZone } from './utils'
import { canPlayerDealDamage, pickBattleTarget } from './combat'
import {
  effectiveAttackForCombat,
  mechanicsFor,
  unresolvableTargetIds,
} from './mechanics-runtime'

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

/**
 * Проверка земли — зеркало клиентской (src/utils/cardFields.ts:isLandCompatible).
 * Раньше Worker землю не проверял вовсе: клиент мог показать «можно»,
 * а движок принял бы карту куда угодно (аудит §7.1).
 */
function landCompatible(cardLand: string | null, zoneLand: string | null): boolean {
  const ANY = 'any'
  const canon = (raw: string | null): string | null => {
    if (!raw) return null
    const key = raw.trim().toLowerCase()
    return key || null
  }
  if (!cardLand || cardLand === ANY) return true
  if (!zoneLand || zoneLand === ANY) return true
  const a = canon(cardLand)
  const b = canon(zoneLand)
  // Неизвестный тип земли не блокирует игру (аудит §4.9.1). После нормализации
  // каталога (scripts/normalize-land-types.mjs) таких значений быть не должно —
  // их отсутствие проверяет тест src/data/catalog.test.js.
  if (!a || !b) return true
  return a === b
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

      // Слот занят? Проверка зеркалит playCard (cards.ts): без неё
      // validateAction говорит «ок», а движок потом отказывает.
      const catalogType = state.catalog?.[card.id]?.card_type ?? card.card_type
      const isSpell = catalogType === 'spell' || card.card_type === 'spell'
      if (!isSpell) {
        const expectedSlot =
          state.catalog?.[card.id]?.card_type === 'building' || card.card_type === 'building'
            ? 'building'
            : 'creature'
        if (expectedSlot === 'building') {
          if (zone.cards.some((c) => c.card_type !== 'building' && c.card_type !== 'spell')) {
            return fail('Слот строения занят существом')
          }
        } else if (zone.cards.some((c) => c.slot_type === 'creature' || c.card_type === 'building')) {
          return fail('Слот существа занят строением')
        }
      }

      // Правило земель: strict (по умолчанию) требует совпадения.
      if (action.slotType !== 'spell') {
        const rule = (state.game_state?.landPlacementRule as string) || 'strict'
        if (rule === 'strict') {
          const cat = state.catalog?.[card.id]
          const cardLand: string | null = (cat?.is_rainbow === true || card.is_rainbow)
            ? 'any'
            : typeof cat?.land_type === 'string'
              ? cat.land_type
              : typeof card.land_type === 'string' ? card.land_type : null
          if (!landCompatible(cardLand, zone.land_type ?? null)) {
            return fail('Карта не подходит к этой земле')
          }
        }
      }
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

      // Механика должна существовать, быть ручной и принадлежать карте.
      // Раньше индекс просто проверялся на «>= 0», и клиент мог сослаться
      // на любую запись (аудит §4.8, M3).
      const mechanics = mechanicsFor(state, card)
      const mechanic = mechanics[action.mechanicIndex]
      if (!mechanic) return fail('Механика не найдена')
      if (mechanic.trigger !== 'manual') return fail('Эта механика не активируется вручную')

      // Выбранные цели обязаны быть на поле. Без этой проверки клиент мог
      // целиться в любую карту любого игрока (аудит §4.5, M3).
      const requested = action.targetCardIds ?? []
      if (unresolvableTargetIds(state, requested).length) {
        return fail('Выбрана карта, которой нет на поле')
      }
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