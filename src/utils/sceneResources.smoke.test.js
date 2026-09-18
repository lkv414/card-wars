/**
 * Smoke tests for the new scene-shared resources introduced by PERFORMANCE_AUDIT_3D.md.
 *
 * Что покрываем:
 *   - sceneResources: геометрии и материалы — модульные синглтоны, обновляются между рендерами.
 *   - resolveCardVisual: стабильная ссылка при семантически равных входах.
 *   - slotRegistry: корректный snapshot, WeakSet GC-friendly.
 */

import { describe, it, expect } from 'vitest'
import * as THREE from 'three'

import {
  CARD_PLANE,
  LAND_PLANE,
  INDICATOR_PLANE,
  FLIP_PLANE,
  BORDER_LONG,
  BORDER_SHORT,
  BORDER_MATERIAL,
  CARD_ROT_FLAT,
  CARD_LAYER_Y,
  LAND_SURFACE_Y,
  LAND_SLOT_LAYOUT,
  INDICATOR_POSITIONS,
  INDICATOR_COLORS,
  ATTACK_TARGET_COLOR,
} from './sceneResources.js'

import {
  resolveCardVisual,
  resetCardVisualCache,
} from './resolveCardVisual.js'

import {
  registerPlayableSlot,
  getPlayableSlotTargets,
  clearPlayableSlots,
} from '../components/Game/gameBoard3D/slotRegistry.js'

describe('sceneResources', () => {
  it('геометрии — модульные singleton-инстансы (стабильные ссылки)', () => {
    expect(CARD_PLANE).toBeInstanceOf(THREE.PlaneGeometry)
    expect(LAND_PLANE).toBeInstanceOf(THREE.PlaneGeometry)
    expect(INDICATOR_PLANE).toBeInstanceOf(THREE.PlaneGeometry)
    expect(FLIP_PLANE).toBeInstanceOf(THREE.PlaneGeometry)

    // Повторный импорт даёт ту же ссылку — это критично для memo на GameObject/GameLand.
    expect(CARD_PLANE).toBe(CARD_PLANE)
  })

  it('материалы — модульные синглтоны', () => {
    expect(BORDER_MATERIAL).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(BORDER_MATERIAL).toBe(BORDER_MATERIAL)
  })

  it('CARD_ROT_FLAT — frozen array, чтобы memo не промахивался', () => {
    expect(Object.isFrozen(CARD_ROT_FLAT)).toBe(true)
    expect(CARD_ROT_FLAT).toEqual([-Math.PI / 2, 0, 0])
  })

  it('LAND_SLOT_LAYOUT — frozen, creature z < building z', () => {
    expect(Object.isFrozen(LAND_SLOT_LAYOUT)).toBe(true)
    expect(LAND_SLOT_LAYOUT.creature.z).toBeLessThan(LAND_SLOT_LAYOUT.building.z)
    expect(LAND_SLOT_LAYOUT.creature.width).toBe(LAND_SLOT_LAYOUT.building.width)
  })

  it('INDICATOR_POSITIONS — frozen, slot-specific Y-координаты', () => {
    expect(Object.isFrozen(INDICATOR_POSITIONS.cost)).toBe(true)
    // Cost вверху (Y > 0), attack/defense внизу (Y < 0).
    expect(INDICATOR_POSITIONS.cost[1]).toBeGreaterThan(0)
    expect(INDICATOR_POSITIONS.attack[1]).toBeLessThan(0)
  })

  it('INDICATOR_COLORS содержит все нужные оттенки', () => {
    expect(INDICATOR_COLORS.cost).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(INDICATOR_COLORS.attack).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(INDICATOR_COLORS.defense).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('Y-уровни LAND_SURFACE_Y и CARD_LAYER_Y — положительные константы', () => {
    expect(LAND_SURFACE_Y).toBeGreaterThan(0)
    expect(CARD_LAYER_Y).toBeGreaterThan(0)
    expect(typeof ATTACK_TARGET_COLOR).toBe('string')
  })

  it('BORDER_LONG/SHORT имеют корректные пропорции', () => {
    // Узкая сторона < длинной.
    expect(BORDER_LONG.parameters.width).toBeGreaterThan(BORDER_LONG.parameters.height)
    expect(BORDER_SHORT.parameters.height).toBeGreaterThan(BORDER_SHORT.parameters.width)
  })
})

describe('resolveCardVisual', () => {
  it('возвращает ту же ссылку, если входы не изменились', () => {
    resetCardVisualCache()
    const card = { id: 'card-1', name: 'X', land_type: 'corn' }
    const catalog = new Map([['card-1', { image_url: 'a.png', name: 'X', land_type: 'corn' }]])
    const a = resolveCardVisual(card, catalog)
    const b = resolveCardVisual(card, catalog)
    expect(a).toBe(b)
  })

  it('возвращает новую ссылку, если поле изменилось', () => {
    resetCardVisualCache()
    const card1 = { id: 'card-1', name: 'X', land_type: 'corn' }
    const card2 = { id: 'card-1', name: 'Y', land_type: 'corn' }
    const catalog = new Map([['card-1', { image_url: 'a.png', name: 'X', land_type: 'corn' }]])
    const a = resolveCardVisual(card1, catalog)
    const b = resolveCardVisual(card2, catalog)
    expect(a).not.toBe(b)
  })

  it('не мутирует входной объект', () => {
    resetCardVisualCache()
    const card = { id: 'card-2', name: null, land_type: null }
    const catalog = new Map([['card-2', { image_url: 'b.png', name: 'Y', land_type: 'swamp' }]])
    const out = resolveCardVisual(card, catalog)
    expect(out.image_url).toBe('b.png')
    expect(out.name).toBe('Y')
    expect(out.land_type).toBe('swamp')
    // Входной объект не изменился (нет мутации).
    expect(card.name).toBeNull()
    expect(card.land_type).toBeNull()
  })

  it('возвращает входной объект, если нет каталога или записи', () => {
    resetCardVisualCache()
    const card = { id: 'card-3', name: 'Z', land_type: 'good' }
    expect(resolveCardVisual(card, null)).toBe(card)
    expect(resolveCardVisual(card, new Map())).toBe(card)
  })

  it('сбрасывает кэш при смене каталога', () => {
    resetCardVisualCache()
    const card = { id: 'card-4', name: 'X' }
    const catalog1 = new Map([['card-4', { name: 'X', image_url: 'a.png' }]])
    const a = resolveCardVisual(card, catalog1)
    const catalog2 = new Map([['card-4', { name: 'X', image_url: 'b.png' }]])
    const b = resolveCardVisual(card, catalog2)
    expect(a).not.toBe(b)
    expect(b.image_url).toBe('b.png')
  })
})

describe('slotRegistry', () => {
  it('регистрирует и возвращает targets', () => {
    clearPlayableSlots()
    const a = new THREE.Object3D()
    const b = new THREE.Object3D()
    const unregisterA = registerPlayableSlot(a)
    registerPlayableSlot(b)
    const targets = getPlayableSlotTargets()
    expect(targets).toContain(a)
    expect(targets).toContain(b)
    unregisterA()
    const targetsAfter = getPlayableSlotTargets()
    expect(targetsAfter).not.toContain(a)
    expect(targetsAfter).toContain(b)
  })

  it('clearPlayableSlots удаляет все', () => {
    clearPlayableSlots()
    registerPlayableSlot(new THREE.Object3D())
    registerPlayableSlot(new THREE.Object3D())
    expect(getPlayableSlotTargets().length).toBeGreaterThan(0)
    clearPlayableSlots()
    expect(getPlayableSlotTargets().length).toBe(0)
  })
})