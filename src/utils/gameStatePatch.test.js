import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPlayCardPatch,
  applyPlayCardZoneSnapshot,
  applyEndTurnPatch,
  applyBattleEventPatch,
  applyDrawPatch,
  normalizeDrawRpcData,
  sanitizeDrawRpcDataForSync,
} from './gameStatePatch.js'

test('applyPlayCardPatch removes card from hand and adds to zone', () => {
  const game = {
    id: 'g1',
    version: 5,
    current_player_id: 'p1',
    actions_remaining: 2,
    players: [
      {
        player_id: 'p1',
        actions_remaining: 2,
        hand: [
          { id: 'c1', name: 'Slime', card_type: 'creature', attack: 2, health: 3 },
          { id: 'c2', name: 'Tower', card_type: 'building' },
        ],
        zones: [
          { zone_position: 1, cards: [] },
          { zone_position: 2, cards: [] },
          { zone_position: 3, cards: [] },
          { zone_position: 4, cards: [] },
        ],
      },
    ],
  }

  const next = applyPlayCardPatch(game, 'p1', 0, 1, 'creature', {
    version: 6,
    actions_remaining: 1,
    action_cost: 1,
    card: { id: 'c1', name: 'Slime', card_type: 'creature', attack: 2, health: 3 },
  })

  assert.equal(next.version, 6)
  assert.equal(next.players[0].hand.length, 1)
  assert.equal(next.players[0].hand[0].id, 'c2')
  assert.equal(next.players[0].zones[1].cards.length, 1)
  assert.equal(next.players[0].zones[1].cards[0].name, 'Slime')
  assert.equal(next.players[0].actions_remaining, 1)
})

test('applyEndTurnPatch switches active player and untaps their lands', () => {
  const game = {
    id: 'g1',
    version: 10,
    current_turn: 3,
    current_player_id: 'p1',
    game_state: { log: [] },
    players: [
      {
        player_id: 'p1',
        health: 20,
        actions_remaining: 0,
        zones: [{ zone_position: 1, cards: [{ id: 'a1', card_type: 'creature', tapped: true }] }],
      },
      {
        player_id: 'p2',
        health: 25,
        actions_remaining: 0,
        free_draw_used: true,
        paid_draw_used: true,
        zones: [{ zone_position: 1, cards: [{ id: 'b1', card_type: 'creature', tapped: true }] }],
      },
    ],
  }

  const next = applyEndTurnPatch(game, {
    version: 11,
    next_player_id: 'p2',
    actions_remaining: 2,
    battle_events: [],
    game_finished: false,
  })

  assert.equal(next.version, 11)
  assert.equal(next.current_player_id, 'p2')
  assert.equal(next.current_turn, 4)
  assert.equal(next.players[1].actions_remaining, 2)
  assert.equal(next.players[1].free_draw_used, false)
  assert.equal(next.players[1].zones[0].cards[0].tapped, false)
})

test('applyBattleEventPatch applies face damage', () => {
  const game = {
    players: [
      { player_id: 'p1', health: 25, zones: [{ zone_position: 1, cards: [{ id: 'a1', card_type: 'creature', attack: 3, tapped: false }] }] },
      { player_id: 'p2', health: 25, zones: [{ zone_position: 1, cards: [] }] },
    ],
  }

  const next = applyBattleEventPatch(game, {
    from_player_id: 'p1',
    from_zone: 1,
    to_player_id: 'p2',
    to_zone: 1,
    damage: 3,
    counter_damage: 0,
    face_damage: 3,
    attacker_killed: false,
    attacker_damaged: false,
    creature_killed: false,
    creature_damaged: false,
  })

  assert.equal(next.players[1].health, 22)
  assert.equal(next.players[0].zones[0].cards[0].tapped, true)
})

test('applyPlayCardZoneSnapshot updates zone for observer with hidden hand', () => {
  const game = {
    id: 'g1',
    version: 5,
    current_player_id: 'p1',
    players: [
      {
        player_id: 'p1',
        hand: [],
        hand_count: 3,
        zones: [
          { zone_position: 1, cards: [] },
          { zone_position: 2, cards: [] },
          { zone_position: 3, cards: [] },
          { zone_position: 4, cards: [] },
        ],
      },
    ],
  }

  const zoneCards = [{ id: 'c1', name: 'Slime', card_type: 'creature', attack: 2, health: 3 }]
  const next = applyPlayCardZoneSnapshot(game, 'p1', 1, zoneCards, {
    version: 6,
    hand_count: 2,
    actions_remaining: 1,
  })

  assert.equal(next.version, 6)
  assert.equal(next.players[0].zones[1].cards.length, 1)
  assert.equal(next.players[0].zones[1].cards[0].name, 'Slime')
  assert.equal(next.players[0].hand_count, 2)
})

