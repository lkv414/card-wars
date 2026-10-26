import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createMatch,
  opponentZoneFor,
  teamOf,
  type Command,
  type MatchMode,
  type MatchState,
  type PlayerSetup,
  type TeamVariant,
} from '../index';
import {
  buildDeck,
  catalog,
  defaultConfig,
  forceToHand,
  handCardId,
  mustOk,
  P1,
  P1_POOL,
  P2,
  P2_POOL,
} from './helpers';

const deps = { config: defaultConfig, catalog };
const P3 = 'p3';
const P4 = 'p4';

const ALL = [P1, P2, P3, P4];
const LANDS = [
  ['swamp', 'swamp', 'swamp', 'rainbow'],
  ['corn', 'corn', 'good', 'swamp'],
  ['swamp', 'swamp', 'swamp', 'rainbow'],
  ['corn', 'corn', 'good', 'swamp'],
] as const;

function multiSetup(
  count: number,
  mode: MatchMode = 'ffa',
  teamVariant: TeamVariant | null = null,
  seed = 4242,
): { players: PlayerSetup[]; seed: number; mode: MatchMode; teamVariant: TeamVariant | null } {
  const players: PlayerSetup[] = ALL.slice(0, count).map((id, i) => ({
    id,
    nickname: `Игрок ${i + 1}`,
    heroId: 'hero-billy',
    deck: buildDeck(i % 2 === 0 ? P1_POOL : P2_POOL),
    lands: [...LANDS[i]!],
  }));
  return { players, seed, mode, teamVariant };
}

function newMatch(count: number, mode: MatchMode = 'ffa', variant: TeamVariant | null = null, seed = 4242): MatchState {
  const { state } = createMatch(deps, multiSetup(count, mode, variant, seed));
  let s = state;
  for (const pid of state.order) {
    s = mustOk(applyCommand(s, { type: 'keep_hand', player: pid }, deps));
  }
  return s;
}

function turn(s: MatchState, command: Command): MatchState {
  return mustOk(applyCommand(s, command, deps));
}

function battle(s: MatchState, player: string): MatchState {
  return turn(s, { type: 'go_battle', player });
}

describe('зоны и соседи', () => {
  it('2 игрока: все зоны смотрят на единственного противника зеркально', () => {
    const s = newMatch(2);
    expect(opponentZoneFor(s, P1, 0)).toEqual({ player: P2, zone: 3 });
    expect(opponentZoneFor(s, P1, 3)).toEqual({ player: P2, zone: 0 });
  });

  it('FFA: зоны 1–2 — левый сосед, 3–4 — правый', () => {
    const s = newMatch(3);
    expect(opponentZoneFor(s, P1, 0)).toEqual({ player: P3, zone: 3 });
    expect(opponentZoneFor(s, P1, 1)).toEqual({ player: P3, zone: 2 });
    expect(opponentZoneFor(s, P1, 2)).toEqual({ player: P2, zone: 1 });
    expect(opponentZoneFor(s, P1, 3)).toEqual({ player: P2, zone: 0 });

    const four = newMatch(4);
    expect(opponentZoneFor(four, P1, 0)).toEqual({ player: P4, zone: 3 });
    expect(opponentZoneFor(four, P1, 2)).toEqual({ player: P2, zone: 1 });
  });

  it('«стенка»: сквозное зеркало восьми зон', () => {
    const s = newMatch(4, 'teams', 'wall');
    // P1/P2 — половины команды A, P3/P4 — команды B; ряд из 8 зон зеркалится целиком.
    expect(opponentZoneFor(s, P1, 0)).toEqual({ player: P4, zone: 3 });
    expect(opponentZoneFor(s, P2, 0)).toEqual({ player: P3, zone: 3 });
    expect(opponentZoneFor(s, P3, 0)).toEqual({ player: P2, zone: 3 });
    expect(opponentZoneFor(s, P4, 3)).toEqual({ player: P1, zone: 0 });
  });
});

