/**
 * cardFields — нормализация полей карты по всем форматам данных.
 *
 * Один источник правды для имён полей. В каталоге/БД карта приходит как
 * `{card_type, health, image_url}`, а в игровых копиях встречается
 * `{type, defense, card_url, isFlipped}`. Раньше каждое место рендера читало
 * поля напрямую, из-за чего одна и та же карта выглядела по-разному
 * (аудит §2.2, §7.3).
 *
 * Ничего не знает о DOM, three.js и Supabase — только про объект карты.
 */

import { resolveLandType } from '../constants/landColors.js'

export type CardLike = {
  card_type?: string | null
  type?: string | null
  health?: number | string | null
  defense?: number | string | null
  attack?: number | string | null
  cost?: number | string | null
  land_type?: string | null
  is_rainbow?: boolean | null
  image_url?: string | null
  card_url?: string | null
  name?: string | null
  description?: string | null
  has_flip?: boolean | null
  flip_description?: string | null
  flipped?: boolean | null
  isFlipped?: boolean | null
  /** Модификаторы от механик (`stat_buff` пишет именно их). */
  attack_bonus?: number | string | null
  health_bonus?: number | string | null
  defense_bonus?: number | string | null
  [extra: string]: unknown
} | null | undefined

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// ── Тип карты ────────────────────────────────────────────────────────────────

export function getCardType(card: CardLike): string | null {
  return card?.card_type || card?.type || null
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

// ── Статы ───────────────────────────────────────────────────────────────────

/** Базовое здоровье из карты (`health`, иначе legacy-`defense`). */
export function getCardHealth(card: CardLike): number | null {
  return num(card?.health) ?? num(card?.defense)
}

/** Атака без учёта баффов. */
export function getCardAttack(card: CardLike): number | null {
  return num(card?.attack)
}

/** Атака с учётом `attack_bonus` от механик. Базовое поле не затирается. */
export function getEffectiveAttack(card: CardLike): number {
  return (num(card?.attack) ?? 0) + (num(card?.attack_bonus) ?? 0)
}

/** Здоровье с учётом `health_bonus`. Базовое поле не затирается. */
export function getEffectiveHealth(card: CardLike): number {
  return (num(card?.health) ?? num(card?.defense) ?? 0) + (num(card?.health_bonus) ?? 0)
}

/** Максимальное здоровье — то, во что карта «вылечивается» до предела. */
export function getCardMaxHealth(card: CardLike): number | null {
  const raw = card?.['base_health']
  return num(raw as unknown) ?? getCardHealth(card)
}

export function getCardCost(card: CardLike): number {
  const n = num(card?.cost)
  if (n === null) return 1
  return Math.max(0, n)
}

// ── Арт ─────────────────────────────────────────────────────────────────────

/**
 * URL арта. В каталоге это `image_url`, в игровых копиях встречается
 * `card_url`. Значение 'null' строкой (бывает после импорта) считается пустым.
 */
export function getCardImageUrl(card: CardLike): string | null {
  const raw = card?.image_url || card?.card_url
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^null$/i.test(trimmed)) return null
  return trimmed
}

// ── Земля ───────────────────────────────────────────────────────────────────

/**
 * Канонический тип земли карты.
 *
 * `is_rainbow === true` означает «на любую землю» и нормализуется в 'any' —
 * так же, как это делает Worker (workers/src/game-engine/cards.ts:getCardLandType).
 * Неизвестный тип (в каталоге их 99: cute, plains, cotton, ...) даёт null,
 * и карта трактуется как универсальная — иначе она была бы неигровой
 * (аудит §4.9.1: 80 карт нельзя было положить на землю при строгом правиле).
 */
export function getCardLandType(card: CardLike): string | null {
  if (card?.is_rainbow === true) return 'any'
  const raw = card?.land_type
  if (typeof raw !== 'string' || !raw.trim()) return null
  return resolveLandType(raw)
}

/** true, если land_type карты не отображается в справочник земель. */
export function hasUnknownLandType(card: CardLike): boolean {
  if (card?.is_rainbow === true) return false
  const raw = card?.land_type
  if (typeof raw !== 'string' || !raw.trim()) return false
  return resolveLandType(raw) === null
}

/**
 * Card Wars rule: карта ложится только на зону с совпадающей землёй.
 * `any` (и радужные) карты — универсальные.
 * Зона без земли (land_type === null/'any') принимает всё.
 *
 * Обе стороны нормализуются через resolveLandType, поэтому 'sandy'/'desert'
 * и 'rainbow' сравниваются корректно.
 */
export function isLandCompatible(
  cardLandType: string | null | undefined,
  zoneLandType: string | null | undefined,
): boolean {
  if (!cardLandType || cardLandType === 'any') return true
  if (!zoneLandType || zoneLandType === 'any') return true
  const a = resolveLandType(cardLandType)
  const b = resolveLandType(zoneLandType)
  if (!a || !b) return true
  return a === b
}

// ── Флип ────────────────────────────────────────────────────────────────────

/** Есть ли у карты способность «Флюп» (данные: has_flip / flip_description / flip_ability). */
export function getCardFlipInfo(card: CardLike): {
  hasFlip: boolean
  description: string
  isFlipped: boolean
} {
  const description = typeof card?.flip_description === 'string' ? card.flip_description.trim() : ''
  const fromMechanics = Array.isArray(card?.['mechanics'])
    ? (card['mechanics'] as unknown[]).some((m) => {
        const mech = m as Record<string, unknown>
        if (!mech || typeof mech !== 'object') return false
        if (mech.type === 'flip_ability') return true
        return (
          Array.isArray(mech.actions) &&
          (mech.actions as unknown[]).some(
            (a) => (a as Record<string, unknown>)?.type === 'flip_ability',
          )
        )
      })
    : false

  return {
    hasFlip: card?.has_flip === true || description !== '' || fromMechanics,
    description,
    isFlipped: Boolean(card?.flipped ?? card?.isFlipped),
  }
}

/**
 * Карта лежит лицом вниз.
 * `flipped` — актуальное поле, `isFlipped` — legacy-алиас из старого SQL.
 * Поэтому проверяется ИЛИ, а не `??`: карта может иметь flipped=false
 * и устаревшее isFlipped=true.
 */
export function isFlippedCard(card: CardLike): boolean {
  return Boolean(card?.flipped) || Boolean(card?.isFlipped)
}