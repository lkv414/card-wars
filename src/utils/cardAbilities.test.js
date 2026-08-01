/**
 * Тесты для cardAbilities.js — чистые хелперы для проверки способностей карт.
 *
 * БАГ-ФИКС (01.08.2026): useFlipCard раньше проверял card.abilities?.includes('Флюп'),
 * но в данных из БД нет поля `abilities`. Флип определяется через has_flip /
 * flip_description / mechanics. Эти тесты защищают от регрессии.
 *
 * Почему отдельный файл (а не useFlipCard.test.js): Node native ESM
 * не резолвит импорты без .js, а useFlipCard.js тянет supabase → import.meta.env.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasFlipAbility } from '../hooks/game/cardAbilities.js'

test('hasFlipAbility — false для null/undefined', () => {
  assert.equal(hasFlipAbility(null), false)
  assert.equal(hasFlipAbility(undefined), false)
})

test('hasFlipAbility — true когда has_flip === true', () => {
  assert.equal(hasFlipAbility({ has_flip: true }), true)
})

test('hasFlipAbility — false когда has_flip === false', () => {
  assert.equal(hasFlipAbility({ has_flip: false }), false)
})

test('hasFlipAbility — true когда есть непустая flip_description', () => {
  assert.equal(hasFlipAbility({ flip_description: 'Возьми 1 карту' }), true)
})

test('hasFlipAbility — false для пустой flip_description', () => {
  assert.equal(hasFlipAbility({ flip_description: '' }), false)
  assert.equal(hasFlipAbility({ flip_description: '   ' }), false)
})

test('hasFlipAbility — false для нестроковой flip_description', () => {
  assert.equal(hasFlipAbility({ flip_description: null }), false)
  assert.equal(hasFlipAbility({ flip_description: 123 }), false)
})

test('hasFlipAbility — true когда в mechanics есть flip_ability', () => {
  assert.equal(
    hasFlipAbility({
      mechanics: [
        { type: 'passive_buff', stat: 'attack' },
        { type: 'flip_ability', action: 'damage' },
      ],
    }),
    true
  )
})

test('hasFlipAbility — false когда mechanics не массив', () => {
  assert.equal(hasFlipAbility({ mechanics: 'flip_ability' }), false)
  assert.equal(hasFlipAbility({ mechanics: null }), false)
})

test('hasFlipAbility — false когда mechanics нет flip_ability', () => {
  assert.equal(
    hasFlipAbility({
      mechanics: [{ type: 'passive_buff' }, { type: 'spell' }],
    }),
    false
  )
})

test('hasFlipAbility — карта из БД (реальная структура)', () => {
  // Из реального дампа руки:
  // { has_flip: true, flip_description: 'Возьми 1 карту.', ... }
  assert.equal(
    hasFlipAbility({
      id: 'dafe551c-1072-4548-97fd-804ed901c788',
      name: 'Смог, который смог',
      has_flip: true,
      flip_description: 'Возьми 1 карту.',
    }),
    true
  )
  // Карта без флипа:
  assert.equal(
    hasFlipAbility({
      id: 'a2f2df9f-29e3-43ce-a175-245ebbe490a2',
      name: 'Циклоп-землекоп',
      has_flip: false,
      flip_description: null,
    }),
    false
  )
})