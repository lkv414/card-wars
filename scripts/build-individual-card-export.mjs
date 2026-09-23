import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceDir = path.join(root, 'исходники')
const sourceCards = path.join(sourceDir, 'cards.dedup_by_name.json')
const sourceImages = path.join(sourceDir, 'карты')
const outputDir = path.join(root, 'individual_cards')
const outputImages = path.join(outputDir, 'images')
const outputFile = path.join(outputDir, 'cards.json')

function slug(value, index) {
  const text = String(value ?? '').trim().toLowerCase()
    .replace(/[^a-zа-яё0-9]+/giu, '-')
    .replace(/^-+|-+$/g, '')
  return `card-${String(index + 1).padStart(4, '0')}-${text || 'unnamed'}`
}

function canonicalCardType(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (['существо', 'creature', 'unit'].includes(text)) return 'creature'
  if (['заклинание', 'spell', 'enchantment', 'ritual'].includes(text)) return 'spell'
  if (['строение', 'здание', 'building', 'structure'].includes(text)) return 'building'
  return value || 'unknown'
}

function firstFilename(record) {
  const raw = Array.isArray(record.image_urls) && record.image_urls.length
    ? record.image_urls[0]
    : record.filename
  return path.posix.basename(String(raw).replaceAll('\\', '/'))
}

if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
if (!fs.existsSync(outputImages)) fs.mkdirSync(outputImages, { recursive: true })

const source = JSON.parse(fs.readFileSync(sourceCards, 'utf8'))
const records = Object.values(source)
const seenImages = new Set()
const output = []

for (const [index, record] of records.entries()) {
  const filename = firstFilename(record)
  const sourceImage = path.join(sourceImages, filename)
  if (!fs.existsSync(sourceImage)) {
    throw new Error(`Missing source image: ${filename}`)
  }
  if (seenImages.has(filename)) continue
  seenImages.add(filename)

  const targetName = `${String(index + 1).padStart(4, '0')}-${filename}`
  fs.copyFileSync(sourceImage, path.join(outputImages, targetName))

  output.push({
    id: slug(record.name, index),
    name: record.name,
    card_number: record.card_number ?? null,
    card_type: canonicalCardType(record.card_type),
    cost: record.cost ?? null,
    attack: record.attack ?? null,
    health: record.health ?? null,
    land_type: record.land_type ?? 'any',
    is_rainbow: Boolean(record.is_rainbow ?? record.land_type === 'rainbow'),
    has_flip: Boolean(record.has_flip),
    flip_description: record.flip_description ?? '',
    description: record.description ?? '',
    mechanics: Array.isArray(record.mechanics) ? record.mechanics : [],
    image_url: `images/${targetName}`,
  })
}

fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(`cards=${output.length}`)
console.log(`images=${seenImages.size}`)
console.log(`output=${outputDir}`)
