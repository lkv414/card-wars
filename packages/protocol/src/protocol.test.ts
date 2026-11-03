import { describe, expect, it } from 'vitest';
import {
  ClientMessageSchema,
  CommandSchema,
  PlayerViewSchema,
  PROTOCOL_VERSION,
  ServerMessageSchema,
} from './index';

describe('protocol schemas', () => {
  it('разбирает корректные команды', () => {
    const cmd = CommandSchema.parse({
      type: 'play_card',
      player: 'p1',
      instanceId: 'p1#0',
      zone: 2,
      unfreezeWith: 'p1#1',
    });
    expect(cmd.type).toBe('play_card');
  });

  it('отклоняет неизвестные команды', () => {
    expect(
      CommandSchema.safeParse({ type: 'hack', player: 'p1' }).success,
    ).toBe(false);
    // disconnect_loss — серверная команда, из сети приходить не может
    expect(
      CommandSchema.safeParse({ type: 'disconnect_loss', player: 'p1' }).success,
    ).toBe(false);
  });

  it('разбирает join и отклоняет пустой ник', () => {
    expect(
      ClientMessageSchema.safeParse({
        t: 'join',
        code: '1234',
        nickname: 'Финн',
        protocolVersion: PROTOCOL_VERSION,
      }).success,
    ).toBe(true);
    expect(
      ClientMessageSchema.safeParse({
        t: 'join',
        code: '1234',
        nickname: '',
        protocolVersion: PROTOCOL_VERSION,
      }).success,
    ).toBe(false);
  });

  it('разбирает серверный снапшот и события', () => {
    const view = PlayerViewSchema.parse({
      status: 'running',
      phase: 'main',
      mode: 'ffa',
      teamVariant: null,
      teams: null,
      turn: 1,
      round: 1,
      activePlayers: ['p1'],
      activePlayer: 'p1',
      order: ['p1', 'p2'],
      me: 'p1',
      players: {},
      myHand: [],
      castSpells: [],
      revealed: {},
      pending: null,
      winners: null,
      finishReason: null,
      journal: [],
    });
    expect(view.me).toBe('p1');

    const lobby = ClientMessageSchema.safeParse({
      t: 'lobby_command',
      command: { type: 'set_mode', mode: { kind: 'teams', variant: 'wall' } },
    });
    expect(lobby.success).toBe(true);
    const msg = ServerMessageSchema.safeParse({
      t: 'events',
      events: [{ type: 'turn_started', player: 'p1', turn: 1, round: 1 }],
    });
    expect(msg.success).toBe(true);
  });
});
