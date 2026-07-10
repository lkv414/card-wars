export function hexNoDash(uuid) {
  return String(uuid || '').replace(/-/g, '').toLowerCase()
}

function hexDistance(a, b) {
  if (!a || !b) return Infinity
  if (a.length !== b.length) return Infinity
  let diff = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
  return diff
}

// Find the closest candidate UUID (by hex string) and return {id, distance}
export function findClosestUuid(targetUuid, candidates = []) {
  const target = hexNoDash(targetUuid)
  let best = null
  let bestDist = Infinity
  for (const c of candidates) {
    const h = hexNoDash(c)
    const d = hexDistance(target, h)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return { id: best, distance: bestDist }
}
