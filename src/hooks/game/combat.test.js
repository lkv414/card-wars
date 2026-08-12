import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDamageToCreature,
  canPlayerDealDamage,
  resolveCreatureFight,
  resolveZoneAttack,
} from './combat.js'

test('canPlayerDealDamage: 2 players first turn', () => {
  assert.equal(canPlayerDealDamage(1, 2, 0), false)
  assert.equal(canPlayerDealDamage(2, 2, 0), true)
})

test('canPlayerDealDamage: 3 players', () => {
  assert.equal(canPlayerDealDamage(3, 3, 0), true)
  assert.equal(canPlayerDealDamage(1, 3, 1), false)
  assert.equal(canPlayerDealDamage(1, 3, 2), true)
})

test('applyDamageToCreature kills only when damage > hp', () => {
  const creature = { card_type: 'creature', health: 10, attack: 5 }
  assert.equal(applyDamageToCreature(creature, 10).killed, false)
  assert.equal(applyDamageToCreature(creature, 11).killed, true)
  assert.equal(applyDamageToCreature(creature, 4).remainingHealth, 6)
})

test('resolveZoneAttack routes damage correctly', () => {
  const noCreature = resolveZoneAttack(7, [{ card_type: 'building', health: 5 }])
  assert.equal(noCreature.faceDamage, 7)

  const blocked = resolveZoneAttack(5, [{ card_type: 'creature', health: 10 }])
  assert.equal(blocked.faceDamage, 0)
  assert.equal(blocked.creatureResult.killed, false)
})

test('resolveCreatureFight: simultaneous counter-attack', () => {
  const attacker = { card_type: 'creature', attack: 5, health: 8 }
  const defender = { card_type: 'creature', attack: 3, health: 10 }

  const fight = resolveCreatureFight(attacker, defender)
  assert.equal(fight.damage, 5)
  assert.equal(fight.counterDamage, 3)
  assert.equal(fight.defenderResult.killed, false)
  assert.equal(fight.defenderResult.remainingHealth, 5)
  assert.equal(fight.attackerResult.killed, false)
  assert.equal(fight.attackerResult.remainingHealth, 5)
})

test('resolveCreatureFight: both can die from counter', () => {
  const attacker = { card_type: 'creature', attack: 6, health: 2 }
  const defender = { card_type: 'creature', attack: 5, health: 4 }

  const fight = resolveCreatureFight(attacker, defender)
  assert.equal(fight.defenderResult.killed, true)
  assert.equal(fight.attackerResult.killed, true)
})

test('resolveZoneAttack with attacker applies counter', () => {
  const attacker = { card_type: 'creature', attack: 4, health: 6 }
  const zone = [{ card_type: 'creature', attack: 7, health: 5 }]
  const result = resolveZoneAttack(4, zone, attacker)
  assert.equal(result.counterDamage, 7)
  assert.equal(result.attackerResult.killed, true)
  assert.equal(result.creatureResult.killed, false)
})
