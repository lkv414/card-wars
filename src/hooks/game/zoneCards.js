/** Слоты на земле: одно существо + одно строение. */

import { getCardType, getCardLandType, isLandCompatible } from '../../utils/cardFields.ts'

export const SLOT_CREATURE = 'creature'
export const SLOT_BUILDING = 'building'

export function getCardSlotType(card) {
  if (getCardType(card) === 'building') return SLOT_BUILDING
  return SLOT_CREATURE
}

/** Разделяет карты зоны; в каждом слоте отображается не более одной карты. */
export function splitZoneCards(cards) {
  const list = Array.isArray(cards) ? cards : []
  let creatureCard = null
  let buildingCard = null

  for (const card of list) {
    const type = getCardType(card)
    if (type === 'building') {
      if (!buildingCard) buildingCard = card
    } else if (type !== 'spell' && !creatureCard) {
      creatureCard = card
    }
  }

  return {
    creatureCard,
    buildingCard,
    creatureCards: creatureCard ? [creatureCard] : [],
    buildingCards: buildingCard ? [buildingCard] : [],
  }
}

/** Существо в зоне (строения и заклинания не блокируют). */
export function getZoneCreature(cards) {
  return splitZoneCards(cards).creatureCard
}

export function isSlotEmpty(cards, slotType) {
  const { creatureCard, buildingCard } = splitZoneCards(cards)
  if (slotType === SLOT_BUILDING) return !buildingCard
  return !creatureCard
}

export function canPlayCardToSlot(cards, card, zoneLandType = null) {
  const slot = getCardSlotType(card)
  if (!isSlotEmpty(cards, slot)) return false
  if (slot === SLOT_BUILDING && getCardType(card) !== 'building') return false
  if (slot === SLOT_CREATURE && getCardType(card) === 'building') return false
  // Card Wars rule: карта ложится только на зону с совпадающей землёй
  // (универсальные `any`/rainbow и зоны без земли принимают всё).
  if (getCardType(card) !== 'spell' && !isLandCompatible(getCardLandType(card), zoneLandType)) {
    return false
  }
  return true
}

export function findPlayableZone(cardsByZone, card) {
  if (!Array.isArray(cardsByZone)) return -1
  for (let i = 0; i < cardsByZone.length; i++) {
    const cards = Array.isArray(cardsByZone[i]) ? cardsByZone[i] : cardsByZone[i]?.cards || []
    if (canPlayCardToSlot(cards, card)) return i
  }
  return -1
}
