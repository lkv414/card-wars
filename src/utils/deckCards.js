/**
 * deckCards.js — какие карты можно класть в колоду.
 *
 * Партнёрские карты (`card_type === 'special'`, 2v2) остаются в каталоге и
 * показываются в коллекции, но в колоду не добавляются: режим партнёрства
 * ещё не реализован, а такие карты в обычной партии нерабочие (движок
 * знает только creature/building/spell). Фильтрация здесь — один источник
 * истины: редактор, импорт кода колоды и воркер используют эту же функцию.
 *
 * См. docs/CATALOG_REVIEW.md, §3 R4 и решение пользователя (отфильтровать).
 */
export const DECK_CARD_TYPES = Object.freeze(['creature', 'building', 'spell'])

export function isDeckCard(card) {
  return Boolean(card) && DECK_CARD_TYPES.includes(card.card_type)
}

export function filterDeckCards(cards) {
  return (cards || []).filter(isDeckCard)
}

export function isSpecialCard(card) {
  return Boolean(card) && card.card_type === 'special'
}
