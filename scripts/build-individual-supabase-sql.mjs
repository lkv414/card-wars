import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const inputFile = path.join(root, 'individual_cards', 'cards.json')
const outputFile = path.join(root, 'individual_cards', 'cards_supabase.sql')
const cards = JSON.parse(fs.readFileSync(inputFile, 'utf8'))

if (!Array.isArray(cards) || cards.length === 0) throw new Error('cards.json must contain a non-empty array')
if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error('Duplicate card ids')
if (new Set(cards.map((card) => card.image_url)).size !== cards.length) throw new Error('Duplicate image_url values')
for (const card of cards) {
  if (!fs.existsSync(path.join(root, 'individual_cards', card.image_url))) {
    throw new Error(`Missing image: ${card.image_url}`)
  }
  if (!Array.isArray(card.mechanics) || card.mechanics.some((m) => !m || typeof m !== 'object' || !Array.isArray(m.actions))) {
    throw new Error(`Invalid mechanics: ${card.name}`)
  }
}

// The current DB schema has UNIQUE(card_number), while source set numbers repeat
// across sets. Use a stable global catalog number for the seed and retain the
// source set number in a comment for audit/mapping.
const CATALOG_BASE = 100000
const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function uuidV5(name) {
  const hash = crypto.createHash('sha1').update(Buffer.from(NAMESPACE.replaceAll('-', ''), 'hex')).update(name).digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function quote(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  return `'${String(value).replaceAll("'", "''")}'`
}

function jsonLiteral(value) {
  return `$json$${JSON.stringify(value)}$json$::jsonb`
}

function dbCardType(value) {
  // public.cards.cards_card_type_check currently accepts these three values.
  return value === 'special' ? 'spell' : value
}

const lines = [
  '-- Supabase seed generated from individual_cards/cards.json',
  '-- Run in Supabase SQL Editor after reviewing the TRUNCATE below.',
  '-- Source: 504 unique card images; 504 catalog rows.',
  '--',
  '-- IMPORTANT: public.cards.card_number is UNIQUE in the current schema.',
  '-- Source set numbers repeat across sets, so catalog card_number is assigned',
  `-- globally as ${CATALOG_BASE + 1}..${CATALOG_BASE + cards.length}.`,
  '-- The original set number is retained in the per-row comment below.',
  '-- The 5 source card_type="special" rows are inserted as "spell" because the',
  '-- current DB CHECK constraint accepts only creature/building/spell.',
  '--',
  '-- Mechanics were normalized to { trigger, actions[], conditions[], ... }.',
  '-- Generic imperative/passive actions preserve text-only rules but are not',
  '-- executable by the current game engine until handlers are implemented.',
  '',
  'BEGIN;',
  '',
  '-- WARNING: this removes the current catalog and cascades to related card rows.',
  'TRUNCATE TABLE public.cards CASCADE;',
  '',
  'INSERT INTO public.cards',
  '  (id, card_number, name, description, card_type, cost, attack, health,',
  '   has_flip, flip_description, mechanics, image_url, land_type, is_rainbow)',
  'VALUES',
]

const values = cards.map((card, index) => {
  const catalogNumber = CATALOG_BASE + index + 1
  const id = uuidV5(`individual-card:${card.id}`)
  const fields = [
    quote(id) + '::uuid',
    String(catalogNumber),
    quote(card.name),
    card.description ? quote(card.description) : 'NULL',
    quote(dbCardType(card.card_type)),
    quote(card.cost),
    quote(card.attack),
    quote(card.health),
    quote(Boolean(card.has_flip)),
    quote(card.flip_description || ''),
    jsonLiteral(card.mechanics),
    quote(card.image_url),
    quote(card.land_type || 'any'),
    quote(Boolean(card.is_rainbow)),
  ]
  return `  -- catalog_id=${card.id}; source_card_number=${card.card_number}; image=${card.image_url}\n  (${fields.join(', ')})`
})

lines.push(values.join(',\n') + ';')
lines.push('', 'COMMIT;', '')

fs.writeFileSync(outputFile, lines.join('\n'), 'utf8')
console.log(`SQL=${outputFile}`)
console.log(`cards=${cards.length}`)
console.log(`catalog_numbers=${CATALOG_BASE + 1}..${CATALOG_BASE + cards.length}`)
console.log(`special_mapped_to_spell=${cards.filter((card) => card.card_type === 'special').length}`)
console.log(`bytes=${fs.statSync(outputFile).size}`)
