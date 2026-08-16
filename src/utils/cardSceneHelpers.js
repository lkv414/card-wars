/**
 * cardSceneHelpers — pure functions для 3D-слоя игрового поля.
 *
 * По паттерну testing_3d: единый источник правды для типов объектов сцены.
 * Не содержит React-кода, не импортирует доменные helpers — только конфигурация.
 */

export const CARD_OBJECT_TYPES = Object.freeze({
  CREATURE: 'creature',
  BUILDING: 'building',
  SPELL: 'spell',
  HAND: 'hand',
  FACE_DOWN: 'face_down',
})

export const LAND_OBJECT_TYPES = Object.freeze({
  CORN: 'corn',
  ICE: 'ice',
  GOOD: 'good',
  SWAMP: 'swamp',
  SAND: 'sand',
  BLUE: 'blue',
  ANY: 'any',
})

/** Геометрия карты на поле (в мировых координатах). */
export const CARD_GEOMETRY = Object.freeze({
  WIDTH: 0.7,
  HEIGHT: 1.0,
})

/** Геометрия земли (одна зона). */
export const LAND_GEOMETRY = Object.freeze({
  WIDTH: 1.55,
  DEPTH: 2.4,
})

/** Цвета для каждого типа земли — единая палитра. */
export const LAND_COLORS = Object.freeze({
  corn: '#f4d03f',
  ice: '#aed6f1',
  good: '#f5b7b1',
  swamp: '#7d6608',
  sand: '#d4ac6e',
  blue: '#3498db',
  any: '#bbbbbb',
})

/** Цвет подсветки выбранного объекта — единый для всего проекта. */
export const SELECTION_COLOR = '#fbbf24'

/** Цвет подсветки attack-target зоны. */
export const ATTACK_TARGET_COLOR = '#ff5252'

/** Цвет creature-слота (можно играть существо). */
export const CREATURE_SLOT_COLOR = '#3b82f6'

/** Цвет building-слота (можно играть строение). */
export const BUILDING_SLOT_COLOR = '#a855f7'

/**
 * Возвращает CSS-цвет для типа земли.
 * @param {string|null|undefined} landType
 * @returns {string}
 */
export function getLandColor(landType) {
  if (!landType) return LAND_COLORS.any
  return LAND_COLORS[landType] ?? LAND_COLORS.any
}

/**
 * Возвращает тип карты как объект сцены.
 * @param {object|null|undefined} card
 * @returns {string} один из CARD_OBJECT_TYPES
 */
export function getCardObjectType(card) {
  if (!card) return CARD_OBJECT_TYPES.FACE_DOWN
  if (card.card_type === 'creature') return CARD_OBJECT_TYPES.CREATURE
  if (card.card_type === 'building') return CARD_OBJECT_TYPES.BUILDING
  if (card.card_type === 'spell') return CARD_OBJECT_TYPES.SPELL
  return CARD_OBJECT_TYPES.HAND
}
