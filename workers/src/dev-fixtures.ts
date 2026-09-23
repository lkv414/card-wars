import type { Card } from './game-engine/types'

/** Deterministic cards for the local Cloudflare test room. */
const TEST_CARD_DEFINITIONS = [
  {
    id: 'test-card-finn',
    name: 'Тестовый Фин',
    card_type: 'creature' as const,
    attack: 3,
    health: 4,
    defense: 0,
    cost: 1,
    slot_type: 'creature' as const,
    land_type: 'any',
    is_rainbow: true,
  },
  {
    id: 'test-card-bubblegum',
    name: 'Тестовая жвачка',
    card_type: 'creature' as const,
    attack: 2,
    health: 6,
    defense: 0,
    cost: 1,
    slot_type: 'creature' as const,
    land_type: 'ice',
    is_rainbow: false,
  },
  {
    id: 'test-card-tower',
    name: 'Тестовая башня',
    card_type: 'building' as const,
    attack: 0,
    health: 5,
    defense: 5,
    cost: 1,
    slot_type: 'building' as const,
    land_type: 'corn',
    is_rainbow: false,
  },
  {
    id: 'test-card-rainbow',
    name: 'Радужный тест',
    card_type: 'creature' as const,
    attack: 5,
    health: 5,
    defense: 0,
    cost: 2,
    slot_type: 'creature' as const,
    land_type: 'any',
    is_rainbow: true,
  },
]

export function testCard(index = 0): Card {
  const definition = TEST_CARD_DEFINITIONS[index % TEST_CARD_DEFINITIONS.length]
  return {
    ...definition,
    instanceId: `TEST_I${index}`,
  }
}

export const TEST_CARD_COUNT = TEST_CARD_DEFINITIONS.length
