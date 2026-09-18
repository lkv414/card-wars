/**
 * resolveCardVisual — мемоизированная версия.
 *
 * Проблема (PERFORMANCE_AUDIT_3D.md, K7, §1.2):
 *   `resolveCardVisual(rawCard, cardCatalog)` в GameBoard3D.jsx создавал новый объект
 *   на каждом рендере (spread), даже когда данные идентичны → memo(GameObject) промахивался.
 *
 * Решение: вернуть ту же ссылку на объект, если визуально ничего не изменилось.
 * Используем двухслойный Map:
 *   - по id карты — последний «обогащённый» объект
 *   - по `(cardCatalog, id)` — кэш «визуал не изменился»
 *
 * Если `cardCatalog` меняется (новый Map), сбрасываем кэш.
 */
const visualCache = new Map()
let lastCatalog = null

function signature(card) {
  return [
    card?.id ?? '',
    card?.image_url ?? '',
    card?.name ?? '',
    card?.land_type ?? '',
    card?.cost ?? '',
    card?.attack ?? '',
    card?.health ?? '',
  ].join('|')
}

export function resetCardVisualCache() {
  visualCache.clear()
  lastCatalog = null
}

/**
 * Обогащает карту визуальными полями из каталога. Возвращает ту же ссылку,
 * если входы не менялись.
 *
 * @param {object|null|undefined} card
 * @param {Map<string,object>|object|null} catalog
 * @returns {object|null|undefined}
 */
export function resolveCardVisual(card, catalog) {
  if (!card) return card
  if (!catalog) return card

  // Каталог сменился — сбрасываем кэш.
  if (catalog !== lastCatalog) {
    visualCache.clear()
    lastCatalog = catalog
  }

  const id = card.id ?? card.instanceId
  if (!id) return card

  const cat = typeof catalog.get === 'function' ? catalog.get(id) : catalog[id]
  if (!cat) return card

  const cached = visualCache.get(id)
  if (cached && cached.__sig === signature(card)) {
    return cached
  }

  const enriched = {
    ...card,
    image_url: card.image_url || cat.image_url,
    name: card.name || cat.name,
    land_type: card.land_type || cat.land_type,
  }
  enriched.__sig = signature(card)
  visualCache.set(id, enriched)
  return enriched
}