describe('команды 2 на 2', () => {
  it('составы команд выводятся из посадки', () => {
    const wall = newMatch(4, 'teams', 'wall');
    expect(teamOf(wall, P1)!.playerIds).toEqual([P1, P2]);
    expect(teamOf(wall, P3)!.playerIds).toEqual([P3, P4]);

    const neighbors = newMatch(4, 'teams', 'neighbors');
    expect(teamOf(neighbors, P1)!.playerIds).toEqual([P1, P3]);
    expect(teamOf(neighbors, P2)!.playerIds).toEqual([P2, P4]);
  });

  it('общие жизни на старте 50 у обоих союзников', () => {
    const s = newMatch(4, 'teams', 'wall');
    for (const pid of ALL) {
      expect(s.players[pid]!.lives).toBe(defaultConfig.teamStartingLives);
      expect(s.players[pid]!.maxLives).toBe(defaultConfig.teamStartingLives);
    }
    expect(newMatch(4, 'ffa').players[P1]!.lives).toBe(defaultConfig.startingLives);
  });

  it('ход команды: оба союзника активны, бой только когда готовы оба', () => {
    const s = newMatch(4, 'teams', 'wall');
    expect(s.activePlayers).toEqual([P1, P2]);
    expect(s.players[P1]!.actions).toBe(2);
    expect(s.players[P2]!.actions).toBe(2);

    const oneReady = battle(s, P1);
    expect(oneReady.status).toBe('running');
    expect(oneReady.turn).toBe(1);
    expect(oneReady.players[P1]!.battleReady).toBe(true);
    expect(oneReady.players[P2]!.battleReady).toBe(false);
    expect(oneReady.activePlayers).toEqual([P1, P2]);

    // Готовый союзник больше не действует в основную фазу.
    const lateAction = applyCommand(oneReady, { type: 'draw_extra', player: P1 }, deps);
    expect(lateAction.ok).toBe(false);
    if (!lateAction.ok) expect(lateAction.rejected.code).toBe('wrong_phase');

    const bothReady = battle(oneReady, P2);
    expect(bothReady.turn).toBe(2);
    expect(bothReady.activePlayers).toEqual([P3, P4]);
    expect(bothReady.players[P3]!.battleReady).toBe(false);
  });

  it('бой команды: зона атакующего бьёт зеркальную зону противника, урон в общие жизни', () => {
    let s = newMatch(4, 'teams', 'wall');
    // Круг 1: без атак, просто передаём ход командам.
    s = battle(battle(s, P1), P2); // команда B
    s = battle(battle(s, P3), P4); // снова A, круг 2
    expect(s.round).toBe(2);
    expect(s.activePlayers).toEqual([P1, P2]);

    s = forceToHand(s, P1, 'vanilla-swamp');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 });
    s = battle(battle(s, P1), P2);

    expect(teamOf(s, P3)!.lives).toBe(48);
    expect(s.players[P3]!.lives).toBe(48);
    expect(s.players[P4]!.lives).toBe(48);
    expect(s.activePlayers).toEqual([P3, P4]);
  });

  it('первый круг 2 на 2: без атак и без флюпов', () => {
    let s = newMatch(4, 'teams', 'wall');
    s = forceToHand(s, P1, 'floop-draw');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'floop-draw'), zone: 0 });
    const floop = applyCommand(s, { type: 'floop', player: P1, instanceId: s.players[P1]!.zones[0]!.creature! }, deps);
    expect(floop.ok).toBe(false);
    if (!floop.ok) expect(floop.rejected.code).toBe('floop_forbidden_first_turn');

    s = battle(battle(s, P1), P2);
    expect(teamOf(s, P3)!.lives).toBe(50);
  });

  it('сдача в 2 на 2: команда выбывает после второй сдачи', () => {
    const s = newMatch(4, 'teams', 'wall');
    const first = applyCommand(s, { type: 'surrender', player: P1 }, deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.status).toBe('running');
    expect(first.state.players[P1]!.surrendered).toBe(true);
    expect(first.events.some((e) => e.type === 'match_finished')).toBe(false);

    const second = applyCommand(first.state, { type: 'surrender', player: P2 }, deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.status).toBe('finished');
    expect([...second.state.winners!].sort()).toEqual([P3, P4].sort());
    expect(second.state.finishReason).toBe('surrender');
    expect(second.state.players[P1]!.eliminated).toBe(true);
    expect(second.state.players[P2]!.eliminated).toBe(true);
  });

  it('обрыв в 2 на 2: поражение всей команды', () => {
    const s = newMatch(4, 'teams', 'neighbors');
    const res = applyCommand(s, { type: 'disconnect_loss', player: P3 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.status).toBe('finished');
    expect(res.state.finishReason).toBe('disconnect');
    expect([...res.state.winners!].sort()).toEqual([P2, P4].sort());
    expect(res.state.players[P1]!.eliminated).toBe(true);
    expect(res.state.players[P3]!.eliminated).toBe(true);
    expect(res.state.players[P4]!.eliminated).toBe(false);
  });
});

