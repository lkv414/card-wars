import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@card-wars/protocol';
import { pick, startForPending, validTargets } from './targeting';

function makeMockView(players: string[], me: string = players[0]!): PlayerView {
  return {
    gameId: 'test-game',
    status: 'running',
    round: 1,
    turn: 1,
    activePlayer: me,
    activePlayers: [me],
    priorityPlayer: me,
    phase: 'main',
    mode: 'ffa',
    order: players,
    me,
    players: Object.fromEntries(
      players.map((pid) => [
        pid,
        {
          id: pid,
          nickname: `Player ${pid}`,
          heroId: 'finn',
          lives: 25,
          actions: 2,
          maxActions: 2,
          deckCount: 30,
          discard: [],
          lands: [],
          zones: [],
          companion: null,
          battleReady: false,
          eliminated: false,
        },
      ]),
    ),
    myHand: [],
    winner: null,
    castSpells: [],
    events: [],
  } as unknown as PlayerView;
}

describe('Targeting for Firm Handshake (Крепкое рукопожатие)', () => {
  it('creates targeting state from pending effect_step of Firm Handshake', () => {
    const view = makeMockView(['p1', 'p2'], 'p1');
    const state = startForPending(view, {
      player: 'p1',
      kind: 'effect_step',
      askIndex: 0,
      askCount: 1,
      cardId: 'firm-handshake-975645a',
      abilityIndex: 0,
    });

    expect(state).not.toBeNull();
    expect(state!.mode).toBe('pending');
    expect(state!.asks).toHaveLength(1);
    expect(state!.asks[0]!.kind).toBe('opponent_player');
  });

  it('computes valid opponent player targets excluding self', () => {
    const view = makeMockView(['p1', 'p2', 'p3'], 'p1');
    const state = startForPending(view, {
      player: 'p1',
      kind: 'effect_step',
      askIndex: 0,
      cardId: 'firm-handshake-975645a',
      abilityIndex: 0,
    })!;

    const targets = validTargets(view, state.asks[0]!, state.sourceInstanceId, state.collected);
    expect(targets).toEqual([
      { kind: 'player', playerId: 'p2' },
      { kind: 'player', playerId: 'p3' },
    ]);
  });

  it('accepts chosen opponent player and emits resolve_choice command', () => {
    const view = makeMockView(['p1', 'p2'], 'p1');
    const state = startForPending(view, {
      player: 'p1',
      kind: 'effect_step',
      askIndex: 0,
      cardId: 'firm-handshake-975645a',
      abilityIndex: 0,
    })!;

    const result = pick(view, state, { kind: 'player', playerId: 'p2' });
    expect(result.accepted).toBe(true);
    expect(result.command).toEqual({
      type: 'resolve_choice',
      player: 'p1',
      answer: { targets: [{ kind: 'player', playerId: 'p2' }] },
    });
  });

  it('rejects self when opponent_player is requested', () => {
    const view = makeMockView(['p1', 'p2'], 'p1');
    const state = startForPending(view, {
      player: 'p1',
      kind: 'effect_step',
      askIndex: 0,
      cardId: 'firm-handshake-975645a',
      abilityIndex: 0,
    })!;

    const result = pick(view, state, { kind: 'player', playerId: 'p1' });
    expect(result.accepted).toBe(false);
  });

  it('supports any_player target kind including self', () => {
    const view = makeMockView(['p1', 'p2'], 'p1');
    const targets = validTargets(view, { kind: 'any_player' }, null, []);
    expect(targets).toEqual([
      { kind: 'player', playerId: 'p1' },
      { kind: 'player', playerId: 'p2' },
    ]);
  });
});
