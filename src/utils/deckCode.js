const CODE_LENGTH = 6

export function generateDeckCode(selectedCards = {}, selectedLands = {}) {
  const serializeEntries = (entries) =>
    Object.entries(entries)
      .filter(([, quantity]) => Number(quantity) > 0)
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([id, quantity]) => `${id}:${quantity}`)
      .join(',')

  const payload = `${serializeEntries(selectedCards)}|${serializeEntries(selectedLands)}`

  if (!payload || payload === '|') {
    return 'DK-000000'
  }

  let hash = 0
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 31 + payload.charCodeAt(i)) >>> 0
  }

  return `DK-${hash.toString(36).toUpperCase().padStart(CODE_LENGTH, '0').slice(-CODE_LENGTH)}`
}
