/**
 * gameStore.test.js — unit-тесты Zustand game store.
 *
 * Покрывает:
 * - applyServerState: stale versions отбрасываются
 * - applyServerState: stabilize предотвращает ghost-cards (dedup по instanceId)
 * - beginOptimistic + applyServerState: оптимистичный UI мёрджится корректно
 * - rollbackOptimistic по таймауту
 * - clear: чистит state и таймеры
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useGameStore } from './gameStore.js'

function makeState(overrides = {}) {
  return {
    version: 1,
    id: 'game-1',
    current_player_id: 'p1',
    players: [
      {
        player_id: 'p1',
        health: 20,
        hand: [],
        deck_pile: [],
        discard_pile: [],
        zones: [],
      },
    ],
    ...overrides,
  }
}

describe('gameStore.applyServerState', () => {
  beforeEach(() => {
    useGameStore.getState().clear()
  })

  it('применяет первое состояние', () => {
    const ok = useGameStore.getState().applyServerState(makeState({ version: 5 }))
    expect(ok).toBe(true)
    expect(useGameStore.getState().serverVersion).toBe(5)
    expect(useGameStore.getState().game?.version).toBe(5)
  })

  it('отбрасывает stale versions', () => {
    useGameStore.getState().applyServerState(makeState({ version: 10 }))
    const ok = useGameStore.getState().applyServerState(makeState({ version: 5 }))
    expect(ok).toBe(false)
    expect(useGameStore.getState().serverVersion).toBe(10)
  })

  it('принимает более новую версию', () => {
    useGameStore.getState().applyServerState(makeState({ version: 5 }))
    const ok = useGameStore.getState().applyServerState(makeState({ version: 7 }))
    expect(ok).toBe(true)
    expect(useGameStore.getState().serverVersion).toBe(7)
  })

  it('игнорирует null/undefined', () => {
    const ok = useGameStore.getState().applyServerState(null)
    expect(ok).toBe(false)
    const ok2 = useGameStore.getState().applyServerState(undefined)
    expect(ok2).toBe(false)
  })

  it('убирает pending actions при подтверждении', () => {
    useGameStore.getState().applyServerState(makeState({ version: 1 }))
    useGameStore.getState().beginOptimistic(
      'req-1',
      (g) => ({ ...g, current_player_id: 'p2' }),
      { timeoutMs: 60_000 },
    )
    expect(useGameStore.getState().pendingActions.size).toBe(1)

    // Сервер прислал более новую версию — pending req-1 подтверждён
    // (serverVersionAtIssue=1, incoming=2, условие 1 < 2 → удалить)
    useGameStore.getState().applyServerState(makeState({ version: 2 }))
    expect(useGameStore.getState().pendingActions.size).toBe(0)
  })
})

describe('gameStore.beginOptimistic / rollbackOptimistic', () => {
  beforeEach(() => {
    useGameStore.getState().clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('применяет оптимистичный патч', () => {
    useGameStore.getState().applyServerState(makeState({ version: 1 }))
    useGameStore.getState().beginOptimistic(
      'req-1',
      (g) => ({ ...g, current_player_id: 'p2' }),
      { timeoutMs: 60_000 },
    )
    expect(useGameStore.getState().game.current_player_id).toBe('p2')
    expect(useGameStore.getState().isApplying).toBe(true)
  })

  it('rollbackOptimistic удаляет патч', () => {
    useGameStore.getState().applyServerState(makeState({ version: 1 }))
    useGameStore.getState().beginOptimistic(
      'req-1',
      (g) => ({ ...g, current_player_id: 'p2' }),
      { timeoutMs: 60_000 },
    )
    useGameStore.getState().rollbackOptimistic('req-1')
    expect(useGameStore.getState().pendingActions.size).toBe(0)
    expect(useGameStore.getState().isApplying).toBe(false)
  })

  it('автоматический rollback по таймауту', () => {
    useGameStore.getState().applyServerState(makeState({ version: 1 }))
    useGameStore.getState().beginOptimistic(
      'req-1',
      (g) => ({ ...g, current_player_id: 'p2' }),
      { timeoutMs: 1000 },
    )
    expect(useGameStore.getState().pendingActions.size).toBe(1)
    vi.advanceTimersByTime(1100)
    expect(useGameStore.getState().pendingActions.size).toBe(0)
  })

  it('no-op если patcher вернул тот же объект', () => {
    useGameStore.getState().applyServerState(makeState({ version: 1 }))
    useGameStore.getState().beginOptimistic(
      'req-1',
      (g) => g,
      { timeoutMs: 60_000 },
    )
    expect(useGameStore.getState().pendingActions.size).toBe(0)
  })
})

describe('gameStore anti-ghost-card', () => {
  beforeEach(() => {
    useGameStore.getState().clear()
  })

  it('dedup карт в руке по instanceId', () => {
    const card1 = { instanceId: 'a', name: 'Foo' }
    const card2 = { instanceId: 'b', name: 'Bar' }
    // Сервер прислал hand с дубликатом card1
    useGameStore.getState().applyServerState(
      makeState({
        version: 1,
        players: [
          {
            player_id: 'p1',
            health: 20,
            hand: [card1, card1, card2],
            deck_pile: [],
            discard_pile: [],
            zones: [],
          },
        ],
      }),
    )
    const hand = useGameStore.getState().game.players[0].hand
    expect(hand).toHaveLength(2)
    expect(hand[0].instanceId).toBe('a')
    expect(hand[1].instanceId).toBe('b')
  })
})

describe('gameStore.clear', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('чистит state и таймеры', () => {
    useGameStore.getState().applyServerState(makeState({ version: 5 }))
    useGameStore.getState().beginOptimistic(
      'req-1',
      (g) => ({ ...g, current_player_id: 'p2' }),
      { timeoutMs: 60_000 },
    )
    const clearSpy = vi.spyOn(window, 'clearTimeout')
    useGameStore.getState().clear()
    expect(clearSpy).toHaveBeenCalled()
    expect(useGameStore.getState().game).toBe(null)
    expect(useGameStore.getState().serverVersion).toBe(0)
    expect(useGameStore.getState().pendingActions.size).toBe(0)
  })
})
