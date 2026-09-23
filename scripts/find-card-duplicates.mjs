import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const root = process.cwd()
const cards = JSON.parse(fs.readFileSync(path.join(root, 'individual_cards/cards.json'), 'utf8'))
const records = []

function norm(value) {
  return String(value ?? '').toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim()
}
function signature(card) {
  return JSON.stringify({
    card_type: card.card_type,
    cost: card.cost,
    attack: card.attack,
    health: card.health,
    land_type: card.land_type,
    is_rainbow: card.is_rainbow,
    has_flip: card.has_flip,
    flip_description: card.flip_description,
    description: norm(card.description),
    mechanics: card.mechanics,
  })
}
function hamming(a, b) {
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n
}

for (const card of cards) {
  const file = path.join(root, 'individual_cards', card.image_url)
  const bytes = fs.readFileSync(file)
  const { data } = await sharp(bytes)
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let dhash = ''
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) dhash += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0'
  }
  records.push({ card, file, sha: crypto.createHash('sha256').update(bytes).digest('hex'), dhash })
}

const imageGroups = []
const remaining = new Set(records)
for (const record of records) {
  if (!remaining.has(record)) continue
  const group = [record]
  remaining.delete(record)
  for (const other of remaining) {
    if (record.sha === other.sha || hamming(record.dhash, other.dhash) <= 4) {
      group.push(other)
      remaining.delete(other)
    }
  }
  if (group.length > 1) imageGroups.push(group)
}

const signatureGroups = new Map()
for (const record of records) {
  const key = signature(record.card)
  if (!signatureGroups.has(key)) signatureGroups.set(key, [])
  signatureGroups.get(key).push(record)
}
const dataGroups = [...signatureGroups.values()].filter((group) => group.length > 1)

const report = {
  total: records.length,
  imageDuplicateGroups: imageGroups.map((group) => group.map(({ card, sha, dhash }) => ({ id: card.id, name: card.name, card_number: card.card_number, image_url: card.image_url, sha256: sha, dhash }))),
  dataDuplicateGroups: dataGroups.map((group) => group.map(({ card }) => ({ id: card.id, name: card.name, card_number: card.card_number, image_url: card.image_url }))),
}
fs.writeFileSync(path.join(root, 'individual_cards/duplicate-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`image duplicate groups: ${imageGroups.length}`)
for (const group of imageGroups) console.log(group.map((x) => `${x.card.name} [${x.card.image_url}]`).join(' <> '))
console.log(`data duplicate groups: ${dataGroups.length}`)
for (const group of dataGroups) console.log(group.map((x) => `${x.card.name} [${x.card.image_url}]`).join(' <> '))
