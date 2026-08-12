import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCardCatalog,
  enrichCard,
  enrichGameState,
  collectMissingCardIds,
} from './enrichGameCards.js'

test('enrichCard merges catalog fields into runtime copy', () => {
  const catalog = buildCardCatalog([
    {
      id: 'abc-123',
      name: 'Воин',
      image_url: 'https://example.com/warrior.png',
      cost: 2,
      attack: 3,
      health: 5,
    },
  ])
  const runtime = { id: 'abc-123', instanceId: 'abc-123-0', tapped: true, image_url: null }
  const result = enrichCard(runtime, catalog)
  assert.equal(result.name, 'Воин')
  assert.equal(result.image_url, 'https://example.com/warrior.png')
  assert.equal(result.cost, 2)
  assert.equal(result.tapped, true)
})

test('enrichGameState hydrates hand and zone cards', () => {
  const catalog = buildCardCatalog([{ id: 'c1', name: 'Spell', cost: 1, image_url: '/a.png' }])
  const game = enrichGameState(
    {
      players: [
        {
          player_id: 'p1',
          hand: [{ id: 'c1', instanceId: 'c1-1' }],
          zones: [{ zone_position: 1, cards: [{ id: 'c1', tapped: false }] }],
        },
      ],
    },
    catalog
  )
  assert.equal(game.players[0].hand[0].name, 'Spell')
  assert.equal(game.players[0].zones[0].cards[0].image_url, '/a.png')
})

test('collectMissingCardIds finds cards without catalog metadata', () => {
  const catalog = buildCardCatalog([])
  const ids = collectMissingCardIds(
    { players: [{ hand: [{ id: 'missing-id' }], zones: [] }] },
    catalog
  )
  assert.deepEqual(ids, ['missing-id'])
})
