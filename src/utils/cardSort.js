import { CARD_TYPES } from '../constants/game.js'

const TYPE_ORDER = Object.keys(CARD_TYPES)

export function sortCards(cards, sort = 'number') {
  const list = [...cards]
  switch (sort) {
    case 'cost':
      return list.sort(
        (a, b) => Number(a.cost) - Number(b.cost) || Number(a.card_number) - Number(b.card_number)
      )
    case 'name':
      return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'))
    case 'type':
      return list.sort((a, b) => {
        const ai = TYPE_ORDER.indexOf(a.card_type)
        const bi = TYPE_ORDER.indexOf(b.card_type)
        const aRank = ai === -1 ? 99 : ai
        const bRank = bi === -1 ? 99 : bi
        return aRank - bRank || Number(a.card_number) - Number(b.card_number)
      })
    case 'number':
    default:
      return list.sort((a, b) => Number(a.card_number) - Number(b.card_number))
  }
}

export function groupCardsByType(cards) {
  const groups = [
    { key: 'creature', label: 'Существа', items: [] },
    { key: 'building', label: 'Строения', items: [] },
    { key: 'spell', label: 'Заклинания', items: [] },
    { key: 'other', label: 'Прочее', items: [] },
  ]

  for (const card of cards) {
    const group = groups.find((g) => g.key === card.card_type) || groups[3]
    group.items.push(card)
  }

  return groups.filter((g) => g.items.length > 0)
}

export function groupCardsByCost(cards) {
  const map = new Map()
  for (const card of cards) {
    const cost = Number(card.cost) || 0
    const key = cost >= 6 ? '6+' : String(cost)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(card)
  }

  const order = ['0', '1', '2', '3', '4', '5', '6+']
  return order
    .filter((k) => map.has(k))
    .map((k) => ({
      key: k,
      label: k === '6+' ? 'Стоимость 6+' : `Стоимость ${k}`,
      items: map.get(k),
    }))
}

/** Фильтр стоимости: tier 0|1|2 или 3 (= 3+) */
export function matchesCostTier(cardCost, tier) {
  if (tier == null) return true
  const cost = Number(cardCost) || 0
  if (tier === 3) return cost >= 3
  return cost === tier
}

function matchesSearch(card, query) {
  if (!query) return true
  const haystack = `${card.name} ${card.description}`.toLowerCase()
  return haystack.includes(query.toLowerCase())
}

export function filterCards(cards, filters) {
  const next = cards.filter(
    (card) =>
      matchesSearch(card, filters.search) &&
      (!filters.cardTypes.length || filters.cardTypes.includes(card.card_type)) &&
      (!filters.landTypes.length || filters.landTypes.includes(card.land_type)) &&
      matchesCostTier(card.cost, filters.costTier) &&
      (!filters.flipOnly || card.has_flip)
  )
  return sortCards(next, filters.sort || 'number')
}

export function filterLands(lands, search) {
  if (!search) return lands
  const q = search.toLowerCase()
  return lands.filter((land) => String(land.name || '').toLowerCase().includes(q))
}

export const DEFAULT_FILTERS = {
  search: '',
  cardTypes: [],
  landTypes: [],
  costTier: null,
  flipOnly: false,
  sort: 'number',
}

export function hasActiveFilters(filters) {
  if (!filters) return false
  return Boolean(
    filters.search?.trim() ||
    filters.cardTypes?.length > 0 ||
    filters.landTypes?.length > 0 ||
    filters.costTier != null ||
    filters.flipOnly
  )
}