test('normalizeDrawRpcData sets draw flags from draw_type', () => {
  assert.deepEqual(normalizeDrawRpcData({ draw_type: 'free', version: 2 }), {
    draw_type: 'free',
    version: 2,
    free_draw_used: true,
    paid_draw_used: undefined,
  })
  assert.deepEqual(normalizeDrawRpcData({ draw_type: 'paid', version: 3 }), {
    draw_type: 'paid',
    version: 3,
    free_draw_used: undefined,
    paid_draw_used: true,
  })
})

test('sanitizeDrawRpcDataForSync strips hand for Ably observers', () => {
  const payload = sanitizeDrawRpcDataForSync({
    version: 7,
    draw_type: 'free',
    hand: [{ id: 'secret' }],
    hand_count: 3,
    deck_remaining: 8,
    free_draw_used: true,
  })
  assert.equal(payload.hand, undefined)
  assert.equal(payload.hand_count, 3)
  assert.equal(payload.free_draw_used, true)
})

test('applyDrawPatch updates actor hand and free draw flag without reload', () => {
  const game = {
    id: 'g1',
    version: 5,
    current_player_id: 'p1',
    actions_remaining: 2,
    players: [
      {
        player_id: 'p1',
        free_draw_used: false,
        paid_draw_used: false,
        hand: [{ id: 'c1', name: 'Slime' }],
        deck_remaining: 10,
        deck_pile: Array.from({ length: 10 }, (_, i) => ({ id: `d${i}` })),
      },
    ],
  }

  const next = applyDrawPatch(
    game,
    'p1',
    normalizeDrawRpcData({
      version: 6,
      draw_type: 'free',
      hand: [
        { id: 'c1', name: 'Slime' },
        { id: 'c2', name: 'Goblin' },
      ],
      hand_count: 2,
      deck_remaining: 9,
    }),
    'p1'
  )

  assert.equal(next.version, 6)
  assert.equal(next.players[0].hand.length, 2)
  assert.equal(next.players[0].hand[1].id, 'c2')
  assert.equal(next.players[0].free_draw_used, true)
  assert.equal(next.players[0].deck_remaining, 9)
  assert.equal(next.players[0].deck_pile.length, 9)
})

test('applyDrawPatch keeps opponent hand hidden and updates hand_count', () => {
  const game = {
    id: 'g1',
    version: 5,
    current_player_id: 'p1',
    players: [
      {
        player_id: 'p1',
        hand: [{ id: 'hidden-before' }],
        hand_count: 1,
        free_draw_used: false,
        deck_remaining: 10,
      },
      {
        player_id: 'p2',
        hand: [{ id: 'mine' }],
        free_draw_used: false,
      },
    ],
  }

  const next = applyDrawPatch(
    game,
    'p1',
    sanitizeDrawRpcDataForSync(
      normalizeDrawRpcData({
        version: 6,
        draw_type: 'free',
        hand_count: 2,
        deck_remaining: 9,
        free_draw_used: true,
      })
    ),
    'p2'
  )

  assert.equal(next.players[0].hand.length, 1)
  assert.equal(next.players[0].hand[0].id, 'hidden-before')
  assert.equal(next.players[0].hand_count, 2)
  assert.equal(next.players[0].free_draw_used, true)
  assert.equal(next.players[1].hand.length, 1)
})

test('applyDrawPatch applies paid draw actions_remaining for actor', () => {
  const game = {
    id: 'g1',
    version: 8,
    current_player_id: 'p1',
    actions_remaining: 2,
    players: [
      {
        player_id: 'p1',
        actions_remaining: 2,
        free_draw_used: true,
        paid_draw_used: false,
        hand: [{ id: 'c1' }],
        deck_remaining: 5,
      },
    ],
  }

  const next = applyDrawPatch(
    game,
    'p1',
    normalizeDrawRpcData({
      version: 9,
      draw_type: 'paid',
      hand: [{ id: 'c1' }, { id: 'c2' }],
      hand_count: 2,
      deck_remaining: 4,
      actions_remaining: 1,
    }),
    'p1'
  )

  assert.equal(next.actions_remaining, 1)
  assert.equal(next.players[0].actions_remaining, 1)
  assert.equal(next.players[0].paid_draw_used, true)
  assert.equal(next.players[0].hand.length, 2)
})
