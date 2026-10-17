/**
 * deckCode — компактный код колоды (base64url от JSON-полезной нагрузки).
 *
 * Идентификаторы карт — строки каталога (`individual_cards/cards.json`,
 * например `card-костяная-палочка`). Раньше это были UUID из Supabase,
 * поэтому в v1-формате кода встречаются UUID — он остаётся поддержан
 * (`decodeLegacyDeckCode`).
 *
 * Этап 5 плана v2: раскрытие кода в полные данные идёт по локальному
 * каталогу (`src/data/catalog.js`), без запросов в БД.
 */
import { CARDS, LANDS } from '../data/catalog.js'

const CODE_PREFIX = 'DK-'
const CODE_VERSION = 2
const EMPTY_CODE = `${CODE_PREFIX}000000`

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
      if (typeof id !== 'string' || !id.trim()) {
        throw new Error('Идентификатор карты должен быть непустой строкой')
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
 * Раскрывает код колоды в полные данные карт из локального каталога.
 * @param {string} deckCode - Короткий код колоды (DK-xxx...)
 * @returns {{selectedCards: Object, selectedLands: Object, cards: Array, lands: Array}}
 *   selectedCards/Lands: { id: quantity }
 *   cards/lands: полные объекты карт с полем quantity
 */
export function expandDeckCodeWithCardData(deckCode) {
  const decoded = decodeDeckCode(deckCode)
  if (!decoded) throw new Error('Invalid deck code')

  const { selectedCards = {}, selectedLands = {} } = decoded

  if (Object.keys(selectedCards).length === 0 && Object.keys(selectedLands).length === 0) {
    // Пустая колода
    return { selectedCards: {}, selectedLands: {}, cards: [], lands: [] }
  }

  const cardsMap = indexById(CARDS)
  const landsMap = indexById(LANDS)

  // Канонизируем id (регистр + запись из каталога), сохраняя количество.
  const normalize = (map, selected) => {
    const out = {}
    for (const [id, qty] of Object.entries(selected)) {
      const row = map.get(id.toLowerCase())
      out[row ? row.id : id] = Number(qty)
    }
    return out
  }

  const normalizedSelectedCards = normalize(cardsMap, selectedCards)
  const normalizedSelectedLands = normalize(landsMap, selectedLands)

  const withQuantity = (map, selected) =>
    Object.entries(selected).map(([id, qty]) => {
      const row = map.get(id.toLowerCase())
      return row ? { ...row, quantity: Number(qty) } : { id, quantity: Number(qty) }
    })

  return {
    selectedCards: normalizedSelectedCards,
    selectedLands: normalizedSelectedLands,
    cards: withQuantity(cardsMap, normalizedSelectedCards),
    lands: withQuantity(landsMap, normalizedSelectedLands),
  }
}

function indexById(rows) {
  return new Map(rows.map((row) => [String(row.id).toLowerCase(), row]))
}
