export function exportCatalogJson(cards) {
  return JSON.stringify(cards, null, 2)
}

export function exportCatalogCsv(cards) {
  const headers = [
    'id',
    'card_number',
    'name',
    'card_type',
    'cost',
    'attack',
    'health',
    'land_type',
    'rarity',
    'hero',
    'source',
    'has_flip',
    'is_rainbow',
    'image_url',
    'description',
  ]
  const escape = (v) => {
    const s = v == null ? '' : String(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const rows = cards.map((c) => headers.map((h) => escape(c[h])).join(','))
  return [headers.join(','), ...rows].join('\n')
}

export function parseCatalogImport(text) {
  const trimmed = text.trim()
  if (!trimmed) return { cards: [], error: 'Пустой файл' }
  try {
    const data = JSON.parse(trimmed)
    if (Array.isArray(data)) return { cards: data }
    if (Array.isArray(data.cards)) return { cards: data.cards }
    return { cards: [], error: 'JSON должен быть массивом карт' }
  } catch {
    return { cards: [], error: 'Неверный JSON' }
  }
}

export function downloadTextFile(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
