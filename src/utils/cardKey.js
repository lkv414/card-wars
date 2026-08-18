/**
 * Stable card key — единая логика ключа для React reconciliation карт на поле.
 *
 * Проблема (RC5 в docs/BUG_RELOAD_DIAGNOSIS.md):
 *   В разных ветках кода (RPC-success, RPC-fallback, WS-push) одна и та же
 *   розыгранная карта может получить разный instanceId (или не получить его
 *   вовсе, если используется только card.id). Это значит, что между
 *   обновлениями состояния React видит разные ключи → unmount старого
 *   <GameObject> + mount нового → меш пересоздаётся, текстура пере-загружается,
 *   поле визуально «перезагружается».
 *
 * Решение по паттерну testing_3d (SceneObject.jsx):
 *   Ключ = `instanceId || id || slot || index`. Один и тот же card object
 *   даёт один и тот же ключ вне зависимости от того, кто его сгенерировал.
 *
 * Если у карты нет ни instanceId, ни id (а такое бывает для placeholder
 * рубашек в спеке), используется slot+index как last-resort стабильный ключ
 * внутри зоны.
 *
 * Использование:
 *   const k = makeCardKey(creatureCard, { slot: 'creature', zoneIndex })
 *   <GameObject key={k} card={creatureCard} ... />
 */

/**
 * @param {object|null|undefined} card
 * @param {{ slot?: string, zoneIndex?: number, fallbackIndex?: number }} [opts]
 * @returns {string}
 */
export function makeCardKey(card, opts = {}) {
  if (!card) {
    const { slot = 'card', zoneIndex = 0, fallbackIndex = 0 } = opts
    return `empty-${slot}-${zoneIndex}-${fallbackIndex}`
  }
  // Приоритет: instanceId (стабильный между RPC/WS/fallback) → id (стабильный
  // каталожный, но может совпадать у разных розыгрышей одной и той же карты) →
  // slot+index (last resort).
  if (card.instanceId) return `card-${card.instanceId}`
  if (card.id) return `card-${card.id}`
  const { slot = 'card', zoneIndex = 0, fallbackIndex = 0 } = opts
  return `card-${slot}-${zoneIndex}-${fallbackIndex}`
}
