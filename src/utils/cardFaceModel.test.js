import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getCardType,
  getCardHealth,
  getCardAttack,
  getCardCost,
  getCardImageUrl,
  getCardLandType,
  getEffectiveAttack,
  getEffectiveHealth,
  getCardFlipInfo,
  isFlippedCard,
  isLandCompatible,
  hasUnknownLandType,
} from './cardFields.ts'
import { resolveCardFace, STAT_ICONS } from './cardFaceModel.js'
import {
  LAND_DEFS,
  LAND_TYPE_IDS,
  resolveLandType,
  isUnknownLandType,
  unmappedLandTypes,
  getLandDef,
} from '../constants/landColors.js'

test('getCardType читает и card_type, и type', () => {
  assert.equal(getCardType({ card_type: 'creature' }), 'creature')
  assert.equal(getCardType({ type: 'building' }), 'building')
  assert.equal(getCardType({}), null)
  assert.equal(getCardType(null), null)
})

test('getCardHealth падает с health на defense', () => {
  assert.equal(getCardHealth({ health: 7 }), 7)
  assert.equal(getCardHealth({ defense: 4 }), 4)
  // health приоритетнее defense
  assert.equal(getCardHealth({ health: 9, defense: 1 }), 9)
  assert.equal(getCardHealth({ health: '' }), null)
  assert.equal(getCardHealth({}), null)
})

test('getCardCost: дефолт 1, ноль допустим, мусор отбрасывается', () => {
  assert.equal(getCardCost({ cost: 0 }), 0)
  assert.equal(getCardCost({ cost: 3 }), 3)
  assert.equal(getCardCost({}), 1)
  assert.equal(getCardCost({ cost: 'abc' }), 1)
  assert.equal(getCardCost({ cost: -2 }), 0)
})

test('getCardImageUrl нормализует card_url и строковое "null"', () => {
  assert.equal(getCardImageUrl({ image_url: 'a.png' }), 'a.png')
  assert.equal(getCardImageUrl({ card_url: 'b.png' }), 'b.png')
  assert.equal(getCardImageUrl({ image_url: 'null' }), null)
  assert.equal(getCardImageUrl({ image_url: '   ' }), null)
  assert.equal(getCardImageUrl({}), null)
})

test('getCardAttack игнорирует пустые значения', () => {
  assert.equal(getCardAttack({ attack: 5 }), 5)
  assert.equal(getCardAttack({ attack: 0 }), 0)
  assert.equal(getCardAttack({ attack: '' }), null)
  assert.equal(getCardAttack({}), null)
})

// ── Земля: ядро Ф3 ──────────────────────────────────────────────────────────

test('справочник земель содержит ровно 7 канонических типов', () => {
  assert.equal(LAND_TYPE_IDS.length, 7)
  for (const id of LAND_TYPE_IDS) {
    const def = LAND_DEFS[id]
    assert.ok(def, `${id} есть`)
    // каждый тип обязан отдавать всё, что раньше жило в трёх разных таблицах
    for (const key of ['fill', 'emissive', 'cssBorder', 'label', 'shortLabel', 'icon', 'badge']) {
      assert.ok(def[key], `${id}.${key} заполнено`)
    }
  }
})

test('земли: только канон, регистр и пробелы нормализуются', () => {
  assert.equal(resolveLandType('CORN'), 'corn')
  assert.equal(resolveLandType('  ice  '), 'ice')
  assert.equal(resolveLandType('corn'), 'corn')
  assert.equal(resolveLandType('any'), 'any')
  // Псевдонимов больше нет: данные приведены к канону (R1),
  // любое неканоническое значение — ошибка данных, а не догадка.
  assert.equal(resolveLandType('sandy'), null)
  assert.equal(resolveLandType('desert'), null)
  assert.equal(resolveLandType('rainbow'), null)
})

test('неизвестный тип земли не отображается и распознаётся', () => {
  assert.equal(resolveLandType('cute'), null)
  assert.equal(isUnknownLandType('cute'), true)
  assert.equal(isUnknownLandType('cotton'), true)
  assert.equal(isUnknownLandType('corn'), false)
  assert.equal(isUnknownLandType(null), false)
  assert.equal(resolveLandType(undefined), null)
})

test('is_rainbow=true означает "на любую землю", как и в Worker', () => {
  assert.equal(getCardLandType({ is_rainbow: true, land_type: 'rainbow' }), 'any')
  assert.equal(getCardLandType({ is_rainbow: true, land_type: 'any' }), 'any')
  assert.equal(getCardLandType({ land_type: 'corn' }), 'corn')
  // неканоническое значение — не земля, а мусор данных (карта универсальна в UI)
  assert.equal(getCardLandType({ land_type: 'sandy' }), null)
  assert.equal(getCardLandType({}), null)
})

test('hasUnknownLandType не срабатывает для радужных', () => {
  assert.equal(hasUnknownLandType({ is_rainbow: true, land_type: 'rainbow' }), false)
  assert.equal(hasUnknownLandType({ land_type: 'cute' }), true)
  assert.equal(hasUnknownLandType({ land_type: 'corn' }), false)
})

test('isLandCompatible: канон сравнивается точно, мусор не блокирует игру', () => {
  assert.equal(isLandCompatible('corn', 'corn'), true)
  assert.equal(isLandCompatible('corn', 'ice'), false)
  assert.equal(isLandCompatible('any', 'ice'), true)
  assert.equal(isLandCompatible('corn', null), true)
  assert.equal(isLandCompatible(null, 'ice'), true)
  // Неизвестный тип карты не блокирует игру (устойчивость UI; данных таких нет)
  assert.equal(isLandCompatible('cute', 'ice'), true)
})