describe('FFA 3–4 игрока', () => {
  it('круг: первый круг атакует только последний игрок', () => {
    let s = newMatch(3);
    s = forceToHand(s, P1, 'vanilla-swamp');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 });
    s = battle(s, P1);
    expect(s.players[P3]!.lives).toBe(25);
    expect(s.activePlayers).toEqual([P2]);
    s = battle(s, P2);
    expect(s.activePlayers).toEqual([P3]);
    s = battle(s, P3);
    expect(s.round).toBe(2);
    expect(s.activePlayers).toEqual([P1]);
  });

  it('сдача одного игрока не завершает FFA; последний оставшийся побеждает', () => {
    let s = newMatch(3);
    s = battle(s, P1); // ход P2
    const first = applyCommand(s, { type: 'surrender', player: P2 }, deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.status).toBe('running');
    expect(first.state.players[P2]!.eliminated).toBe(true);

    const second = applyCommand(first.state, { type: 'surrender', player: P3 }, deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.status).toBe('finished');
    expect(second.state.winners).toEqual([P1]);
    expect(second.state.finishReason).toBe('surrender');
  });

  it('обрыв в FFA завершает партию победой всех оставшихся', () => {
    const s = newMatch(4);
    const res = applyCommand(s, { type: 'disconnect_loss', player: P2 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.status).toBe('finished');
    expect(res.state.finishReason).toBe('disconnect');
    expect([...res.state.winners!].sort()).toEqual([P1, P3, P4].sort());
  });
});

describe('парные карты', () => {
  it('в 2 на 2 разыгрываются без зоны и заменяют предыдущую', () => {
    let s = newMatch(4, 'teams', 'wall');
    s = forceToHand(s, P1, 'companion-pair');
    const firstId = handCardId(s, P1, 'companion-pair');
    s = turn(s, { type: 'play_card', player: P1, instanceId: firstId });
    expect(s.instances[firstId]!.location).toBe('companion');
    expect(s.players[P1]!.companion).toBe(firstId);
    expect(s.players[P1]!.actions).toBe(1);

    s = forceToHand(s, P1, 'companion-pair');
    const secondId = handCardId(s, P1, 'companion-pair');
    const res = applyCommand(s, { type: 'play_card', player: P1, instanceId: secondId }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[P1]!.companion).toBe(secondId);
    expect(res.state.instances[firstId]!.location).toBe('discard');
    expect(res.state.players[P1]!.discard).toContain(firstId);
    expect(res.events).toContainEqual({
      type: 'companion_played',
      player: P1,
      instanceId: secondId,
      cardId: 'companion-pair',
      replacedInstanceId: firstId,
    });
  });

  it('в FFA парная карта запрещена', () => {
    let s = newMatch(2);
    s = forceToHand(s, P1, 'companion-pair');
    const res = applyCommand(
      s,
      { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'companion-pair') },
      deps,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejected.code).toBe('invalid_card_type');
  });
});
