import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, type MatchState } from '../index';
import { catalog, defaultConfig, forceToHand, handCardId, mustOk, P1, P2 } from './helpers';
import { startedMatch } from './engine.test';

const deps = { config: defaultConfig, catalog };

function edit(state: MatchState, fn: (draft: MatchState) => void): MatchState {
  const draft = JSON.parse(JSON.stringify(state)) as MatchState;
  fn(draft);
  return draft;
}

function turn(s: MatchState, command: Command): MatchState {
  return mustOk(applyCommand(s, command, deps));
}

function battle(s: MatchState, player: string): MatchState {
  return turn(s, { type: 'go_battle', player });
}

function round2(s: MatchState): MatchState {
  return battle(battle(s, P1), P2);
}

describe('ходы-состояния: скидки следующего розыгрыша', () => {
  it('Призрак Джинни: следующее заклинание дешевле, скидка списывается', () => {
    let s = round2(startedMatch());
    s = forceToHand(s, P1, 'ghost-jinni');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'ghost-jinni'), zone: 0 });
    const jinniId = s.players[P1]!.zones[0]!.creature!;
    s = turn(s, { type: 'floop', player: P1, instanceId: jinniId });
    expect(s.discounts).toHaveLength(1);
    // Заклинание cost 1 при скидке −2 → бесплатно, скидка списана.
    s = forceToHand(s, P1, 'spell-draw');
    const before = s.players[P1]!.actions;
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'spell-draw') });
    expect(s.players[P1]!.actions).toBe(before); // 1 − 2 → 0
    expect(s.discounts).toHaveLength(0);
    // Второе заклинание — по полной.
    s = forceToHand(s, P1, 'spell-draw');
    const before2 = s.players[P1]!.actions;
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'spell-draw') });
    expect(s.players[P1]!.actions).toBe(before2 - 1);
  });

  it('Непустой гроб: следующее существо на 2 действия дешевле', () => {
    let s = round2(startedMatch());
    s = forceToHand(s, P1, 'coffin');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'coffin') });
    expect(s.discounts).toHaveLength(1);
    s = forceToHand(s, P1, 'vanilla-swamp');
    const before = s.players[P1]!.actions;
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 });
    expect(s.players[P1]!.actions).toBe(before); // cost 1 − 2 → 0
    expect(s.discounts).toHaveLength(0);
  });
});

describe('ходы-состояния: запрет заклинаний (Дух ниндзя)', () => {
  it('урон в лицо вооружает бан на следующий ход противника', () => {
    let s = round2(startedMatch());
    s = forceToHand(s, P1, 'ninja');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'ninja'), zone: 0 });
    const ninjaId = s.players[P1]!.zones[0]!.creature!;
    // Зеркальная зона 3 P2 пуста → удар в лицо, бан вооружается.
    s = battle(s, P1); // конец хода P1 → ход P2 стартует с активным баном
    expect(s.spellBansActive.some((b) => b.player === P2 && b.turn === s.turn)).toBe(true);
    // P2 не может играть заклинания.
    s = forceToHand(s, P2, 'spell-draw');
    const denied = applyCommand(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'spell-draw') }, deps);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.rejected.code).toBe('spells_banned');
    // Существа играть можно.
    s = forceToHand(s, P2, 'vanilla-corn');
    const okPlay = turn(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'vanilla-corn'), zone: 0 });
    expect(okPlay.players[P2]!.zones[0]!.creature).not.toBeNull();
    // Ниндзя бьёт в лицо каждый ход, пока жив: на новом ходу P2 бан обновился.
    s = battle(s, P2); // → ход P1
    s = battle(s, P1); // → ход P2, ниндзя снова ударил в лицо
    expect(s.spellBansActive.some((b) => b.player === P2 && b.turn === s.turn)).toBe(true);
    // Убираем ниндзя — на следующем своём ходу P2 играет заклинания.
    s = battle(s, P2);
    s = battle(s, P1);
    s = edit(s, (d) => {
      d.instances[ninjaId]!.location = 'discard';
      const zone = d.players[P1]!.zones[0]!;
      if (zone.creature === ninjaId) zone.creature = null;
      d.spellBansArmed = [];
      d.spellBansActive = [];
    });
    s = battle(s, P2); // → ход P1
    s = battle(s, P1); // → ход P2
    s = forceToHand(s, P2, 'spell-draw');
    const ok = turn(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'spell-draw') });
    expect(ok.status).toBe('running');
  });
});
