/**
 * format.js — утилиты преобразования game state.
 *
 * Раньше жили внутри useGameAction.js. Вынесены, чтобы использовать отдельно,
 * без хуков.
 */

export function clampZones(zones) {
  const out = [[], [], [], []]
  for (let i = 0; i < 4; i++) {
    out[i] = normalizeZoneCards(zones?.[i])
  }
  return out
}

/** Нормализует одну зону: Array<Card> или { cards, land_id, ... } */
export function normalizeZoneCards(zone) {
  if (Array.isArray(zone)) return zone
  if (zone && typeof zone === 'object') return zone.cards || []
  return []
}

/** Метаданные одной зоны (земля + карты). Внутренняя — нужна normalizePlayerZoneRows. */
function normalizeZoneRow(zone, index = 0) {
  if (Array.isArray(zone)) {
    return { zone_position: index + 1, cards: zone, land_id: null, land_type: null, land_name: null }
  }
  if (zone && typeof zone === 'object') {
    return {
      zone_position: zone.zone_position ?? index + 1,
      cards: zone.cards || [],
      land_id: zone.land_id ?? null,
      land_type: zone.land_type ?? null,
      land_name: zone.land_name ?? null,
    }
  }
  return { zone_position: index + 1, cards: [], land_id: null, land_type: null, land_name: null }
}

/** Нормализует все 4 зоны игрока — только массивы карт (legacy). */
export function normalizePlayerZones(zonesRaw) {
  return normalizePlayerZoneRows(zonesRaw).map((row) => normalizeZoneCards(row))
}

/** Полные строки зон с land_id / land_type. */
export function normalizePlayerZoneRows(zonesRaw) {
  if (Array.isArray(zonesRaw)) {
    return [0, 1, 2, 3].map((i) => normalizeZoneRow(zonesRaw[i], i))
  }
  if (zonesRaw && typeof zonesRaw === 'object') {
    return [0, 1, 2, 3].map((i) => normalizeZoneRow(zonesRaw[i], i))
  }
  return [0, 1, 2, 3].map((i) => normalizeZoneRow(null, i))
}