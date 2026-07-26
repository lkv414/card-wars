/**
 * safePlayer.test.js — тесты для защитного слоя game.players.
 *
 * Защищает от TypeError: Cannot read properties of undefined (reading 'health').
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { safePlayer, safePlayers, DEFAULT_PLAYER } from './safePlayer.js'

// 1. Фоллбек если массив undefined
test('safePlayer: возвращает фоллбек если players === undefined', () => {
  const res = safePlayer(undefined, 'p1')
  assert.equal(res.health, DEFAULT_PLAYER.health)
  assert.equal(res.__isFallback, true)
})

// 2. Фоллбек если массив пуст
test('safePlayer: возвращает фоллбек если players пустой', () => {
  const res = safePlayer([], 'p1')
  assert.equal(res.health, 25)
  assert.equal(res.__isFallback, true)
  assert.equal(res.player_id, 'p1')
})

// 3. Поиск по индексу
test('safePlayer: находит игрока по числовому индексу', () => {
  const players = [
    { player_id: 'p1', health: 10, nickname: 'Alice' },
    { player_id: 'p2', health: 5 },
  ]
  const res = safePlayer(players, 0)
  assert.equal(res.player_id, 'p1')
  assert.equal(res.health, 10)
  assert.equal(res.nickname, 'Alice')
  assert.notEqual(res.__isFallback, true)
})

// 4. Поиск по player_id
test('safePlayer: находит игрока по player_id строке', () => {
  const players = [
    { player_id: 'p1', health: 15 },
    { player_id: 'p2', health: 5 },
  ]
  const res = safePlayer(players, 'p2')
  assert.equal(res.player_id, 'p2')
  assert.equal(res.health, 5)
  assert.notEqual(res.__isFallback, true)
})

// 5. Sparse array — undefined в середине
test('safePlayer: НЕ падает если элемент массива === undefined', () => {
  const players = [{ player_id: 'p1', health: 12 }, undefined]
  // индекс 1 = undefined
  assert.doesNotThrow(() => {
    const res = safePlayer(players, 1)
    assert.equal(res.health, 25)
    assert.equal(res.__isFallback, true)
  })
})

// 6. null health → fallback 25
test('safePlayer: восстанавливает health, если он null', () => {
  const players = [{ player_id: 'p1', health: null }]
  const res = safePlayer(players, 'p1')
  assert.equal(res.health, 25)
})

// 7. NaN health → fallback 25
test('safePlayer: восстанавливает health, если он NaN', () => {
  const players = [{ player_id: 'p1', health: NaN }]
  const res = safePlayer(players, 'p1')
  assert.equal(res.health, 25)
})

// 8. target = null → fallback
test('safePlayer: target=null возвращает первого живого или фоллбек', () => {
  const players = [
    { player_id: 'p1', health: 0 },
    { player_id: 'p2', health: 18 },
  ]
  const res = safePlayer(players, null)
  assert.equal(res.player_id, 'p2')
})

// 9. target = null, все мертвы → фоллбек
test('safePlayer: target=null, все мертвы → фоллбек (первый в массиве)', () => {
  const players = [
    { player_id: 'p1', health: 0 },
    { player_id: 'p2', health: 0 },
  ]
  const res = safePlayer(players, null)
  // fallback вернёт DEFAULT, не first player — потому что у target нет type
  assert.equal(res.health, 25)
  assert.equal(res.__isFallback, true)
})

// 10. safePlayers: filter null/undefined
test('safePlayers: фильтрует null/undefined элементы', () => {
  const players = [
    { player_id: 'p1', health: 10 },
    null,
    undefined,
    { player_id: 'p2', health: 5 },
  ]
  const res = safePlayers(players)
  assert.equal(res.length, 2)
  assert.equal(res[0].player_id, 'p1')
  assert.equal(res[1].player_id, 'p2')
})

// 11. safePlayers: фиксит health во всех
test('safePlayers: фиксит health: null → 25', () => {
  const players = [
    { player_id: 'p1', health: null },
    { player_id: 'p2', health: 7 },
  ]
  const res = safePlayers(players)
  assert.equal(res[0].health, 25)
  assert.equal(res[1].health, 7)
})

// 12. safePlayers: undefined → []
test('safePlayers: undefined → пустой массив', () => {
  assert.deepEqual(safePlayers(undefined), [])
  assert.deepEqual(safePlayers(null), [])
  assert.deepEqual(safePlayers('not array'), [])
})

// 13. safePlayer: __isFallback есть только у фоллбеков
test('safePlayer: __isFallback есть только у фоллбеков', () => {
  const players = [{ player_id: 'p1', health: 10 }]
  assert.equal(safePlayer(players, 'p1').__isFallback, undefined)
  assert.equal(safePlayer(players, 'p2').__isFallback, true)
})

// 14. Главный кейс: не падает на TypeError
test('safePlayer: ГЛАВНЫЙ КЕЙС — не падает на undefined.health', () => {
  // Сценарий из реальной ошибки: в массиве дыра
  const players = [{ player_id: 'p1' }, undefined]
  // раньше: players[1].player_id → TypeError
  // теперь: safePlayer вернёт фоллбек
  let result
  assert.doesNotThrow(() => {
    result = safePlayer(players, 1)
  })
  assert.equal(result.health, 25)
  assert.equal(result.__isFallback, true)
})
