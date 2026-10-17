/**
 * catalog.test.js — инварианты локального каталога (этап 5 плана v2).
 *
 * Каталог теперь лежит в бандле, поэтому ломается молча: если в
 * `cards.json` появится карта без арта или битый `image_url`, сборка этого не
 * заметит. Тест держит границу «каталог ↔ статика».
 *
 * Runs under `npm test` (node:test).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { CARDS, LANDS } from './catalog.js'
import { HEROES } from './heroes.js'
import { LAND_DEFS, FALLBACK_LAND_ID, resolveLandType } from '../constants/landColors.js'
import cardIdsSnapshot from '../../individual_cards/card-ids.json' with { type: 'json' }

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const IMAGE_URL_RE = /^\/cards\/[^/]+\.webp$/
const MECHANICS_STATUSES = new Set(['text_only', 'implemented'])
/** Типы карт, которые понимает движок (workers/src/game-engine/types.ts). */
const ENGINE_CARD_TYPES = new Set(['creature', 'building', 'spell'])

test('cards.json: карты есть, id уникальны', () => {
  assert.ok(CARDS.length >= 400, `ожидалось >= 400 карт, пришло ${CARDS.length}`)
  const ids = new Set(CARDS.map((card) => card.id))
  assert.equal(ids.size, CARDS.length, 'есть дубли id')
})

test('cards.json: у каждой карты есть имя, тип и корректный image_url с файлом на диске', () => {
  const broken = []
  for (const card of CARDS) {
    const problems = []
    if (!card.id) problems.push('нет id')
    if (!card.name) problems.push('нет name')
    if (!card.card_type) problems.push('нет card_type')
    if (!IMAGE_URL_RE.test(String(card.image_url || ''))) {
      problems.push(`image_url вне /cards/*.webp: ${card.image_url}`)
    } else if (!existsSync(path.join(repoRoot, 'public', card.image_url.replace(/^\//, '')))) {
      problems.push(`нет файла: public${card.image_url}`)
    }
    if (!MECHANICS_STATUSES.has(card.mechanics_status)) {
      problems.push(`mechanics_status: ${card.mechanics_status}`)
    }
    if (problems.length) broken.push(`${card.id}: ${problems.join(', ')}`)
  }
  assert.deepEqual(broken, [], `битые карты (${broken.length}):\n${broken.slice(0, 10).join('\n')}`)
})

test('LANDS: 6 земель из LAND_DEFS, id совпадает с land_type', () => {
  const expected = Object.values(LAND_DEFS)
    .filter((def) => def.id !== FALLBACK_LAND_ID)
    .map((def) => def.id)
    .sort()
  assert.deepEqual(LANDS.map((land) => land.id).sort(), expected)
  for (const land of LANDS) {
    assert.equal(land.land_type, land.id)
    assert.ok(land.name, `у земли ${land.id} нет name`)
  }
})

test('heroes.json: 23 героя, id уникальны, land_type из каталога земель', () => {
  assert.equal(HEROES.length, 23)
  const ids = new Set(HEROES.map((hero) => hero.id))
  assert.equal(ids.size, HEROES.length, 'есть дубли id героев')

  const landTypes = new Set([...LANDS.map((land) => land.id), FALLBACK_LAND_ID])
  const unknown = HEROES.filter((hero) => !landTypes.has(hero.land_type))
  assert.deepEqual(
    unknown.map((hero) => `${hero.id}:${hero.land_type}`),
    [],
    'land_type героя не из каталога земель',
  )
})

// ── R1: земли приведены к канону (scripts/normalize-land-types.mjs) ──────────

test('cards.json: земля каждой карты — каноническая (нет rainbow/sandy/cute/plain/cotton/desert)', () => {
  const canonical = new Set(Object.keys(LAND_DEFS))
  const bad = CARDS.filter((card) => !canonical.has(String(card.land_type || '').trim().toLowerCase()))
  assert.deepEqual(
    bad.map((card) => `${card.id}:${card.land_type}`),
    [],
    `неканонические земли (${bad.length}) — запусти node scripts/normalize-land-types.mjs`,
  )
  // resolveLandType не должен ничего додумывать
  const unmapped = [...new Set(CARDS.map((card) => card.land_type))].filter(
    (land) => resolveLandType(land) === null,
  )
  assert.deepEqual(unmapped, [], 'resolveLandType не отображает значения каталога')
})

test('cards.json: is_rainbow=true всегда означает землю any', () => {
  const bad = CARDS.filter((card) => card.is_rainbow === true && card.land_type !== FALLBACK_LAND_ID)
  assert.deepEqual(
    bad.map((card) => `${card.id}: land_type=${card.land_type} is_rainbow=${card.is_rainbow}`),
    [],
    'радужная карта обязана иметь землю any',
  )
})

test('канон земель не разъехался: LAND_DEFS клиента == LAND_TYPE_IDS воркера', () => {
  const workerCatalog = readFileSync(path.join(repoRoot, 'workers/src/catalog.ts'), 'utf8')
  const match = workerCatalog.match(/LAND_TYPE_IDS[^=]*=\s*\[([^\]]*)\]/)
  assert.ok(match, 'в workers/src/catalog.ts не найден LAND_TYPE_IDS')
  const workerIds = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  const clientIds = Object.values(LAND_DEFS)
    .map((def) => def.id)
    .filter((id) => id !== FALLBACK_LAND_ID)
    .sort()
  assert.deepEqual(workerIds, clientIds, 'список земель воркера разошёлся с LAND_DEFS')
})

test('cards.json: card_type — из известного набора (special — партнёрские карты 2v2)', async () => {
  const known = new Set([...ENGINE_CARD_TYPES, 'special'])
  const bad = CARDS.filter((card) => !known.has(card.card_type))
  assert.deepEqual(
    bad.map((card) => `${card.id}:${card.card_type}`),
    [],
    'тип карты вне известного набора',
  )
  const special = CARDS.filter((card) => card.card_type === 'special')
  assert.equal(special.length, 5, 'партнёрских карт special ожидается 5')
  // Эти карты не должны попадать в колоду: фильтр в редакторе и в воркере (R5).
  const { isDeckCard } = await import('../utils/deckCards.js')
  assert.deepEqual(
    special.filter((card) => isDeckCard(card)).map((card) => card.id),
    [],
    'special-карты обязаны отсекаться фильтром колоды',
  )
})

// ── id — неизменяемый ключ (колоды игроков ссылаются на id) ──────────────────

test('cards.json: набор id совпадает со снимком individual_cards/card-ids.json', () => {
  const ids = CARDS.map((card) => card.id)
  const snapshot = new Set(cardIdsSnapshot.ids)
  const added = ids.filter((id) => !snapshot.has(id))
  const removed = cardIdsSnapshot.ids.filter((id) => !ids.includes(id))
  assert.deepEqual(
    { added: added.slice(0, 20), removed: removed.slice(0, 20) },
    { added: [], removed: [] },
    'id карт — неизменяемый ключ: переименование карты не должно менять id. ' +
      'Если карта правда новая/удалена — node scripts/sync-card-ids.mjs --write',
  )
})

test('cards.json: id в стабильном формате card-<слаг>', () => {
  const bad = CARDS.filter((card) => !/^card-[a-zа-яё0-9-]+$/.test(String(card.id)))
  assert.deepEqual(
    bad.map((card) => String(card.id)),
    [],
    'id должен быть card-<слаг> (латиница/кириллица/цифры/дефис)',
  )
})
