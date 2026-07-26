export function normalizeReplayLog(log) {
  if (!Array.isArray(log)) return []

  return log
    .filter((entry) => entry && typeof entry.message === 'string')
    .map((entry, index) => ({
      ...entry,
      step: index + 1,
    }))
}

export function getReplayEntry(entries, requestedIndex) {
  if (!Array.isArray(entries) || entries.length === 0) return null

  const numericIndex = Number.isFinite(Number(requestedIndex))
    ? Math.trunc(Number(requestedIndex))
    : 0
  const index = Math.min(Math.max(numericIndex, 0), entries.length - 1)
  return entries[index]
}
