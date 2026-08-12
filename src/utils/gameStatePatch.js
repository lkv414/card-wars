import { normalizePlayerZoneRows, normalizeZoneCards } from '../hooks/game/format'
import { getCardType } from './cardFields.ts'
import { enrichCard } from './enrichGameCards'

function zoneIndex(raw) {
  const z = Number(raw ?? 0)
  return z >= 1 && z <= 4 ? z - 1 : z
}

function cardKey(card) {
  return card?.id || card?.instanceId
}

function isFieldCreature(card) {
  const type = getCardType(card)
  return type !== 'building' && type !== 'spell'
}

function findAttackerCreature(cards) {
  for (const card of normalizeZoneCards(cards)) {
    if (!isFieldCreature(card)) continue
    if (card.tapped || card.flipped || card.isFlipped) continue
    if (Number(card.attack ?? 0) <= 0) continue
    return card
  }
  return null
}

function findFirstCreature(cards) {
  for (const card of normalizeZoneCards(cards)) {
    if (isFieldCreature(card)) return card
  }
  return null
}

function updateZoneRow(row, updater) {
  const cards = normalizeZoneCards(row)
  const nextCards = updater(cards)
  if (nextCards === cards) return row
  return { ...row, cards: nextCards }
}

function applyAttackerZoneRow(row, event) {
  return updateZoneRow(row, (cards) => {
    const attacker = findAttackerCreature(cards)
    if (!attacker) return cards
    const key = cardKey(attacker)

    if (event.attacker_killed) {
      return cards.filter((c) => cardKey(c) !== key)
    }

    const next = { ...attacker, tapped: true }
    if (event.attacker_damaged) {
      const hp = Number(attacker.health ?? attacker.defense ?? 0)
      next.health = Math.max(0, hp - Number(event.counter_damage ?? 0))
    }

    return cards.map((c) => (cardKey(c) === key ? next : c))
  })
}

function applyDefenderZoneRow(row, event) {
  if (Number(event.face_damage ?? 0) > 0) return row

  return updateZoneRow(row, (cards) => {
    const creature = findFirstCreature(cards)
    if (!creature) return cards
    const key = cardKey(creature)

    if (event.creature_killed) {
      return cards.filter((c) => cardKey(c) !== key)
    }

    if (event.creature_damaged) {
      const hp = Number(creature.health ?? creature.defense ?? 0)
      const dmg = Number(event.damage ?? 0)
      return cards.map((c) =>
        cardKey(c) === key ? { ...c, health: Math.max(0, hp - dmg) } : c
      )
    }

    return cards
  })
}

export function applyBattleEventPatch(game, event) {
  if (!game?.players || event?.skipped) return game

  const fromPlayerId = event.from_player_id
  const toPlayerId = event.to_player_id
  const fromZone = zoneIndex(event.from_zone)
  const toZone = zoneIndex(event.to_zone)
  const face = Number(event.face_damage ?? 0)

  return {
    ...game,
    players: game.players.map((player) => {
      if (player.player_id !== fromPlayerId && player.player_id !== toPlayerId) {
        return player
      }

      let next = { ...player }

      if (player.player_id === toPlayerId && face > 0) {
        next.health = Math.max(0, (next.health ?? 25) - face)
      }

      const zoneRows = normalizePlayerZoneRows(next.zones)

      if (player.player_id === fromPlayerId && zoneRows[fromZone]) {
        zoneRows[fromZone] = applyAttackerZoneRow(zoneRows[fromZone], event)
      }

      if (player.player_id === toPlayerId && zoneRows[toZone]) {
        zoneRows[toZone] = applyDefenderZoneRow(zoneRows[toZone], event)
      }

      next.zones = zoneRows
      return next
    }),
  }
}

export function applyBattleEventsPatch(game, battleEvents = []) {
  if (!Array.isArray(battleEvents) || battleEvents.length === 0) return game
  return battleEvents.reduce((state, event) => applyBattleEventPatch(state, event), game)
}

function untapPlayerZones(zones) {
  return normalizePlayerZoneRows(zones).map((row) => ({
    ...row,
    cards: normalizeZoneCards(row).map((card) => ({ ...card, tapped: false })),
  }))
}

/**
 * Локально применяет результат end_turn — бой, смена игрока, сброс флагов добора.
 */
export function applyEndTurnPatch(game, rpcData = {}) {
  if (!game?.players) return game

  let next = applyBattleEventsPatch(game, rpcData.battle_events || rpcData.battleEvents || [])
  const newVersion = rpcData.version ?? (game.version ?? 0) + 1

  if (rpcData.game_finished) {
    return {
      ...next,
      version: newVersion,
      status: 'finished',
      winner_id: rpcData.winner_id ?? null,
    }
  }

  const nextPlayerId = rpcData.next_player_id
  if (!nextPlayerId) return { ...next, version: newVersion }

  const logMessage = rpcData.log_message
  const prevLog = next.game_state?.log || []

  return {
    ...next,
    version: newVersion,
    current_turn: (game.current_turn ?? 0) + 1,
    current_player_id: nextPlayerId,
    actions_remaining: rpcData.actions_remaining ?? 2,
    game_state: {
      ...(next.game_state || {}),
      turnPhase: 'main',
      log: logMessage
        ? [...prevLog, { timestamp: Date.now(), message: logMessage }]
        : prevLog,
    },
    players: next.players.map((player) => {
      if (player.player_id !== nextPlayerId) return player
      return {
        ...player,
        actions_remaining: rpcData.actions_remaining ?? 2,
        free_draw_used: false,
        paid_draw_used: false,
        zones: untapPlayerZones(player.zones),
      }
    }),
  }
}

export function applyFlipCardPatch(game, playerId, zoneIndex, cardId) {
  if (!game?.players) return game

  return {
    ...game,
    players: game.players.map((player) => {
      if (player.player_id !== playerId) return player
      const zoneRows = normalizePlayerZoneRows(player.zones)
      const row = zoneRows[zoneIndex]
      if (!row) return player

      zoneRows[zoneIndex] = {
        ...row,
        cards: normalizeZoneCards(row).map((card) =>
          cardKey(card) === cardId ? { ...card, status: 'flipped', flipped: true } : card
        ),
      }

      return { ...player, zones: zoneRows }
    }),
  }
}

/**
 * Локально применяет результат play_card — сразу убирает карту из руки и кладёт на землю.
 */
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

  return {
    ...game,
    version: newVersion,
    actions_remaining:
      game.current_player_id === playerId ? actionsRemaining : game.actions_remaining,
    players: game.players.map((player) => {
      if (player.player_id !== playerId) return player

      const hand = [...(player.hand || [])]
      if (cardIndex < 0 || cardIndex >= hand.length) return player

      const removed = hand[cardIndex]
      hand.splice(cardIndex, 1)
      const rawCard = rpcData.card || removed
      const placed = catalog
        ? enrichCard(
            {
              ...rawCard,
              tapped: false,
              flipped: false,
              slot_type: slotType,
              zone_position: zoneIndex + 1,
            },
            catalog
          )
        : {
            ...rawCard,
            tapped: false,
            flipped: false,
            slot_type: slotType,
            zone_position: zoneIndex + 1,
          }

      const zoneRows = normalizePlayerZoneRows(player.zones)
      const row = zoneRows[zoneIndex] || { zone_position: zoneIndex + 1, cards: [] }
      const cards = [...normalizeZoneCards(row), placed]
      zoneRows[zoneIndex] = { ...row, cards }

      return {
        ...player,
        hand,
        zones: zoneRows,
        actions_remaining: actionsRemaining,
      }
    }),
  }
}
