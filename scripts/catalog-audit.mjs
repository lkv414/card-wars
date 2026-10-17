/**
 * catalog-audit.mjs — ревизия каталога карт (`individual_cards/cards.json`) и арта.
 *
 * Печатает отчёт «что не сходится» и НИЧЕГО не меняет. Дополняет
 * `src/data/catalog.test.js`: тест держит жёсткие инварианты (id уникальны, арт на
 * диске, mechanics_status из двух значений), а аудит показывает менее очевидные
 * расхождения — заглушки механик, неканонические земли, дубли арта, сироты и
 * дрейф относительно архива распознавания `.archive/исходники/_rebuild_v2`
 * (там лежат записи «файл → что прочитали на картинке»).
 *
 * Запуск: npm run catalog:audit  (или node scripts/catalog-audit.mjs --limit=20)
 * Код возврата 1, если есть находки уровня error.
 *
 * Разбор находок, приоритеты и план правок — docs/CATALOG_REVIEW.md.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CARDS_PATH = path.join(repoRoot, 'individual_cards', 'cards.json')
const ART_DIR = path.join(repoRoot, 'public', 'cards')
const ARCHIVE_DIR = path.join(repoRoot, '.archive', 'исходники', '_rebuild_v2')

const LIMIT = Number(
  (process.argv.find((arg) => arg.startsWith('--limit=')) || '').split('=')[1] || 12,
)

/** Типы, которые понимает движок (workers/src/game-engine/types.ts, Card.card_type). */
const ENGINE_CARD_TYPES = new Set(['creature', 'building', 'spell'])
/** Земли из src/constants/landColors.js (LAND_DEFS) — плюс служебный 'any'. */
const CANONICAL_LANDS = new Set(['corn', 'ice', 'good', 'swamp', 'sand', 'blue', 'any'])
/** Значения каталога, которые надо привести к каноническим (решение подтверждено артом). */
const LAND_NORMALIZATION = {
  rainbow: 'any', // печать: «Радужное существо», радужная иконка
  sandy: 'sand',
  desert: 'sand',
  plains: 'blue', // печать: «Равнинное существо», синяя иконка-перо
  plain: 'blue',
  cute: 'good', // печать: «Милое существо», белая иконка-облачко
  cotton: 'good',
}
/** Действия, которые реально исполняет mechanics-runtime.ts. */
const RUNTIME_ACTIONS = new Set([
  'deal_damage',
  'aoe_damage',
  'face_attack',
  'heal',
  'draw_cards',
  'discard_cards',
  'destroy',
  'move',
  'return_from_discard',
  'stat_buff',
  'gain_actions',
  'cost_reduction',
  'play_for_free',
])
/**
 * Действия-заглушки: текст разобран не до конца, движок их игнорирует
 * (см. isGenericAction в mechanics-runtime.ts — source_type тоже признак заглушки).
 */
const PLACEHOLDER_ACTIONS = new Set(['imperative', 'unparsed_description', 'passive', 'manual'])
const MECHANICS_STATUSES = new Set(['text_only', 'implemented'])

const errors = []
const warnings = []
const err = (msg) => errors.push(msg)
const warn = (msg) => warnings.push(msg)
const countBy = (items, keyFn) => {
  const map = new Map()
  for (const item of items) map.set(keyFn(item), (map.get(keyFn(item)) || 0) + 1)
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}
const pairs = (entries) => entries.map(([key, n]) => `${key}=${n}`).join('  ')
const list = (items, limit = LIMIT) =>
  items.length <= limit
    ? items.join('\n      ')
    : `${items.slice(0, limit).join('\n      ')}\n      … ещё ${items.length - limit}`

function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
}

