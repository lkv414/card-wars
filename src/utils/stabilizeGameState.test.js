import { describe, it, expect } from 'vitest'
import { stabilizeGameState, dedupCardsById } from './stabilizeGameState.js'

describe('stabilizeGameState', () => {
  const base = {
    id: 'g1',
    version: 1,
    status: 'active',
    current_player_id: 'p1',
    players: [
      {
        player_id: 'p1',
        hand: [{ id: 'c1', instanceId: 'i1', name: 'A' }],
        zones: [{ zone_position: 1, cards: [{ id: 'z1', instanceId: 'z1' }], land_id: 'l1' }],
        deck_pile: [],
        discard_pile: [],
        actions_remaining: 2,
      },
    ],
  }

  it('returns prev when version is not newer', () => {
    const same = { ...base, version: 1 }
    expect(stabilizeGameState(base, same)).toBe(base)
  })

  it('preserves zone refs when only top-level turn fields change', () => {
    const next = {
      ...base,
      version: 2,
      current_player_id: 'p2',
      players: [
        {
          ...base.players[0],
          actions_remaining: 1,
          hand: [{ id: 'c1', instanceId: 'i1', name: 'A' }],
          zones: [{ zone_position: 1, cards: [{ id: 'z1', instanceId: 'z1' }], land_id: 'l1' }],
        },
      ],
    }

    const merged = stabilizeGameState(base, next)
    expect(merged.version).toBe(2)
    expect(merged.players[0].zones).toBe(base.players[0].zones)
    expect(merged.players[0].hand).toBe(base.players[0].hand)
  })

  it('uses new zone refs when cards change', () => {
    const next = {
      ...base,
      version: 2,
      players: [
        {
          ...base.players[0],
          zones: [{ zone_position: 1, cards: [{ id: 'z2', instanceId: 'z2' }], land_id: 'l1' }],
        },
      ],
    }

    const merged = stabilizeGameState(base, next)
    expect(merged.players[0].zones).not.toBe(base.players[0].zones)
    expect(merged.players[0].zones[0].cards[0].id).toBe('z2')
  })

  // === Reference stability (anti-3d-remount) ===
  it('возвращает prev.players если все players структурно эквивалентны', () => {
    const p1 = base.players[0]
    // spread'нули player и hand — но по структуре идентичен
    const next = {
      ...base,
      version: 2,
      players: [{ ...p1, hand: [...p1.hand] }], // новый массив, но те же данные
    }
    const result = stabilizeGameState(base, next)
    // stabilizePlayer должен вернуть prev (hand === next.hand по структуре)
    expect(result.players).toBe(base.players)
  })

  it('сохраняет players ссылку при изменении только version/top-level полей', () => {
    const p1 = base.players[0]
    const next = {
      ...base,
      version: 5,
      current_player_id: 'p2',
      players: [{ ...p1 }],
    }
    const result = stabilizeGameState(base, next)
    // players ссылка та же → useMemo([game.players]) не пересчитывает
    expect(result.players).toBe(base.players)
  })

  it('создаёт новый players если hand реально изменился', () => {
    const p1 = base.players[0]
    const next = {
      ...base,
      version: 2,
      players: [
        {
          ...p1,
          hand: [{ id: 'c2', instanceId: 'i2', name: 'New' }], // новая карта
        },
      ],
    }
    const result = stabilizeGameState(base, next)
    expect(result.players).not.toBe(base.players)
    expect(result.players[0].hand).not.toBe(base.players[0].hand)
  })
})

describe('dedupCardsById', () => {
  it('возвращает prev ссылку если дубликатов нет', () => {
    const cards = [
      { instanceId: 'a', name: 'A' },
      { instanceId: 'b', name: 'B' },
    ]
    expect(dedupCardsById(cards)).toBe(cards)
  })

  it('создаёт новый массив если есть дубликаты', () => {
    const card = { instanceId: 'a', name: 'A' }
    const cards = [card, card, { instanceId: 'b', name: 'B' }]
    const result = dedupCardsById(cards)
    expect(result).not.toBe(cards)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(card)
  })

  it('обрабатывает null/undefined в массиве', () => {
    const cards = [{ instanceId: 'a' }, null, { instanceId: 'b' }]
    const result = dedupCardsById(cards)
    expect(result).toHaveLength(2)
  })
})
