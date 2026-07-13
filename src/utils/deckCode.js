const CODE_PREFIX = 'DK-'
const CODE_VERSION = 2
const EMPTY_CODE = `${CODE_PREFIX}000000`

const UUID_REGEX = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i

const encodeBase64Url = (bytes) => {
  let binary = ''
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

const decodeBase64Url = (value) => {
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) {
    throw new Error('Empty deck code payload')
  }

  let base64 = normalizedValue.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) base64 += '='
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

const normalizeEntries = (entries) => {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return {}
  }

  return Object.entries(entries)
    .filter(([, qty]) => Number(qty) > 0)
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .reduce((acc, [id, qty]) => {
      if (!UUID_REGEX.test(id)) {
        throw new Error('Идентификатор карты должен быть UUID')
      }

      const quantity = Number(qty)
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 255) {
        throw new Error('Количество карты должно быть от 1 до 255')
      }

      acc[id] = quantity
      return acc
    }, {})
}

const encodePayload = (selectedCards, selectedLands) => {
  const payload = {
    version: CODE_VERSION,
    cards: normalizeEntries(selectedCards),
    lands: normalizeEntries(selectedLands)
  }

  const json = JSON.stringify(payload)
  return encodeBase64Url(new TextEncoder().encode(json))
}

const decodePayload = (value) => {
  const bytes = decodeBase64Url(value)
  const json = new TextDecoder().decode(bytes)
  return JSON.parse(json)
}

const decodeLegacyDeckCode = (code) => {
  const bytesToUuid = (bytes) => {
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  try {
    const payload = code.trim()
    const bytes = decodeBase64Url(payload.replace(/^DK-/i, ''))
    if (bytes.length < 3 || bytes[0] !== 1) {
      return null
    }

    let offset = 1
    const parseEntries = () => {
      if (offset >= bytes.length) return null
      const entries = {}
      const count = bytes[offset]
      offset += 1

      for (let i = 0; i < count; i += 1) {
        if (offset + 17 > bytes.length) return null
        const id = bytesToUuid(bytes.slice(offset, offset + 16))
        offset += 16
        const qty = bytes[offset]
        offset += 1
        entries[id] = qty
      }

      return entries
    }

    const selectedCards = parseEntries()
    if (!selectedCards) return null

    const selectedLands = parseEntries()
    if (!selectedLands) return null

    if (offset !== bytes.length) return null

    return { selectedCards, selectedLands }
  } catch (error) {
    console.error('Ошибка декодирования старого кода колоды:', error)
    return null
  }
}

export function generateDeckCode(selectedCards = {}, selectedLands = {}) {
  const cards = selectedCards && typeof selectedCards === 'object' ? selectedCards : {}
  const lands = selectedLands && typeof selectedLands === 'object' ? selectedLands : {}

  const normalizedCards = normalizeEntries(cards)
  const normalizedLands = normalizeEntries(lands)
  if (Object.keys(normalizedCards).length === 0 && Object.keys(normalizedLands).length === 0) {
    return EMPTY_CODE
  }

  return `${CODE_PREFIX}${encodePayload(normalizedCards, normalizedLands)}`
}

export function decodeDeckCode(code) {
  if (!code || typeof code !== 'string') return null

  const trimmed = code.trim()
  if (trimmed.toUpperCase() === EMPTY_CODE) {
    return { selectedCards: {}, selectedLands: {} }
  }

  let payload = trimmed
  if (payload.toUpperCase().startsWith(CODE_PREFIX)) {
    payload = payload.slice(CODE_PREFIX.length)
  }

  payload = payload.trim()

  if (!payload) return null

  try {
    const parsed = decodePayload(payload)
    if (parsed && typeof parsed === 'object' && parsed.version === CODE_VERSION) {
      return {
        selectedCards: normalizeEntries(parsed.cards || {}),
        selectedLands: normalizeEntries(parsed.lands || {})
      }
    }
  } catch (error) {
    console.error('Ошибка декодирования кода колоды:', error)
  }

  return decodeLegacyDeckCode(trimmed)
}

/**
 * Расширяет deckCode полными данными карт из БД
 * @param {string} deckCode - Короткий код колоды (DK-xxx...)
 * @param {Object} supabaseClient - Supabase клиент
 * @returns {Promise<{selectedCards: Object, selectedLands: Object, cards: Array, lands: Array}>}
 *   selectedCards/Lands: { uuid: quantity }
 *   cards/lands: полные объекты карт с полем quantity
 */
export async function expandDeckCodeWithCardData(deckCode, supabaseClient) {
  const decoded = decodeDeckCode(deckCode)
  if (!decoded) throw new Error('Invalid deck code')

  const { selectedCards = {}, selectedLands = {} } = decoded

  const cardUuids = Object.keys(selectedCards)
  const landUuids = Object.keys(selectedLands)

  if (cardUuids.length === 0 && landUuids.length === 0) {
    // Пустая колода
    return { selectedCards: {}, selectedLands: {}, cards: [], lands: [] }
  }

  // Загружаем карточки и земли раздельно, т.к. они лежат в разных таблицах
  const [{ data: dbCards, error: cardsError }, { data: dbLands, error: landsError }] = await Promise.all([
    cardUuids.length
      ? supabaseClient.from('cards').select('*').in('id', cardUuids)
      : Promise.resolve({ data: [], error: null }),
    landUuids.length
      ? supabaseClient.from('lands').select('*').in('id', landUuids)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (cardsError) throw new Error(`Database error: ${cardsError.message}`)
  if (landsError) throw new Error(`Database error: ${landsError.message}`)

  // Создаём map с нормализацией UUID (нижний регистр для поиска)
  const cardsMap = new Map((dbCards || []).map((c) => [c.id.toLowerCase(), c]))
  const landsMap = new Map((dbLands || []).map((l) => [l.id.toLowerCase(), l]))

  // Нормализуем UUID в selectedCards/Lands для правильного поиска
  const normalizedSelectedCards = {}
  const normalizedSelectedLands = {}

  for (const [uuid, qty] of Object.entries(selectedCards)) {
    const lowerUuid = uuid.toLowerCase()
    const card = cardsMap.get(lowerUuid)
    if (card) {
      normalizedSelectedCards[card.id] = Number(qty)
    } else {
      // Если карта не найдена, сохраняем оригинальный UUID
      normalizedSelectedCards[uuid] = Number(qty)
    }
  }

  for (const [uuid, qty] of Object.entries(selectedLands)) {
    const lowerUuid = uuid.toLowerCase()
    const land = landsMap.get(lowerUuid)
    if (land) {
      normalizedSelectedLands[land.id] = Number(qty)
    } else {
      // Если карта не найдена, сохраняем оригинальный UUID
      normalizedSelectedLands[uuid] = Number(qty)
    }
  }

  // Собираем выбранные карты с количеством
  const fullCards = Object.entries(normalizedSelectedCards).map(([uuid, qty]) => {
    const card = cardsMap.get(uuid.toLowerCase())
    if (!card) return { id: uuid, quantity: Number(qty) }
    return { ...card, quantity: Number(qty) }
  })

  const fullLands = Object.entries(normalizedSelectedLands).map(([uuid, qty]) => {
    const land = landsMap.get(uuid.toLowerCase())
    if (!land) return { id: uuid, quantity: Number(qty) }
    return { ...land, quantity: Number(qty) }
  })

  return {
    selectedCards: normalizedSelectedCards,
    selectedLands: normalizedSelectedLands,
    cards: fullCards,
    lands: fullLands
  }
}
