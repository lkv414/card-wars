/**
 * lobbyDeck — сборка payload колоды для lobby_players.deck
 * и подготовка раздачи карт при старте игры.
 *
 * Формат lobby_players.deck (jsonb):
 * {
 *   code, name,
 *   selectedCards, selectedLands,
 *   cards: [ { id, name, cost, attack, health, ... instanceId } ],  // по 1 объекту на копию
 *   lands: [ { id, name, land_type, ... } ],
 *   cardCount, landCount
 * }
 */
import { STARTING_HAND_SIZE } from '../constants/game'
import { expandDeckCodeWithCardData, generateDeckCode } from './deckCode'

export { STARTING_HAND_SIZE }

/** Собрать экземпляры карт (quantity → N копий) для игры */
export function expandSelectionToInstances(fullCards = []) {
  const instances = []
  for (const card of fullCards) {
    const qty = Math.max(1, Number(card.quantity) || 1)
    const { quantity: _q, created_at: _c, updated_at: _u, ...rest } = card
    for (let i = 0; i < qty; i += 1) {
      instances.push({
        ...rest,
        instanceId: `${rest.id}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        tapped: false,
        flipped: false,
      })
    }
  }
  return instances
}

/** Собрать экземпляры земель (quantity → N копий) */
export function expandLandsToInstances(fullLands = []) {
  const instances = []
  for (const land of fullLands) {
    const qty = Math.max(1, Number(land.quantity) || 1)
    const { quantity: _q, created_at: _c, updated_at: _u, ...rest } = land
    for (let i = 0; i < qty; i += 1) {
      instances.push({ ...rest })
    }
  }
  return instances
}

/**
 * Построить payload для записи в lobby_players.deck
 * из локальной колоды (useDecks) + данные карт из Supabase.
 */
export async function buildLobbyDeckPayload(localDeck, supabaseClient) {
  if (!localDeck) return null

  const selectedCards = localDeck.selectedCards || {}
  const selectedLands = localDeck.selectedLands || {}
  const code =
    localDeck.code || generateDeckCode(selectedCards, selectedLands)

  const cardTotal = Object.values(selectedCards).reduce(
    (s, q) => s + Number(q || 0),
    0
  )
  if (cardTotal === 0) {
    throw new Error('В выбранной колоде нет карт')
  }

  const expanded = await expandDeckCodeWithCardData(code, supabaseClient)
  const cards = expandSelectionToInstances(expanded.cards)
  const lands = expandLandsToInstances(expanded.lands)

  if (cards.length === 0) {
    throw new Error(
      'Не удалось загрузить карты колоды из базы (проверьте код колоды)'
    )
  }

  return {
    code,
    name: localDeck.name?.trim() || 'Колода',
    selectedCards: expanded.selectedCards,
    selectedLands: expanded.selectedLands,
    cards,
    lands,
    cardCount: cards.length,
    landCount: lands.length,
  }
}

export function isLobbyDeckPlayable(deck) {
  return Boolean(deck && Array.isArray(deck.cards) && deck.cards.length > 0)
}

/** Fisher–Yates shuffle (копия) */
export function shuffleDeck(cards) {
  const a = [...(cards || [])]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Раздать стартовую руку из payload колоды лобби.
 * @returns {{ hand: object[], deckRemaining: number, lands: object[] }}
 */
export function dealStartingHand(lobbyDeck, handSize = STARTING_HAND_SIZE) {
  const pool = shuffleDeck(lobbyDeck?.cards || [])
  const n = Math.min(handSize, pool.length)
  const hand = pool.slice(0, n)
  const deckRemaining = pool.length - n
  const lands = Array.isArray(lobbyDeck?.lands) ? lobbyDeck.lands : []
  return { hand, deckRemaining, lands }
}
