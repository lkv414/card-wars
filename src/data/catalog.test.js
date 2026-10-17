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
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { CARDS, LANDS } from './catalog.js'
import { HEROES } from './heroes.js'
import { LAND_DEFS, FALLBACK_LAND_ID } from '../constants/landColors.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const IMAGE_URL_RE = /^\/cards\/[^/]+\.webp$/
const MECHANICS_STATUSES = new Set(['text_only', 'implemented'])

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
