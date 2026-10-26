import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand, computeEff, type Command, type MatchState } from '../index';
import { catalog, defaultConfig, forceToHand, handCardId, refillActions, P1, P2 } from './helpers';
import { startedMatch } from './engine.test';

const deps = { config: defaultConfig, catalog };

function ok(s: MatchState, cmd: Command) {
  const res = applyCommand(s, cmd, deps);
  if (!res.ok) throw new Error(`${cmd.type}: ${res.rejected.code} — ${res.rejected.message}`);
  return res;
}

function deploy(s: MatchState, player: string, cardId: string, zone: number): MatchState {
  const withCard = forceToHand(s, player, cardId);
  return ok(withCard, { type: 'play_card', player, instanceId: handCardId(withCard, player, cardId), zone }).state;
}

describe('эффекты', () => {
  it('заклинание: урон сразу, карта в сброс, визуал до конца хода', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'bomber', 0); // 1/1 — цель заклинания
    const target = s.players[P1]!.zones[0]!.creature!;
    s = forceToHand(s, P2, 'spell-damage');
    // ход p1 ещё не закончился — заклинание p2 играть нельзя
    const notYours = applyCommand(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'spell-damage'), choices: { creature: target } }, deps);
    expect(notYours.ok).toBe(false);
    s = ok(s, { type: 'go_battle', player: P1 }).state;
    s = forceToHand(s, P2, 'spell-damage');
    const res = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'spell-damage'), choices: { creature: target } });
    s = res.state;
    expect(s.players[P1]!.zones[0]!.creature).toBeNull(); // 3 урона ≥ защиты 1
    expect(s.players[P2]!.discard.some((i) => s.instances[i]!.cardId === 'spell-damage')).toBe(true);
    expect(s.castSpells).toHaveLength(1);
    expect(res.events.some((e) => e.type === 'spell_cast')).toBe(true);
  });

  it('заклинание лечения: не выше максимума жизней', () => {
    let s = startedMatch();
    s = ok(s, { type: 'go_battle', player: P1 }).state;
    s = produce(s, (d) => {
      d.players[P2]!.lives = 22;
    });
    s = forceToHand(s, P2, 'spell-heal-face');
    s = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'spell-heal-face') }).state;
    expect(s.players[P2]!.lives).toBe(25);
  });

  it('заклинание: противник сбрасывает случайную карту', () => {
    let s = startedMatch();
    const p2HandBefore = s.players[P2]!.hand.length; // p2 ещё не ходил
    s = forceToHand(s, P1, 'spell-discard');
    const res = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'spell-discard'), choices: { opponent: P2 } });
    s = res.state;
    expect(s.players[P2]!.hand).toHaveLength(p2HandBefore - 1);
    expect(s.players[P2]!.discard).toHaveLength(1);
    expect(res.events.some((e) => e.type === 'card_discarded' && e.player === P2 && e.from === 'hand')).toBe(true);
  });

  it('автоматический триггер с выбранной целью не прерывает переход', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'death-pick', 0);
    const victim = s.players[P1]!.zones[0]!.creature!;
    s = forceToHand(s, P1, 'spell-damage');
    // on_death требует выбранную цель, но выбора нет — эффект пропускается,
    // команда остаётся законной (иначе бой/ход абортируется).
    const res = ok(s, {
      type: 'play_card',
      player: P1,
      instanceId: handCardId(s, P1, 'spell-damage'),
      choices: { creature: victim },
    });
    expect(res.state.players[P1]!.zones[0]!.creature).toBeNull();
  });

  it('on_enters_play лечит соседей', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'vanilla-swamp', 0);
    s = deploy(s, P1, 'vanilla-swamp', 2);
    s = produce(s, (d) => {
      for (const z of [0, 2]) {
        const id = d.players[P1]!.zones[z]!.creature!;
        d.instances[id]!.damage = 2;
      }
    });
    // healer требует good — у p1 земель good нет; даём через подмену типа земли
    s = produce(s, (d) => {
      d.players[P1]!.lands[1]!.type = 'good';
    });
    s = refillActions(s, P1);
    const withHealer = forceToHand(s, P1, 'healer');
    s = ok(withHealer, { type: 'play_card', player: P1, instanceId: handCardId(withHealer, P1, 'healer'), zone: 1 }).state;
    expect(s.instances[s.players[P1]!.zones[0]!.creature!]!.damage).toBe(1);
    expect(s.instances[s.players[P1]!.zones[2]!.creature!]!.damage).toBe(1);
  });

  it('аура строения действует на существо линии и остаётся при замене существа', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'blood-fortress', 0);
    s = deploy(s, P1, 'vanilla-swamp', 0);
    let creature = s.players[P1]!.zones[0]!.creature!;
    expect(computeEff(s, deps, creature).attack).toBe(3); // 2 + 1
    // замена существа: аура строения применяется и к новому
    s = refillActions(s, P1);
    s = forceToHand(s, P1, 'vanilla-swamp');
    s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 }).state;
    creature = s.players[P1]!.zones[0]!.creature!;
    expect(computeEff(s, deps, creature).attack).toBe(3);
    // сброс строения — аура исчезает
    const building = s.players[P1]!.zones[0]!.building!;
    s = ok(s, { type: 'discard_from_field', player: P1, instanceId: building }).state;
    expect(computeEff(s, deps, creature).attack).toBe(2);
  });

  it('отрицательная аура строения действует на существо противника напротив', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'vanilla-swamp', 3); // 2/6
    s = ok(s, { type: 'go_battle', player: P1 }).state;
    s = deploy(s, P2, 'grand-fortress', 0); // −2 ЗАЩ существу p1 в зеркальной зоне 3... зона 0 строения зеркалит зону 3 p1
    expect(computeEff(s, deps, s.players[P1]!.zones[3]!.creature!).defense).toBe(4); // 6 − 2
  });

  it('динамический бонус за каждые 5 карт в сбросе', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'discard-counter', 0); // 1/6, +1 АТК за каждые 5 карт сброса
    const counter = s.players[P1]!.zones[0]!.creature!;
    expect(computeEff(s, deps, counter).attack).toBe(1);
    s = produce(s, (d) => {
      const p = d.players[P1]!;
      for (let i = 0; i < 5; i++) {
        const id = p.deck.pop()!;
        d.instances[id]!.location = 'discard';
        p.discard.push(id);
      }
    });
    expect(computeEff(s, deps, counter).attack).toBe(2);
  });

  it('бонус «в этот ход» сгорает в конце хода', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'floop-buff-turn', 0); // 1/6, флюп +3 АТК в этот ход
    s = ok(s, { type: 'go_battle', player: P1 }).state; // круг 1, флюп запрещён первым игроком
    s = ok(s, { type: 'go_battle', player: P2 }).state; // круг 2, ход p1
    const id = s.players[P1]!.zones[0]!.creature!;
    s = ok(s, { type: 'floop', player: P1, instanceId: id }).state;
    expect(computeEff(s, deps, id).attack).toBe(4);
    s = ok(s, { type: 'go_battle', player: P1 }).state; // конец хода
    expect(computeEff(s, deps, id).attack).toBe(1);
  });

  it('возврат существа из сброса в руку', () => {
    let s = startedMatch();
    // существо в сброс p1 — через замену
    s = deploy(s, P1, 'vanilla-swamp', 0);
    s = forceToHand(s, P1, 'vanilla-swamp');
    s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 }).state;
    expect(s.players[P1]!.discard.length).toBe(1);
    // флюп возврата — со второго круга
    s = ok(s, { type: 'go_battle', player: P1 }).state;
    s = ok(s, { type: 'go_battle', player: P2 }).state;
    s = forceToHand(s, P1, 'floop-return');
    const handBefore = s.players[P1]!.hand.length;
    s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'floop-return'), zone: 1 }).state;
    const floopId = s.players[P1]!.zones[1]!.creature!;
    const res = ok(s, { type: 'floop', player: P1, instanceId: floopId });
    s = res.state;
    expect(s.players[P1]!.hand.length).toBeGreaterThan(0);
    expect(s.players[P1]!.hand.length).toBe(handBefore); // сыграли карту (−1), вернули (+1)
    expect(res.events.some((e) => e.type === 'card_returned')).toBe(true);
  });

  it('заклинание-уничтожение', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'big-swamp', 0); // 5/10
    const target = s.players[P1]!.zones[0]!.creature!;
    s = ok(s, { type: 'go_battle', player: P1 }).state;
    s = forceToHand(s, P2, 'spell-destroy');
    const res = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'spell-destroy'), choices: { creature: target } });
    expect(res.state.players[P1]!.zones[0]!.creature).toBeNull();
    expect(res.state.instances[target]!.location).toBe('discard');
  });
});
