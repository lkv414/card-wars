import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch, mirrorZoneIndex, type Command, type MatchState } from '../index';
import { catalog, defaultConfig, makeSetup, mustOk, P1, P2 } from './helpers';

const deps = { config: defaultConfig, catalog };

describe('property-тесты', () => {
  it('зеркальное сопоставление зон инволютивно', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), (zone) => {
        expect(mirrorZoneIndex(mirrorZoneIndex(zone, 4), 4)).toBe(zone);
        expect(mirrorZoneIndex(zone, 4)).toBe(3 - zone);
      }),
    );
  });

  it('случайный поток команд не ломает инварианты состояния', () => {
    const instanceIds = fc.constantFrom(...makeSampleInstanceIds());
    const players = fc.constantFrom(P1, P2, 'ghost');
    const commands = fc.record({
      type: fc.constantFrom(
        'play_card',
        'floop',
        'draw_extra',
        'discard_from_hand',
        'discard_from_field',
        'go_battle',
        'time_expired',
        'surrender',
        'mulligan',
        'keep_hand',
      ) as fc.Arbitrary<Command['type']>,
      player: players,
      instanceId: instanceIds,
      zone: fc.integer({ min: -1, max: 5 }),
      unfreezeWith: instanceIds,
      unfreezeZone: fc.integer({ min: -1, max: 5 }),
    });

    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999999 }), fc.array(commands, { minLength: 0, maxLength: 40 }), (seed, cmds) => {
        let s = start(seed);
        for (const c of cmds) {
          const cmd = toCommand(c);
          const res = applyCommand(s, cmd, deps);
          // любое исключение кроме DomainError — баг: applyCommand обязан возвращать результат
          if (res.ok) {
            s = res.state;
            checkInvariants(s);
          }
        }
        return true;
      }),
      { numRuns: 60 },
    );
  });
});

function makeSampleInstanceIds(): string[] {
  const { state } = createMatch(deps, makeSetup({ seed: 1 }));
  const ids = Object.keys(state.instances);
  return ids.slice(0, 40).concat('nonexistent#99');
}

function start(seed: number): MatchState {
  const { state } = createMatch(deps, makeSetup({ seed }));
  let s = mustOk(applyCommand(state, { type: 'keep_hand', player: P1 }, deps));
  s = mustOk(applyCommand(s, { type: 'keep_hand', player: P2 }, deps));
  return s;
}

type Sample = {
  type: Command['type'];
  player: string;
  instanceId: string;
  zone: number;
  unfreezeWith: string;
  unfreezeZone: number;
};

function toCommand(c: Sample): Command {
  switch (c.type) {
    case 'play_card':
      return { type: 'play_card', player: c.player, instanceId: c.instanceId, zone: c.zone, unfreezeWith: c.unfreezeWith };
    case 'floop':
      return { type: 'floop', player: c.player, instanceId: c.instanceId };
    case 'draw_extra':
      return { type: 'draw_extra', player: c.player };
    case 'discard_from_hand':
      return { type: 'discard_from_hand', player: c.player, instanceId: c.instanceId, unfreezeZone: c.unfreezeZone };
    case 'discard_from_field':
      return { type: 'discard_from_field', player: c.player, instanceId: c.instanceId };
    case 'go_battle':
      return { type: 'go_battle', player: c.player };
    case 'time_expired':
      return { type: 'time_expired', player: c.player };
    case 'surrender':
      return { type: 'surrender', player: c.player };
    case 'mulligan':
      return { type: 'mulligan', player: c.player };
    case 'keep_hand':
      return { type: 'keep_hand', player: c.player };
    case 'disconnect_loss':
      return { type: 'disconnect_loss', player: c.player };
  }
}

function checkInvariants(s: MatchState): void {
  // Фазы и статус согласованы.
  expect(['mulligan', 'running', 'finished']).toContain(s.status);
  expect(['draw', 'main', 'combat']).toContain(s.phase);
  if (s.status === 'finished') expect(s.winners).not.toBeNull();

  // Действия неотрицательны.
  for (const pid of s.order) {
    expect(s.players[pid]!.actions).toBeGreaterThanOrEqual(0);
  }

  // Живой игрок имеет жизни > 0 (после каждой команды выбывшие обработаны).
  for (const pid of s.order) {
    const p = s.players[pid]!;
    if (!p.eliminated) expect(p.lives).toBeGreaterThan(0);
  }

  // Активный игрок не выбыл, пока партия идёт.
  if (s.status === 'running') {
    expect(s.players[s.activePlayer]!.eliminated).toBe(false);
  }

  // Слоты зон ссылаются на корректные экземпляры.
  for (const pid of s.order) {
    const p = s.players[pid]!;
    for (const zone of p.zones) {
      for (const slot of ['creature', 'building'] as const) {
        const id = zone[slot];
        if (!id) continue;
        const inst = s.instances[id]!;
        expect(inst.location).toBe('field');
        expect(inst.controller).toBe(pid);
        expect(inst.slot).toBe(slot);
      }
    }
  }

  // Руки/колоды/сбросы согласованы с location экземпляров и не пересекаются.
  const seen = new Set<string>();
  for (const pid of s.order) {
    const p = s.players[pid]!;
    for (const [list, location] of [
      [p.hand, 'hand'],
      [p.deck, 'deck'],
      [p.discard, 'discard'],
    ] as const) {
      for (const id of list) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        expect(s.instances[id]!.location).toBe(location);
      }
    }
  }

  // Уникальные id экземпляров.
  expect(Object.keys(s.instances).length).toBe(
    Object.keys(s.instances).filter((id, i, all) => all.indexOf(id) === i).length,
  );
}
