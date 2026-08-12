/**
 * Normalizes card field names across DB catalog shape and in-game runtime shape.
 * DB: card_type, health | Runtime/hand copies may use type, defense.
 */

export type CardLike = {
  card_type?: string | null
  type?: string | null
  health?: number | string | null
  defense?: number | string | null
  attack?: number | string | null
} | null | undefined

export function getCardType(card: CardLike): string | null {
  return card?.card_type || card?.type || null
}

export function getCardHealth(card: CardLike): number | null {
  if (card?.health != null && card.health !== '') return Number(card.health)
  if (card?.defense != null && card.defense !== '') return Number(card.defense)
  return null
}

export function getCardAttack(card: CardLike): number | null {
  if (card?.attack == null || card.attack === '') return null
  return Number(card.attack)
}

export function isCreatureCard(card: CardLike): boolean {
  return getCardType(card) === 'creature'
}

export function isBuildingCard(card: CardLike): boolean {
  return getCardType(card) === 'building'
}

export function isSpellCard(card: CardLike): boolean {
  return getCardType(card) === 'spell'
}

export function getCardCost(card: CardLike & { cost?: number | string | null }): number {
  if (card?.cost == null || card.cost === '') return 1
  const n = Number(card.cost)
  return Number.isFinite(n) ? Math.max(0, n) : 1
}
