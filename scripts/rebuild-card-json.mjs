import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceRoot = path.join(root, 'исходники')
const groupRoot = path.join(sourceRoot, process.env.CARD_REBUILD_DIR || '_rebuild_v2')
const imageRoot = path.join(sourceRoot, 'карты')

function readGroups() {
  if (!fs.existsSync(groupRoot)) throw new Error(`Missing ${groupRoot}`)
  const files = fs.readdirSync(groupRoot).filter((f) => /^group_[a-z]\.json$/i.test(f)).sort()
  const records = []
  for (const file of files) {
    const value = JSON.parse(fs.readFileSync(path.join(groupRoot, file), 'utf8'))
    if (!Array.isArray(value)) throw new Error(`${file}: expected array`)
    for (const record of value) {
      if (!record?.filename) throw new Error(`${file}: record without filename`)
      records.push({ ...record, _group: file })
    }
  }
  return records
}

function numberFromFilename(filename) {
  const match = String(filename).match(/_(\d+)(?:\.[^.]+)?$/i)
  return match ? Number(match[1]) : null
}

function cleanText(value) {
  if (value == null) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text || text === 'null' || text === 'undefined' || /^[?]+$/u.test(text)) return null
  return text
}

function cleanNumber(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeRecord(input) {
  const rawFilename = String(input.filename).replaceAll('\\', '/')
  const filename = path.posix.basename(rawFilename)
  const cardNumber = cleanNumber(input.card_number ?? numberFromFilename(filename))
  const name = cleanText(input.name) ?? `Неизвестная карта ${filename}`
  const reviewRequired = Boolean(input.review_required) ||
    [input.name, input.card_type, input.description].some((v) => cleanText(v) == null)
  return {
    name,
    card_number: cardNumber,
    card_type: cleanText(input.card_type) ?? null,
    cost: cleanNumber(input.cost),
    attack: cleanNumber(input.attack),
    health: cleanNumber(input.health),
    land_type: cleanText(input.land_type) ?? 'any',
    description: cleanText(input.description) ?? '',
    mechanics: Array.isArray(input.mechanics) ? input.mechanics : [],
    mechanics_version: Number(input.mechanics_version ?? 1),
    mechanics_status: input.mechanics_status ?? 'text_only',
    has_flip: Boolean(input.has_flip ?? input.mechanics?.some?.((m) => m?.type === 'flip_ability' || m?.type === 'flip')),
    flip_description: cleanText(input.flip_description) ?? '',
    image_urls: [`исходники/карты/${filename}`],
    filename,
    reviewed: !reviewRequired,
  }
}

function keyFor(record) {
  return `${record.name}#${record.card_number ?? '?'}`
}

function writeJson(file, value) {
  fs.writeFileSync(path.join(sourceRoot, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  console.log(`${file}: ${Array.isArray(value) ? value.length : Object.keys(value).length} records`)
}

const normalized = readGroups().map(normalizeRecord)
const seen = new Set()
for (const record of normalized) {
  if (seen.has(record.filename)) throw new Error(`Duplicate filename: ${record.filename}`)
  seen.add(record.filename)
  if (!fs.existsSync(path.join(imageRoot, record.filename))) {
    throw new Error(`Image not found: ${record.filename}`)
  }
}

const allEntries = []
const allKeys = new Set()
for (const record of normalized.slice().sort((a, b) => (a.card_number ?? 9999) - (b.card_number ?? 9999) || a.filename.localeCompare(b.filename))) {
  const baseKey = keyFor(record)
  const key = allKeys.has(baseKey) ? `${baseKey}::${record.filename}` : baseKey
  allKeys.add(key)
  allEntries.push([key, record])
}
const all = Object.fromEntries(allEntries)

const clean = Object.fromEntries(Object.entries(all).map(([key, record]) => {
  const { mechanics, has_flip, flip_description, filename, reviewed, ...rest } = record
  return [key, { ...rest, image_urls: record.image_urls }]
}))

const withMechanics = Object.fromEntries(Object.entries(all).map(([key, record]) => [key, {
  ...record,
  mechanics: record.mechanics,
  has_flip: record.has_flip,
  flip_description: record.flip_description,
}]))

const byName = new Map()
for (const record of normalized) {
  const key = record.name.trim().toLocaleLowerCase('ru-RU')
  if (!byName.has(key)) {
    byName.set(key, {
      ...record,
      card_numbers: record.card_number == null ? [] : [String(record.card_number)],
      image_urls: [...record.image_urls],
    })
    continue
  }
  const merged = byName.get(key)
  if (record.card_number != null && !merged.card_numbers.includes(String(record.card_number))) {
    merged.card_numbers.push(String(record.card_number))
  }
  merged.image_urls.push(...record.image_urls)
  merged.reviewed = merged.reviewed && record.reviewed
  if (!merged.description && record.description) merged.description = record.description
}

writeJson('cards.json', all)
writeJson('cards.clean.json', clean)
writeJson('cards.with_mechanics.json', withMechanics)
writeJson('cards.dedup_by_name.json', Object.fromEntries(byName))
console.log(`images=${normalized.length}; unique_names=${byName.size}`)
