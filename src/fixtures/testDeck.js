import { TEST_CARDS, TEST_LANDS } from './testCatalog'

export const TEST_DECK = {
  id: 'test-deck',
  name: 'Локальная тестовая колода',
  code: 'LOCALTEST',
  selectedCards: Object.fromEntries(
    TEST_CARDS.map((card) => [card.id, card.id === 'test-card-rainbow' ? 2 : 4]),
  ),
  lands: TEST_LANDS.map((land) => land.id),
  heroId: null,
}

export function getLocalTestDeckPayload() {
  return {
    id: TEST_DECK.id,
    name: TEST_DECK.name,
    code: TEST_DECK.code,
    cards: TEST_CARDS.map((card) => ({
      id: card.id,
      quantity: TEST_DECK.selectedCards[card.id] || 0,
    })),
    lands: TEST_DECK.lands,
  }
}
