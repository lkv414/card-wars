/**
 * cardFaceModel — нормализованное «лицо карты» для всех рендеров.
 *
 * Аудит §2.2-2.3: колода, админка, рука, превью и 3D-стол читали поля карты
 * каждый по-своему и показывали разное. Здесь — единственная сборка значений,
 * а рендеры (DOM и 3D) получают только её.
 *
 * Никаких DOM/three/Supabase: чистая функция + мемоизация по ссылке на карту.
 */
import {
  getCardAttack,
  getCardCost,
  getCardFlipInfo,
  getCardHealth,
  getCardImageUrl,
  getCardLandType,
  getCardType,
  getEffectiveAttack,
  getEffectiveHealth,
  hasUnknownLandType,
} from './cardFields.ts'
import { CARD_TYPES } from '../constants/game.js'
import { getLandDef } from '../constants/landColors.js'

/**
 * Эмодзи-индикаторы. Раньше они были продублированы в 4 JSX-файлах.
 * @type {Readonly<{cost: string, attack: string, health: string}>}
 */
export const STAT_ICONS = Object.freeze({
  cost: '💧',
  attack: '⚔️',
  health: '❤️',
})

/**
 * @typedef {object} CardFace
 * @property {string|null} id
 * @property {string|null} instanceId
 * @property {string} name
 * @property {string} description
 * @property {string|null} imageUrl
 * @property {number} cost
 * @property {number|null} attack          базовый, как в каталоге
 * @property {number|null} health          базовое, как в каталоге
 * @property {number} effectiveAttack      с учётом attack_bonus
 * @property {number} effectiveHealth      с учётом health_bonus
 * @property {boolean} buffed              механика изменила стат
 * @property {string|null} type
 * @property {string} typeLabel
 * @property {boolean} showStats           только у существ
 * @property {string|null} landType
 * @property {string} landLabel
 * @property {string} landIcon
 * @property {string} landShortLabel
 * @property {string} landBadge
 * @property {string} landCssBorder
 * @property {boolean} landUnknown         тип земли не в справочнике
 * @property {boolean} isRainbow
 * @property {boolean} hasFlip
 * @property {string} flipDescription
 * @property {boolean} isFlipped
 * @property {string|null} rarity
 * @property {string|null} hero
 * @property {string|null} source
 * @property {number|null} cardNumber
 */

/** @returns {string|null} */
function str(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * Собирает нормализованное лицо карты. Никогда не бросает: неизвестные
 * значения (в т.ч. отсутствующие) деградируют в null/0.
 */
export function resolveCardFace(card) {
  if (!card || typeof card !== 'object') return null

  const type = getCardType(card)
  const isRainbow = card.is_rainbow === true
  const landType = getCardLandType(card)
  const landDef = getLandDef(landType)
  const flip = getCardFlipInfo(card)
  const attack = getCardAttack(card)
  const health = getCardHealth(card)
  const effectiveAttack = getEffectiveAttack(card)
  const effectiveHealth = getEffectiveHealth(card)

  return {
    id: str(card.id) ?? str(card.instanceId) ?? null,
    instanceId: str(card.instanceId),
    name: str(card.name) ?? '',
    description: typeof card.description === 'string' ? card.description : '',
    imageUrl: getCardImageUrl(card),

    cost: getCardCost(card),
    attack,
    health,
    effectiveAttack,
    effectiveHealth,
    buffed:
      (attack !== null && effectiveAttack !== attack) ||
      (health !== null && effectiveHealth !== health),

    type,
    typeLabel: (type && CARD_TYPES[type]) || type || '',
    showStats: type === 'creature',

    landType,
    landLabel: landDef.label,
    landIcon: landDef.icon,
    landShortLabel: landDef.shortLabel,
    landBadge: landDef.badge,
    landCssBorder: landDef.cssBorder,
    landUnknown: hasUnknownLandType(card),

    isRainbow,
    hasFlip: flip.hasFlip,
    flipDescription: flip.description,
    isFlipped: flip.isFlipped,

    rarity: str(card.rarity),
    hero: str(card.hero),
    source: str(card.source),

    cardNumber: Number.isFinite(Number(card.card_number)) ? Number(card.card_number) : null,
  }
}