function readWebpSize(buffer) {
  if (buffer.length < 30) return null
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null
  const fourcc = buffer.toString('ascii', 12, 16)
  if (fourcc === 'VP8X') {
    return {
      width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
      height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
    }
  }
  if (fourcc === 'VP8 ') {
    return {
      width: (buffer[26] | (buffer[27] << 8)) & 0x3fff,
      height: (buffer[28] | (buffer[29] << 8)) & 0x3fff,
    }
  }
  if (fourcc === 'VP8L') {
    const bits = buffer.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

const cards = JSON.parse(readFileSync(CARDS_PATH, 'utf8'))
const report = (label, items, level = 'warn') => {
  if (!items.length) return
  ;(level === 'error' ? err : warn)(`${label} (${items.length}):\n      ${list(items)}`)
}

console.log(`Аудит каталога: ${cards.length} карт из ${path.relative(repoRoot, CARDS_PATH)}\n`)

// ── A. Состав ────────────────────────────────────────────────────────────────
console.log('A. Состав')
console.log(`   типы:      ${pairs(countBy(cards, (c) => c.card_type || '<нет>'))}`)
console.log(`   механики:  ${pairs(countBy(cards, (c) => c.mechanics_status ?? '<нет>'))}`)
console.log(`   земли:     ${pairs(countBy(cards, (c) => c.land_type || '<нет>'))}`)
console.log(`   стоимость: ${pairs(countBy(cards, (c) => String(c.cost ?? '<нет>')))}`)
console.log(`   радужных:  ${cards.filter((c) => c.is_rainbow === true).length}`)
console.log(`   с флипом:  ${cards.filter((c) => c.has_flip === true).length}\n`)

// ── B. Идентификация ─────────────────────────────────────────────────────────
console.log('B. Идентификация')
const seenIds = new Map()
for (const card of cards) {
  if (!card.id) err(`карта без id: ${JSON.stringify(card.name)}`)
  seenIds.set(card.id, (seenIds.get(card.id) || 0) + 1)
}
report('дубли id', [...seenIds].filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`), 'error')
report(
  'id не равен card-<slug(name)>',
  cards.filter((c) => c.id && c.id !== `card-${slugify(c.name)}`).map((c) => `${c.id} (name: ${c.name})`),
)

const seenNames = new Map()
for (const card of cards) {
  const key = slugify(card.name)
  if (!key) continue
  seenNames.set(key, [...(seenNames.get(key) || []), card.id])
}
report(
  'одинаковые имена у разных id (одна карта дважды?)',
  [...seenNames].filter(([, ids]) => ids.length > 1).map(([name, ids]) => `${name}: ${ids.join(', ')}`),
)

for (const [label, key] of [
  ['card_number', (c) => c.card_number],
  ['image_index', (c) => c.image_index],
]) {
  const values = cards.map(key).filter((v) => v !== undefined && v !== null)
  const max = Math.max(...values)
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1)
  const dups = [...counts].filter(([, n]) => n > 1)
  const missing = [...Array(max).keys()].map((i) => i + 1).filter((v) => !counts.has(v))
  console.log(`   ${label}: 1..${max}, значений ${values.length}, дублей ${dups.length}, пропусков ${missing.length}`)
  if (dups.length && label === 'image_index') {
    warn(`${label}: дубли — это один файл арта на две карты:\n      ${list(dups.map(([v, n]) => `${v} ×${n}`))}`)
  }
}
console.log('')

// ── C. Арт ───────────────────────────────────────────────────────────────────
console.log('C. Арт и файлы')
const files = readdirSync(ART_DIR).filter((name) => name.toLowerCase().endsWith('.webp'))
const fileSet = new Set(files)
const referenced = new Map()
const artProblems = { format: [], missing: [], duplicate: [], unreadable: [], small: [], huge: [], landscape: [] }
const sizes = []

for (const card of cards) {
  const url = String(card.image_url || '')
  if (!/^\/cards\/[^/]+\.webp$/.test(url)) {
    artProblems.format.push(`${card.id}: ${url || '<пусто>'}`)
    continue
  }
  const name = url.replace(/^\/cards\//, '')
  referenced.set(name, [...(referenced.get(name) || []), card.id])
  if (!fileSet.has(name)) {
    artProblems.missing.push(`${card.id}: ${url}`)
    continue
  }
  const full = path.join(ART_DIR, name)
  const bytes = statSync(full).size
  const size = readWebpSize(readFileSync(full))
  if (!size) artProblems.unreadable.push(`${card.id}: ${name} (${bytes} Б)`)
  else {
    sizes.push({ name, bytes, ...size })
    if (size.width >= size.height) artProblems.landscape.push(`${card.id}: ${name} ${size.width}×${size.height}`)
  }
  if (bytes < 5_000) artProblems.small.push(`${card.id}: ${name} (${(bytes / 1024).toFixed(1)} КБ)`)
  if (bytes > 400_000) artProblems.huge.push(`${card.id}: ${name} (${(bytes / 1024).toFixed(0)} КБ)`)
}
for (const [name, ids] of referenced) {
  if (ids.length > 1) artProblems.duplicate.push(`${name}: ${ids.length} карт (${ids.slice(0, 4).join(', ')}…)`)
}
const orphans = files.filter((name) => !referenced.has(name))

report('image_url не по шаблону /cards/*.webp', artProblems.format, 'error')
report('нет файла арта', artProblems.missing, 'error')
report('один файл на несколько карт', artProblems.duplicate)
report('webp не читается (заголовок)', artProblems.unreadable, 'error')
report('файл подозрительно мал (<5 КБ)', artProblems.small)
report('файл подозрительно велик (>400 КБ)', artProblems.huge)
report('не портретный арт (width >= height)', artProblems.landscape)
report('файлы без карт (сироты в public/cards)', orphans)
if (sizes.length) {
  const sorted = [...sizes].sort((a, b) => a.width * a.height - b.width * b.height)
  const q = (p) => sorted[Math.floor(sorted.length * p)]
  const fmt = (s) => (s ? `${s.width}×${s.height} / ${(s.bytes / 1024).toFixed(0)} КБ` : '—')
  console.log(`   размеры: min ${fmt(sorted[0])}, медиана ${fmt(q(0.5))}, max ${fmt(sorted.at(-1))}`)
}
console.log(`   файлов .webp всего: ${files.length}, задействовано: ${referenced.size}, сирот: ${orphans.length}\n`)

// ── D. Поля карты ────────────────────────────────────────────────────────────
console.log('D. Поля карты')
const fieldProblems = {
  cost: [],
  creatureStats: [],
  nonCreatureStats: [],
  landUnmapped: [],
  landAlias: [],
  rainbow: [],
  flip: [],
  description: [],
  engineType: [],
}
for (const card of cards) {
  const cost = card.cost
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > 10) {
    fieldProblems.cost.push(`${card.id}: cost=${JSON.stringify(cost)}`)
  }
  const isCreature = card.card_type === 'creature'
  const hasStats = Number.isFinite(card.attack) && Number.isFinite(card.health)
  if (isCreature && !hasStats) {
    fieldProblems.creatureStats.push(`${card.id} (${card.name}): attack=${JSON.stringify(card.attack)} health=${JSON.stringify(card.health)}`)
  }
  if (!isCreature && hasStats) {
    fieldProblems.nonCreatureStats.push(`${card.id} (${card.name}): ${card.card_type} attack=${card.attack} health=${card.health}`)
  }
  const land = String(card.land_type ?? '')
  if (!CANONICAL_LANDS.has(land)) {
    fieldProblems[land in LAND_NORMALIZATION ? 'landAlias' : 'landUnmapped'].push(`${card.id}: ${JSON.stringify(card.land_type)}`)
  }
  if (Boolean(card.is_rainbow) !== (land === 'rainbow')) {
    fieldProblems.rainbow.push(`${card.id}: land_type=${card.land_type} is_rainbow=${card.is_rainbow}`)
  }
  if (card.has_flip === true && !String(card.flip_description || '').trim()) {
    fieldProblems.flip.push(`${card.id}: has_flip без flip_description`)
  }
  if (!String(card.description || '').trim()) fieldProblems.description.push(`${card.id} (${card.name})`)
  if (!ENGINE_CARD_TYPES.has(card.card_type)) {
    fieldProblems.engineType.push(`${card.id}: card_type=${card.card_type}`)
  }
}
report('cost вне 0..10 или не число', fieldProblems.cost, 'error')
report('существо без attack/health', fieldProblems.creatureStats, 'error')
report('не-существо с attack/health', fieldProblems.nonCreatureStats)
report('land_type без канонического соответствия', fieldProblems.landUnmapped, 'error')
report(
  'land_type — известный синоним, подлежит нормализации',
  fieldProblems.landAlias.map((x) => {
    const value = x.split(': ')[1].replace(/"/g, '')
    return `${x} → ${LAND_NORMALIZATION[value]}`
  }),
)
report('is_rainbow не совпадает с land_type', fieldProblems.rainbow)
report('has_flip без описания', fieldProblems.flip)
report('пустое description (ванильная карта?)', fieldProblems.description)
report('card_type, которого нет в движке', fieldProblems.engineType, 'error')
console.log('')

// ── E. Механики ──────────────────────────────────────────────────────────────
console.log('E. Механики')
const mechProblems = { status: [], implementedStub: [], textOnlyParsed: [], unknownAction: [], noMechanics: [], emptyActions: [] }
const actionCounts = new Map()
for (const card of cards) {
  if (!MECHANICS_STATUSES.has(card.mechanics_status)) {
    mechProblems.status.push(`${card.id}: ${card.mechanics_status}`)
  }
  const mechanics = Array.isArray(card.mechanics) ? card.mechanics : []
  const actions = mechanics.flatMap((m) => (Array.isArray(m?.actions) ? m.actions : []))
  const real = actions.filter((a) => a && typeof a.type === 'string' && !PLACEHOLDER_ACTIONS.has(a.type) && a.source_type === undefined)
  const unknown = real.filter((a) => !RUNTIME_ACTIONS.has(a.type))
  for (const action of real) {
    actionCounts.set(action.type, (actionCounts.get(action.type) || 0) + 1)
  }
  if (unknown.length) mechProblems.unknownAction.push(`${card.id}: ${[...new Set(unknown.map((a) => a.type))].join(', ')}`)
  if (card.mechanics_status === 'implemented' && real.length === 0 && mechanics.length > 0) {
    mechProblems.implementedStub.push(`${card.id} (${card.name})`)
  }
  if (card.mechanics_status === 'text_only' && real.length > 0) {
    mechProblems.textOnlyParsed.push(`${card.id} (${card.name}): ${[...new Set(real.map((a) => a.type))].join(', ')}`)
  }
  if (!mechanics.length) mechProblems.noMechanics.push(`${card.id} (${card.name})`)
  if (mechanics.length && !actions.length) mechProblems.emptyActions.push(`${card.id} (${card.name})`)
}
report('mechanics_status вне {text_only, implemented}', mechProblems.status, 'error')
report('implemented, но в механике одни заглушки', mechProblems.implementedStub)
report('text_only, но есть разобранные действия (кандидат в implemented)', mechProblems.textOnlyParsed)
report('тип действия вне возможностей mechanics-runtime', mechProblems.unknownAction)
report('нет ни одной механики — только текст описания', mechProblems.noMechanics)
report('механика без действий', mechProblems.emptyActions)
if (actionCounts.size) {
  console.log(`   разобранные действия (все карты): ${pairs([...actionCounts].sort((a, b) => b[1] - a[1]))}`)
}
console.log('')

// ── F. Сверка с архивом распознавания ────────────────────────────────────────
console.log('F. Сверка с архивом распознавания')
if (!existsSync(ARCHIVE_DIR)) {
  console.log('   архива нет — раздел пропущен\n')
} else {
  const groups = readdirSync(ARCHIVE_DIR)
    .filter((name) => /^group_[a-z]\.json$/i.test(name))
    .flatMap((name) => JSON.parse(readFileSync(path.join(ARCHIVE_DIR, name), 'utf8')))
  const byFile = new Map(groups.map((g) => [g.filename, g]))
  const keyOf = (card) => String(card.image_url || '').split('/').pop().replace(/\.webp$/, '.png')
  const nameMismatch = []
  const noArchive = []
  const statDiff = []
  for (const card of cards) {
    const row = byFile.get(keyOf(card))
    if (!row) {
      noArchive.push(`${keyOf(card)} → ${card.name}`)
      continue
    }
    if (row.name !== card.name) {
      nameMismatch.push(`${keyOf(card)}: каталог «${card.name}» [${card.card_type} ${card.land_type} cost=${card.cost}] ← архив «${row.name}» [${row.card_type} ${row.land_type} cost=${row.cost} ${row.attack}/${row.health}]`)
      continue
    }
    const same = (a, b) => (a ?? null) === (b ?? null)
    if (!same(row.cost, card.cost) || !same(row.attack, card.attack) || !same(row.health, card.health)) {
      statDiff.push(`${keyOf(card)} «${card.name}»: архив cost=${row.cost} ${row.attack}/${row.health} → каталог cost=${card.cost} ${card.attack}/${card.health}`)
    }
  }
  console.log(`   записей в архиве: ${groups.length}, файлов ${byFile.size}`)
  console.log(`   имя совпало: ${cards.length - nameMismatch.length - noArchive.length}, разошлось: ${nameMismatch.length}, нет записи: ${noArchive.length}`)
  const decks = countBy(noArchive, (x) => x.replace(/_card_\d+\.png.*$/, ''))
  if (decks.length) console.log(`   без записи по колодам: ${pairs(decks)}`)
  report('имя карты не совпало с прочитанным на арте', nameMismatch, 'error')
  report('цифры не совпали с архивом', statDiff)
  report('нет записи в архиве (арт никем не сверялся)', noArchive.slice(0, LIMIT), 'error')
  console.log('')
}

// ── Итог ─────────────────────────────────────────────────────────────────────
console.log(`Итог: ошибок ${errors.length}, предупреждений ${warnings.length}`)
for (const e of errors) console.log(`  ✖ ${e}`)
for (const w of warnings) console.log(`  ⚠ ${w}`)
console.log('\nРазбор находок и план правок: docs/CATALOG_REVIEW.md')
process.exitCode = errors.length ? 1 : 0
