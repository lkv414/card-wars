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
  return nextZones.map((nz, zi) => {
    const pz = prevZones?.[zi]
    if (!pz) return nz
    if (
      (pz.zone_position ?? zi + 1) === (nz.zone_position ?? zi + 1) &&
      (pz.land_id ?? null) === (nz.land_id ?? null) &&
      cardsEquivalent(pz.cards, nz.cards)
    ) {
      return pz
    }
    return nz
  })
}

function stabilizePlayer(prev, next) {
  if (!prev) return next
  if (playerRuntimeEquivalent(prev, next)) {
    return {
      ...next,
      hand: prev.hand,
      deck_pile: prev.deck_pile,
      discard_pile: prev.discard_pile,
      zones: prev.zones,
    }
  }

  return {
    ...next,
    hand: cardsEquivalent(prev.hand, next.hand) ? prev.hand : next.hand,
    deck_pile: cardsEquivalent(prev.deck_pile, next.deck_pile) ? prev.deck_pile : next.deck_pile,
    discard_pile: cardsEquivalent(prev.discard_pile, next.discard_pile)
      ? prev.discard_pile
      : next.discard_pile,
    zones: stabilizeZones(prev.zones, next.zones),
  }
}

/** @param {object | null | undefined} prev @param {object | null | undefined} next */
export function stabilizeGameState(prev, next) {
  if (!next) return next
  if (!prev || prev.id !== next.id) return next

  const nextVersion = next.version ?? 0
  const prevVersion = prev.version ?? 0
  if (nextVersion <= prevVersion) return prev

  const prevById = new Map((prev.players || []).map((p) => [p.player_id, p]))
  const players = (next.players || []).map((np) => stabilizePlayer(prevById.get(np.player_id), np))

  return { ...next, players }
}
