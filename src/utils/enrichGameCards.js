/**
 * Подмешивает данные каталога (name, image_url, cost…) в runtime-копии карт в игре.
 * Runtime-поля (instanceId, tapped, flipped, health после боя) сохраняются поверх каталога.
 */

import { getCardType } from './cardFields.ts'

function catalogKey(id) {
  return String(id ?? '').trim().toLowerCase()
}

function pickId(card) {
  if (card == null) return null
  if (typeof card === 'string') return card
  if (typeof card === 'object') return card.id || card.card_id || null
  return null
}

function needsEnrichment(card) {
  if (!card || typeof card !== 'object') return Boolean(pickId(card))
  const id = pickId(card)
  if (!id) return false
  return !card.name || !card.image_url
}

export function buildCardCatalog(cards = []) {
  const map = new Map()
  for (const card of cards) {
    const key = catalogKey(card?.id)
    if (key) map.set(key, card)
  }
  return map
}

export function collectCardIdsFromGame(game) {
  const ids = new Set()
  const add = (card) => {
    const id = pickId(card)
    if (id) ids.add(String(id))
  }

  for (const player of game?.players || []) {
    for (const card of player.hand || []) add(card)
    for (const card of player.deck_pile || []) add(card)
    for (const card of player.discard_pile || []) add(card)
    for (const zone of player.zones || []) {
      for (const card of zone.cards || []) add(card)
    }
  }

  return [...ids]
}

export function collectMissingCardIds(game, catalog) {
  const missing = new Set()
  const seen = new Set() // Защита от дубликатов в разных массивах

  const consider = (card) => {
    const id = pickId(card)
    if (!id) return
    const key = catalogKey(id)
    if (seen.has(key)) return
    seen.add(key)

    const catalogCard = catalog.get(key)
    if (!catalogCard || needsEnrichment(catalogCard)) {
      missing.add(String(id))
    }
    if (needsEnrichment(card)) missing.add(String(id))
  }

  // Один проход по всем картам — без вложенных циклов по зонам
  for (const player of game?.players || []) {
    for (const card of player.hand || []) consider(card)
    for (const card of player.deck_pile || []) consider(card)
    for (const card of player.discard_pile || []) consider(card)
    for (const zone of player.zones || []) {
      for (const card of zone.cards || []) consider(card)
    }
  }

  return [...missing]
}

export function enrichCard(card, catalog) {
  if (card == null) return card
  if (typeof card === 'string') {
    const db = catalog.get(catalogKey(card))
    return db ? { ...db, instanceId: card } : { id: card }
  }
  if (typeof card !== 'object') return card

  const key = catalogKey(card.id || card.card_id)
  if (!key) return card
  const db = catalog.get(key)
  if (!db) return card

  return {
    ...db,
    ...card,
    id: card.id || db.id,
    image_url: card.image_url || db.image_url || null,
    name: card.name || db.name,
    description: card.description || db.description,
    cost: card.cost ?? db.cost,
    attack: card.attack ?? db.attack,
    health: card.health ?? db.health,
    card_type: getCardType({ ...db, ...card }),
    land_type: card.land_type || db.land_type,
    flip_description: card.flip_description || db.flip_description,
  }
}

export function enrichCardArray(cards, catalog) {
  if (!Array.isArray(cards)) return cards
  return cards.map((c) => enrichCard(c, catalog))
}

export function enrichGamePlayers(players, catalog) {
  if (!Array.isArray(players)) return players
  return players.map((p) => ({
    ...p,
    hand: enrichCardArray(p.hand, catalog),
    deck_pile: enrichCardArray(p.deck_pile, catalog),
    discard_pile: enrichCardArray(p.discard_pile, catalog),
    zones: Array.isArray(p.zones)
      ? p.zones.map((z) => ({
          ...z,
          cards: enrichCardArray(z.cards, catalog),
        }))
      : p.zones,
  }))
}

export function enrichGameState(game, catalog) {
  if (!game) return game
  return {
    ...game,
    players: enrichGamePlayers(game.players, catalog),
  }
}

export function resolveCardImageUrl(card) {
  const url = card?.image_url
  if (typeof url === 'string' && url.trim() && !/^null$/i.test(url.trim())) {
    return url.trim()
  }
  return null
}

/** Обогащает карты зоны для локального optimistic UI. */
export function enrichZoneCardsForSync(cards, catalog) {
  if (!Array.isArray(cards) || !catalog?.size) return cards
  return cards.map((card) => enrichCard(card, catalog))
}
