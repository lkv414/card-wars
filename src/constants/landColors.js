/**
 * landColors.js — ЕДИНСТВЕННЫЙ источник по типам земель.
 *
 * До аудита типы земель были описаны в трёх несогласованных местах:
 *   1. constants/game.js      LAND_TYPES          — {shortLabel, label, icon}
 *   2. constants/landColors   LAND_TYPE_COLORS    — {fill, emissive, label}
 *                             LAND_CARD_BORDER    — hex для CSS-рамки
 *   3. utils/cardCompositeTexture  LAND_TYPE_LABELS — 'CR/IC/GD/SW/SN/BL/*'
 * Плюс четвёртое — TypeScript-контракт в workers/game-engine/types.ts.
 *
 * Теперь всё это здесь, в одном объекте на тип. Остальные модули только читают.
 */

/** Канонические типы земель (совпадают с CHECK-констрейнтом public.lands.land_type). */
export const LAND_DEFS = Object.freeze({
  corn: Object.freeze({
    id: 'corn',
    fill: '#7cb342',
    emissive: '#558b2f',
    cssBorder: '#7cb342',
    label: 'Кукурузные поля',
    shortLabel: 'Кукуруза',
    icon: '🌽',
    badge: 'CR',
  }),
  ice: Object.freeze({
    id: 'ice',
    fill: '#81d4fa',
    emissive: '#0288d1',
    cssBorder: '#29b6f6',
    label: 'Ледяная земля',
    shortLabel: 'Ледяная',
    icon: '❄️',
    badge: 'IC',
  }),
  good: Object.freeze({
    id: 'good',
    fill: '#f48fb1',
    emissive: '#c2185b',
    cssBorder: '#f06292',
    label: 'Добрая земля',
    shortLabel: 'Добрая',
    icon: '🌸',
    badge: 'GD',
  }),
  swamp: Object.freeze({
    id: 'swamp',
    fill: '#546e7a',
    emissive: '#37474f',
    cssBorder: '#78909c',
    label: 'Бесполезное болото',
    shortLabel: 'Болото',
    icon: '🌿',
    badge: 'SW',
  }),
  sand: Object.freeze({
    id: 'sand',
    fill: '#ffcc80',
    emissive: '#ef6c00',
    cssBorder: '#ffb74d',
    label: 'Пустынная земля',
    shortLabel: 'Пустынная',
    icon: '🏜️',
    badge: 'SN',
  }),
  blue: Object.freeze({
    id: 'blue',
    fill: '#42a5f5',
    emissive: '#1565c0',
    cssBorder: '#42a5f5',
    label: 'Синяя равнина',
    shortLabel: 'Синяя',
    icon: '🔵',
    badge: 'BL',
  }),
  any: Object.freeze({
    id: 'any',
    fill: '#ce93d8',
    emissive: '#7b1fa2',
    cssBorder: '#ba68c8',
    label: 'Любая земля',
    shortLabel: 'Радужные',
    icon: '🌈',
    badge: '*',
  }),
})

export const LAND_TYPES = Object.freeze(
  Object.fromEntries(
    Object.values(LAND_DEFS).map((d) => [
      d.id,
      { shortLabel: d.shortLabel, label: d.label, icon: d.icon },
    ]),
  ),
)

/** Канонические id — для валидации и сортировки. */
export const LAND_TYPE_IDS = Object.freeze(Object.keys(LAND_DEFS))

/**
 * Псевдонимы типов земель, встречающиеся в каталоге, но не являющиеся
 * каноническими. Возникли из-за неполной нормализации при импорте
 * (individual_cards/cards.json).
 *
 * ВАЖНО: сюда попадают ТОЛЬКО однозначные синонимы. Неоднозначные
 * ('cute', 'cotton', 'plain', 'plains') намеренно НЕ отображены: подставлять
 * догадку — значит менять правила по землям. Такие карты попадают в
 * `unmappedLandTypes` для разбора данных и трактуются как универсальные
 * (см. resolveLandType), чтобы карта не была неигровой.
 */
export const LAND_TYPE_ALIASES = Object.freeze({
  sandy: 'sand',
  desert: 'sand',
  // `rainbow` — служебное значение каталога; канонический эквивалент — 'any'.
  // Реальные радужные карты приходят с is_rainbow=true и нормализуются отдельно.
  rainbow: 'any',
})

/** Значение для типа земли, которого нет в справочнике. */
export const FALLBACK_LAND_ID = 'any'

/**
 * Приводит произвольный `land_type` к каноническому id.
 *
 * @param {unknown} raw значение из карты/зоны/земли
 * @returns {string|null} канонический id, либо null если тип неизвестен
 */
export function resolveLandType(raw) {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  if (!key) return null
  if (Object.prototype.hasOwnProperty.call(LAND_DEFS, key)) return key
  if (Object.prototype.hasOwnProperty.call(LAND_TYPE_ALIASES, key)) {
    return LAND_TYPE_ALIASES[key]
  }
  return null
}

/** true, если значение не удалось отобразить в канонический тип. */
export function isUnknownLandType(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return false
  return resolveLandType(raw) === null
}

/** Список всех неотображённых типов в наборе карт — для админки и тестов. */
export function unmappedLandTypes(cards) {
  const out = new Set()
  for (const card of cards || []) {
    const raw = card?.land_type
    if (typeof raw === 'string' && raw.trim() && isUnknownLandType(raw)) out.add(raw)
  }
  return [...out].sort()
}

// ── Обратная совместимость: прежние имена экспортов ──────────────────────────

export const LAND_BORDER_COLOR = '#e67e22'
export const GRID_NEON_CYAN = '#00e8ff'
export const PLAY_MAT_COLOR = '#4caf50'
export const CREATURE_SLOT_COLOR = '#e53935'
export const BUILDING_SLOT_COLOR = '#43a047'
export const DEFAULT_LAND_FILL = '#5d4e37'

export function getLandDef(landType) {
  return LAND_DEFS[resolveLandType(landType)] ?? LAND_DEFS[FALLBACK_LAND_ID]
}

/** Палитра для 3D-материала земли. */
export function getLandPalette(landType) {
  const def = getLandDef(landType)
  return { fill: def.fill, emissive: def.emissive, label: def.label, shortLabel: def.shortLabel, icon: def.icon }
}

/** CSS-цвет рамки карты по типу земли. */
export function getLandCardBorder(landType) {
  return getLandDef(landType).cssBorder
}