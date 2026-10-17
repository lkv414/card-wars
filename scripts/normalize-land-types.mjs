/**
 * normalize-land-types.mjs — приведение `land_type` каталога к канону.
 *
 * Зачем: каталог (`individual_cards/cards.json`) пришёл из OCR/LLM-разбора арта
 * и содержит 7 значений, которых нет в справочнике земель клиента и воркера
 * (`LAND_DEFS` / `LAND_TYPE_IDS`): rainbow 78, cute 36, plains 27, sandy 13,
 * plain 8, cotton 8, desert 7. Клиент считал их «неизвестными» и пропускал карту
 * на любую землю, а движок отказывал в `play_card` — карты были неигровыми.
 *
 * Соответствие подтверждено печатью на арте (docs/CATALOG_REVIEW.md, §3 R1):
 *   rainbow            → any   («Радужное существо», радужная иконка; is_rainbow=true)
 *   plains, plain      → blue  («Равнинное существо», синее перо — Blue Plains)
 *   cute, cotton       → good  («Милое существо», белое облачко — Nicelands)
 *   sandy, desert      → sand
 *
 * Запуск: node scripts/normalize-land-types.mjs [--check]
 *   --check — ничего не пишет, только проверяет, что данные уже нормальны
 *             (код возврата 1, если нет). Используется в гейте вместе с тестом.
 *
 * Идемпотентно: повторный запуск ничего не меняет.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = 'individual_cards/cards.json'

/** Канон земель — синхронно с LAND_DEFS (клиент) и LAND_TYPE_IDS (воркер). */
const CANONICAL = new Set(['corn', 'ice', 'good', 'swamp', 'sand', 'blue', 'any'])

/** Известные неканонические значения и их канонический эквивалент. */
const NORMALIZE = {
  rainbow: 'any',
  plains: 'blue',
  plain: 'blue',
  cute: 'good',
  cotton: 'good',
  sandy: 'sand',
  desert: 'sand',
}

const check = process.argv.includes('--check')
const cards = JSON.parse(readFileSync(FILE, 'utf8'))

const before = new Map()
const changes = new Map()
const unknown = []

for (const card of cards) {
  const raw = typeof card.land_type === 'string' ? card.land_type.trim().toLowerCase() : ''
  before.set(raw || '<пусто>', (before.get(raw || '<пусто>') || 0) + 1)

  if (CANONICAL.has(raw)) {
    if (card.land_type !== raw) card.land_type = raw
    continue
  }
  if (Object.prototype.hasOwnProperty.call(NORMALIZE, raw)) {
    const to = NORMALIZE[raw]
    changes.set(`${raw} → ${to}`, (changes.get(`${raw} → ${to}`) || 0) + 1)
    card.land_type = to
    if (raw === 'rainbow') card.is_rainbow = true
    continue
  }
  unknown.push(`${card.id}: land_type=${JSON.stringify(card.land_type)}`)
}

const sorted = (map) => [...map].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ')
console.log(`Карт: ${cards.length}`)
console.log(`Земли до:  ${sorted(before)}`)
if (changes.size) console.log(`Правки:    ${sorted(changes)}`)
if (unknown.length) {
  console.error(`Неизвестные значения без правила (${unknown.length}):\n  ${unknown.join('\n  ')}`)
}

if (check) {
  if (changes.size || unknown.length) {
    console.error('\n--check: данные не нормализованы. Запусти без --check.')
    process.exitCode = 1
  } else {
    console.log('\n--check: земли в каноне.')
  }
} else if (changes.size) {
  writeFileSync(FILE, `${JSON.stringify(cards, null, 2)}\n`, 'utf8')
  console.log(`\nЗаписано: ${FILE}`)
} else {
  console.log('\nНечего менять.')
}

if (unknown.length) process.exitCode = 1
