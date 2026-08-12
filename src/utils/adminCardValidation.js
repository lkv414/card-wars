import { CARD_TYPES, LAND_TYPES } from '../constants/game.js'
import { DEFAULT_FILTERS, filterCards, hasActiveFilters, sortCards } from './cardSort.js'

const VALID_TYPES = Object.keys(CARD_TYPES)
const VALID_LANDS = Object.keys(LAND_TYPES)

export const DEFAULT_ADMIN_FILTERS = {
  ...DEFAULT_FILTERS,
  anomaliesOnly: false,
  missingImage: false,
  missingDescription: false,
  issueSeverity: 'all',
}

export function hasActiveAdminFilters(filters) {
  if (!filters) return false
  return (
    hasActiveFilters(filters) ||
    filters.anomaliesOnly ||
    filters.missingImage ||
    filters.missingDescription ||
    (filters.issueSeverity && filters.issueSeverity !== 'all')
  )
}

/**
 * @returns {{ code: string, label: string, severity: 'error' | 'warning' }[]}
 */
export function getCardAnomalies(card, allCards = []) {
  const issues = []
  const add = (code, label, severity = 'warning') => issues.push({ code, label, severity })

  if (!String(card.name || '').trim()) add('no_name', 'Нет названия', 'error')

  const num = card.card_number
  if (num == null || num === '' || Number.isNaN(Number(num))) {
    add('bad_number', 'Некорректный №', 'error')
  }

  if (!VALID_TYPES.includes(card.card_type)) add('bad_type', 'Неизвестный тип', 'error')

  const cost = Number(card.cost)
  if (Number.isNaN(cost) || cost < 0 || cost > 9) add('bad_cost', 'Стоимость вне 0–9', 'warning')

  if (card.card_type === 'creature') {
    if (card.attack == null || card.health == null) add('creature_stats', 'Нет ATK/HP', 'error')
    else {
      if (Number(card.attack) < 0) add('bad_attack', 'ATK < 0', 'error')
      if (Number(card.health) <= 0) add('bad_health', 'HP ≤ 0', 'warning')
    }
  }

  if (card.card_type === 'building' || card.card_type === 'spell') {
    if (card.attack != null && card.attack !== '') add('extra_attack', 'Лишний ATK', 'warning')
    if (card.health != null && card.health !== '') add('extra_health', 'Лишний HP', 'warning')
  }

  if (card.has_flip && !String(card.flip_description || '').trim()) {
    add('flip_no_desc', 'Флип без текста', 'warning')
  }
  if (!card.has_flip && String(card.flip_description || '').trim()) {
    add('desc_no_flip', 'Текст флипа без флага', 'warning')
  }

  if (!String(card.image_url || '').trim()) add('no_image', 'Нет art', 'warning')
  if (!String(card.description || '').trim()) add('no_desc', 'Нет описания', 'warning')

  if (card.land_type && !VALID_LANDS.includes(card.land_type)) {
    add('bad_land', 'Неизвестная земля', 'error')
  }
  if (card.is_rainbow && card.land_type !== 'any') {
    add('rainbow_mismatch', 'Радужная ≠ any', 'warning')
  }

  if (card.mechanics != null && !Array.isArray(card.mechanics)) {
    add('bad_mechanics', 'mechanics не JSON-массив', 'error')
  }

  if (num != null && num !== '' && !Number.isNaN(Number(num)) && allCards.length > 1) {
    const n = Number(num)
    const dupes = allCards.filter((c) => c.id !== card.id && Number(c.card_number) === n)
    if (dupes.length > 0) add('dup_number', `Дубль №${n}`, 'error')
  }

  return issues
}

export function getIssueSeverity(issues) {
  if (!issues?.length) return null
  if (issues.some((i) => i.severity === 'error')) return 'error'
  return 'warning'
}

/** @returns {Map<string, ReturnType<getCardAnomalies>>} */
export function buildAnomalyMap(cards) {
  const map = new Map()
  for (const card of cards) {
    map.set(card.id, getCardAnomalies(card, cards))
  }
  return map
}

export function countAnomalies(anomalyMap) {
  let errors = 0
  let warnings = 0
  let clean = 0
  for (const issues of anomalyMap.values()) {
    const sev = getIssueSeverity(issues)
    if (sev === 'error') errors += 1
    else if (sev === 'warning') warnings += 1
    else clean += 1
  }
  return { errors, warnings, clean, total: anomalyMap.size }
}

export function filterAdminCards(cards, filters, anomalyMap) {
  let list = filterCards(cards, filters)

  if (filters.anomaliesOnly) {
    list = list.filter((c) => (anomalyMap.get(c.id)?.length || 0) > 0)
  }
  if (filters.missingImage) {
    list = list.filter((c) => !String(c.image_url || '').trim())
  }
  if (filters.missingDescription) {
    list = list.filter((c) => !String(c.description || '').trim())
  }
  if (filters.issueSeverity === 'error') {
    list = list.filter((c) => getIssueSeverity(anomalyMap.get(c.id)) === 'error')
  } else if (filters.issueSeverity === 'warning') {
    list = list.filter((c) => {
      const sev = getIssueSeverity(anomalyMap.get(c.id))
      return sev === 'warning' || sev === 'error'
    })
  }

  return sortCards(list, filters.sort || 'number')
}
