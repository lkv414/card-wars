/**
 * gameStatePatch.js — локальные (оптимистичные) патчи игрового состояния.
 *
 * Живой остался один патч — `applyPlayCardPatch`: он сразу убирает карту из
 * руки и кладёт её на землю после play_card, не дожидаясь полного перезапроса
 * состояния. Прочие патчи (flip/attack/draw/end_turn) удалены: после перехода
 * на WS-авторитет движок присылает актуальное состояние сам.
 */
import { normalizePlayerZoneRows, normalizeZoneCards } from '../hooks/game/format.js'
import { enrichCard } from './enrichGameCards.js'

export function applyPlayCardPatch(game, playerId, cardIndex, zoneIndex, slotType, rpcData = {}, catalog) {
  if (!game?.players) return game

  const newVersion = rpcData.version ?? (game.version ?? 0) + 1
  const actionsRemaining =
    rpcData.actions_remaining ??
    Math.max(
      0,
      (game.players.find((p) => p.player_id === playerId)?.actions_remaining ??
        game.actions_remaining ??
        2) - (rpcData.action_cost ?? 1)
    )

  // Дедупликация helper: убираем дубли по instanceId/id
  const dedup = (cards) => {
    if (!Array.isArray(cards)) return cards
    const seen = new Set()
    const out = []
    for (const c of cards) {
      if (!c) continue
      const id = c.instanceId || c.id
      if (id && seen.has(id)) continue
      if (id) seen.add(id)
      out.push(c)
    }
    return out
  }

  return {
    ...game,
    version: newVersion,
    actions_remaining:
      game.current_player_id === playerId ? actionsRemaining : game.actions_remaining,
    players: game.players.map((player) => {
      if (player.player_id !== playerId) return player

      const rawCard = rpcData.card
      const hand = [...(player.hand || [])]
      const hasVisibleHand = hand.length > 0
      let cardSource = rawCard

      if (hasVisibleHand && cardIndex >= 0 && cardIndex < hand.length) {
        cardSource = cardSource || hand[cardIndex]
        hand.splice(cardIndex, 1)
      } else if (!cardSource) {
        return player
      }

      const placed = (catalog && catalog.size ? enrichCard : (c) => c)(
        {
          ...cardSource,
          tapped: false,
          flipped: false,
          slot_type: slotType,
          zone_position: zoneIndex + 1,
        },
        catalog
      )

      const zoneRows = normalizePlayerZoneRows(player.zones)
      const row = zoneRows[zoneIndex] || { zone_position: zoneIndex + 1, cards: [] }
      const existingCards = normalizeZoneCards(row)
      const placedId = placed.instanceId || placed.id
      const zoneHasSameCard = placedId
        ? existingCards.some((c) => (c.instanceId || c.id) === placedId)
        : false
      const newZoneCards = zoneHasSameCard ? existingCards : [...existingCards, placed]
      zoneRows[zoneIndex] = { ...row, cards: newZoneCards }

      // Dedup hand + убираем placed из руки (если он остался по ошибке)
      const newHand = placedId
        ? dedup(hand).filter((c) => (c.instanceId || c.id) !== placedId)
        : dedup(hand)

      return {
        ...player,
        hand: hasVisibleHand ? newHand : player.hand,
        hand_count: rpcData.hand_count ?? player.hand_count,
        zones: zoneRows,
        actions_remaining: actionsRemaining,
      }
    }),
  }
}