test("getLandDef откатывается на 'any' для неизвестного типа", () => {
  assert.equal(getLandDef('corn').id, 'corn')
  assert.equal(getLandDef('cute').id, 'any')
  assert.equal(getLandDef(undefined).id, 'any')
})

test('unmappedLandTypes собирает неизвестные типы по набору карт', () => {
  const types = unmappedLandTypes([
    { land_type: 'cute' },
    { land_type: 'corn' },
    { land_type: 'cotton' },
    { land_type: 'cute' },
    { is_rainbow: true, land_type: 'rainbow' },
    {},
  ])
  assert.deepEqual(types, ['cotton', 'cute'])
})

test('каталог земель — единственный источник: длины и id совпадают', () => {
  assert.equal(LAND_TYPE_IDS.length, 7)
  assert.deepEqual(
    [...LAND_TYPE_IDS].sort(),
    ['any', 'blue', 'corn', 'good', 'ice', 'sand', 'swamp'],
  )
})

// ── Флип ────────────────────────────────────────────────────────────────────

test('getCardFlipInfo распознаёт все три признака', () => {
  assert.equal(getCardFlipInfo({ has_flip: true }).hasFlip, true)
  assert.equal(getCardFlipInfo({ flip_description: 'ПРИЁМ' }).hasFlip, true)
  assert.equal(
    getCardFlipInfo({ mechanics: [{ trigger: 'manual', actions: [{ type: 'flip_ability' }] }] }).hasFlip,
    true,
  )
  assert.equal(getCardFlipInfo({ flip_description: '   ' }).hasFlip, false)
  assert.equal(getCardFlipInfo({}).hasFlip, false)
  assert.equal(getCardFlipInfo(null).hasFlip, false)
})

test('isFlippedCard понимает и flipped, и isFlipped', () => {
  assert.equal(isFlippedCard({ flipped: true }), true)
  assert.equal(isFlippedCard({ isFlipped: true }), true)
  assert.equal(isFlippedCard({ flipped: false, isFlipped: true }), true)
  assert.equal(isFlippedCard({}), false)
})

// ── Баффы ───────────────────────────────────────────────────────────────────

test('баффы прибавляются к базовому стату, а не затирают его (аудит §8.5)', () => {
  const card = { attack: 4, health: 6, attack_bonus: 2, health_bonus: 1 }
  assert.equal(getCardAttack(card), 4)
  assert.equal(getCardHealth(card), 6)
  assert.equal(getEffectiveAttack(card), 6)
  assert.equal(getEffectiveHealth(card), 7)
})

// ── Модель лица ─────────────────────────────────────────────────────────────

test('resolveCardFace собирает значения из разнородных полей', () => {
  const face = resolveCardFace({
    id: 'c1',
    name: 'Кукузебра',
    card_type: 'creature',
    cost: 2,
    attack: 3,
    health: 8,
    land_type: 'sand',
    card_url: 'art.png',
  })
  assert.equal(face.id, 'c1')
  assert.equal(face.cost, 2)
  assert.equal(face.attack, 3)
  assert.equal(face.health, 8)
  assert.equal(face.imageUrl, 'art.png')
  assert.equal(face.landType, 'sand')
  assert.equal(face.landBadge, 'SN')
  assert.equal(face.showStats, true)
  assert.equal(face.typeLabel, 'Существо')
  assert.equal(face.landUnknown, false)
})

test('resolveCardFace не падает ни на каком мусоре', () => {
  assert.equal(resolveCardFace(null), null)
  assert.equal(resolveCardFace(undefined), null)
  assert.equal(resolveCardFace('card'), null)
  const face = resolveCardFace({})
  assert.equal(face.cost, 1)
  assert.equal(face.attack, null)
  assert.equal(face.type, null)
  assert.equal(face.landType, null)
  assert.equal(face.landUnknown, false)
})

test('resolveCardFace помечает неотображённую землю для админки', () => {
  const face = resolveCardFace({ land_type: 'cute' })
  assert.equal(face.landUnknown, true)
  assert.equal(face.landType, null)
  // но карта остаётся играбельной — тип откатывается в 'any'
  assert.equal(face.landBadge, LAND_DEFS.any.badge)
})

test('resolveCardFace: статы показываются только у существ', () => {
  assert.equal(resolveCardFace({ card_type: 'creature' }).showStats, true)
  assert.equal(resolveCardFace({ card_type: 'building' }).showStats, false)
  assert.equal(resolveCardFace({ card_type: 'spell' }).showStats, false)
})

test('resolveCardFace помечает бафф и отдаёт и базовое, и боевое значение', () => {
  const plain = resolveCardFace({ card_type: 'creature', attack: 4, health: 6 })
  assert.equal(plain.buffed, false)

  const buffed = resolveCardFace({ card_type: 'creature', attack: 4, health: 6, attack_bonus: 2 })
  assert.equal(buffed.buffed, true)
  assert.equal(buffed.attack, 4)
  assert.equal(buffed.effectiveAttack, 6)
})

test('STAT_ICONS — единственное место с индикаторами', () => {
  assert.equal(STAT_ICONS.cost, '💧')
  assert.equal(STAT_ICONS.attack, '⚔️')
  assert.equal(STAT_ICONS.health, '❤️')
})