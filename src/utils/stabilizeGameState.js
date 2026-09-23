/**
 * Preserve object references for unchanged players/zones/cards when applying
 * a new authoritative snapshot — reduces 3D scene remounts and texture reloads.
 */

function cardKey(card) {
  if (card == null) return ''
  if (typeof card === 'string') return card
  return String(card.instanceId ?? card.id ?? '')
}

function cardsEquivalent(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ca = a[i]
    const cb = b[i]
    if (cardKey(ca) !== cardKey(cb)) return false
    if (typeof ca === 'object' && typeof cb === 'object' && ca && cb) {
      if (Boolean(ca.tapped) !== Boolean(cb.tapped)) return false
      if (Boolean(ca.flipped) !== Boolean(cb.flipped)) return false
      if ((ca.health ?? null) !== (cb.health ?? null)) return false
      if ((ca.status ?? null) !== (cb.status ?? null)) return false
    }
  }
  return true
}

function zonesEquivalent(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const za = a[i]
    const zb = b[i]
    if ((za?.zone_position ?? i + 1) !== (zb?.zone_position ?? i + 1)) return false
    if ((za?.land_id ?? null) !== (zb?.land_id ?? null)) return false
    if ((za?.land_type ?? null) !== (zb?.land_type ?? null)) return false
    if (!cardsEquivalent(za?.cards, zb?.cards)) return false
  }
  return true
}

function playerRuntimeEquivalent(prev, next) {
  return (
    cardsEquivalent(prev?.hand, next?.hand) &&
    cardsEquivalent(prev?.deck_pile, next?.deck_pile) &&
    cardsEquivalent(prev?.discard_pile, next?.discard_pile) &&
    zonesEquivalent(prev?.zones, next?.zones) &&
    (prev?.actions_remaining ?? null) === (next?.actions_remaining ?? null) &&
    (prev?.health ?? null) === (next?.health ?? null) &&
    Boolean(prev?.free_draw_used) === Boolean(next?.free_draw_used) &&
    Boolean(prev?.paid_draw_used) === Boolean(next?.paid_draw_used)
  )
}

function stabilizeZones(prevZones, nextZones) {
  if (!Array.isArray(nextZones)) return nextZones
  if (zonesEquivalent(prevZones, nextZones)) return prevZones

  let changed = false
  const out = new Array(nextZones.length)
  for (let zi = 0; zi < nextZones.length; zi++) {
    const nz = nextZones[zi]
    const pz = prevZones?.[zi]
    if (!pz) {
      out[zi] = nz
      changed = true
      continue
    }
    if (
      (pz.zone_position ?? zi + 1) === (nz.zone_position ?? zi + 1) &&
      (pz.land_id ?? null) === (nz.land_id ?? null) &&
      cardsEquivalent(pz.cards, nz.cards)
    ) {
      out[zi] = pz
    } else {
      out[zi] = nz
      changed = true
    }
  }

  // Если все зоны идентичны по ссылке — вернуть prev ссылку целиком
  if (!changed && prevZones) {
    let same = true
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== prevZones[i]) {
        same = false
        break
      }
    }
    if (same) return prevZones
  }

  return changed ? out : nextZones
}

function stabilizePlayer(prev, next) {
  if (!prev) return next
  if (playerRuntimeEquivalent(prev, next)) {
    return prev
  }

  const hand = cardsEquivalent(prev.hand, next.hand) ? prev.hand : next.hand
  const deck_pile = cardsEquivalent(prev.deck_pile, next.deck_pile)
    ? prev.deck_pile
    : next.deck_pile
  const discard_pile = cardsEquivalent(prev.discard_pile, next.discard_pile)
    ? prev.discard_pile
    : next.discard_pile
  const zones = stabilizeZones(prev.zones, next.zones)

  // Если ничего не изменилось на уровне ссылок — вернуть prev целиком
  if (
    hand === prev.hand &&
    deck_pile === prev.deck_pile &&
    discard_pile === prev.discard_pile &&
    zones === prev.zones
  ) {
    return prev
  }

  return { ...next, hand, deck_pile, discard_pile, zones }
}

/**
 * Дедупликация карт по instanceId || id.
 * Защита от "карт-призраков": когда WS-push и локальный optimistic reload
 * временно дают два вхождения одной карты в hand/deck/discard.
 *
 * Возвращает prev ссылку если дубликатов не было — это критично для
 * React reconciliation (не размонтирует mesh-объекты на поле).
 */
export function dedupCardsById(cards) {
  if (!Array.isArray(cards)) return cards
  const seen = new Set()
  const out = []
  let hasDup = false
  let hasInvalid = false
  for (const c of cards) {
    if (c == null || typeof c !== 'object') {
      // null/undefined/non-object — отбрасываем (защитный слой)
      hasInvalid = true
      continue
    }
    const id = c.instanceId ?? c.id
    if (id && seen.has(id)) {
      hasDup = true
      continue
    }
    if (id != null) seen.add(id)
    out.push(c)
  }
  return hasDup || hasInvalid ? out : cards
}

/**
 * Стабилизировать массив players: вернуть prev ссылку если каждый
 * player идентичен по ссылке или по структуре. Иначе — новый массив
 * с стабилизированными player'ами.
 */
function stabilizePlayers(prevPlayers, nextPlayers) {
  if (!Array.isArray(nextPlayers)) return nextPlayers
  if (prevPlayers === nextPlayers) return prevPlayers

  const prevById = new Map((prevPlayers || []).map((p) => [p?.player_id, p]))
  let changed = false
  const out = new Array(nextPlayers.length)

  for (let i = 0; i < nextPlayers.length; i++) {
    const np = nextPlayers[i]
    const pp = prevById.get(np?.player_id)
    const stabilized = stabilizePlayer(pp, np)
    // Сравниваем с pp (а не np): если stabilized === pp, ничего не изменилось
    if (stabilized !== pp) changed = true
    out[i] = stabilized
  }

  // Если ничего не изменилось (все элементы идентичны pp) — вернуть prev ссылку
  if (!changed && prevPlayers && prevPlayers.length === out.length) {
    let same = true
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== prevPlayers[i]) {
        same = false
        break
      }
    }
    if (same) return prevPlayers
  }

  return changed ? out : nextPlayers
}

function topLevelEquivalent(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
  for (const key of keys) {
    if (a?.[key] !== b?.[key]) return false
  }
  return true
}

/** @param {object | null | undefined} prev @param {object | null | undefined} next */
export function stabilizeGameState(prev, next) {
  if (!next) return next
  if (!prev || prev.id !== next.id) return next

  const nextVersion = next.version ?? 0
  const prevVersion = prev.version ?? 0
  if (nextVersion < prevVersion) return prev

  const prevPlayers = prev.players || []
  const players = stabilizePlayers(prevPlayers, next.players)

  if (nextVersion === prevVersion && players === prevPlayers && topLevelEquivalent(prev, next)) {
    return prev
  }

  // Always keep the authoritative top-level payload. Only nested players/zones
  // may reuse previous references for 3D reconciliation; stale optimistic
  // state must never hide status, turn, winner, or game_state changes.
  return { ...next, players }
}
