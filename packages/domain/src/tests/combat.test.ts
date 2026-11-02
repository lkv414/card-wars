import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, type MatchState } from '../index';
import { catalog, defaultConfig, forceToHand, handCardId, P1, P2 } from './helpers';
import { startedMatch } from './engine.test';

const deps = { config: defaultConfig, catalog };

function ok(s: MatchState, cmd: Command) {
  const res = applyCommand(s, cmd, deps);
  if (!res.ok) throw new Error(`${cmd.type}: ${res.rejected.code} — ${res.rejected.message}`);
  return res;
}

/** Ставит существо игроку в зону (свой ход соблюдается вызывающим кодом). */
function deploy(s: MatchState, player: string, cardId: string, zone: number): MatchState {
  const withCard = forceToHand(s, player, cardId);
  return ok(withCard, { type: 'play_card', player, instanceId: handCardId(withCard, player, cardId), zone }).state;
}

describe('бой', () => {
  it('зеркальное сопоставление зон: моя зона 1 бьётся с его зоной 4', () => {
    // p1: существо в зоне 0 (внутр. индекс); p2: существо в зоне 3 — зеркальная пара
    let s = startedMatch();
    s = deploy(s, P1, 'vanilla-swamp', 0); // 2/6
    s = ok(s, { type: 'go_battle', player: P1 }).state; // круг 1: p1 не атакует
    s = deploy(s, P2, 'vanilla-corn', 3); // 3/7
    const res = ok(s, { type: 'go_battle', player: P2 });
    s = res.state;
    // p2 (последний игрок) атакует в первом круге: его зона 3 → моя зона 0
    const p1Creature = s.players[P1]!.zones[0]!.creature!;
    const p2Creature = s.players[P2]!.zones[3]!.creature!;
    expect(s.instances[p1Creature]!.damage).toBe(3); // получил 3 от corn 3/7
    expect(s.instances[p2Creature]!.damage).toBe(2); // ответный урон 2
    expect(s.players[P1]!.lives).toBe(25);
    expect(s.players[P2]!.lives).toBe(25);
  });

  it('пустая зона защищающегося — урон в жизни', () => {
    let s = startedMatch();
    s = ok(s, { type: 'go_battle', player: P1 }).state;
    s = deploy(s, P2, 'vanilla-corn', 0); // 3/7, никого напротив
    s = ok(s, { type: 'go_battle', player: P2 }).state;
    expect(s.players[P1]!.lives).toBe(25 - 3);
  });

  it('в первом круге атакует только последний игрок; со второго — все', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'vanilla-swamp', 0);
    s = ok(s, { type: 'go_battle', player: P1 }).state; // круг 1: p1 не атакует
    expect(s.players[P2]!.lives).toBe(25);
    const p1CreatureBefore = s.players[P1]!.zones[0]!.creature!;
    expect(s.instances[p1CreatureBefore]!.damage).toBe(0);
    s = deploy(s, P2, 'vanilla-corn', 3);
    s = ok(s, { type: 'go_battle', player: P2 }).state; // p2 (последний) атакует
    // напротив стоит существо p1 — урон в существо, жизни целы
    expect(s.players[P1]!.lives).toBe(25);
    expect(s.instances[p1CreatureBefore]!.damage).toBe(3);
    // круг 2: теперь p1 тоже атакует — существо p2 получает ответный урон от прошлой атаки уже есть
    const p2Creature = s.players[P2]!.zones[3]!.creature!;
    const damageBefore = s.instances[p2Creature]!.damage;
    s = ok(s, { type: 'go_battle', player: P1 }).state;
    expect(s.instances[p2Creature]!.damage).toBeGreaterThan(damageBefore);
  });

  it('существо уничтожается при уроне ≥ защиты и уходит в сброс', () => {
    let s = startedMatch();
    // p1: vanilla-sand 4/4 в зоне 3; p2: big-swamp 5/10 в зоне 0 — зеркальная пара
    s = deploy(s, P1, 'vanilla-sand', 3);
    s = ok(s, { type: 'go_battle', player: P1 }).state;
    s = deploy(s, P2, 'big-swamp', 0);
    const res = ok(s, { type: 'go_battle', player: P2 });
    s = res.state;
    expect(s.players[P1]!.zones[3]!.creature).toBeNull(); // sand уничтожен (5 ≥ 4)
    const sandInDiscard = s.players[P1]!.discard.find((i) => s.instances[i]!.cardId === 'vanilla-sand');
    expect(sandInDiscard).toBeDefined();
    expect(res.events.some((e) => e.type === 'creature_destroyed' && e.cardId === 'vanilla-sand')).toBe(true);
    // big-swamp получил ответный урон 4 (бой одновременный)
    const bigId = s.players[P2]!.zones[0]!.creature!;
    expect(s.instances[bigId]!.damage).toBe(4);
  });

  it('флипнутое существо не нападает, но защищается', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'vanilla-blue', 0); // 2/8
    // ход p1 круг 1 — флюпить нельзя (первый игрок), пропускаем до круга 2
    s = ok(s, { type: 'go_battle', player: P1 }).state;
    s = deploy(s, P2, 'vanilla-corn', 3);
    s = ok(s, { type: 'go_battle', player: P2 }).state; // атака p2: blue получил 3
    expect(s.activePlayer).toBe(P1);
    expect(s.round).toBe(2);
    // механика флипа: помечаем существо флипнутым (способностей-флюпов пока нет, docs/TECH.md № 2)
    const blueId = s.players[P1]!.zones[0]!.creature!;
    s = produce(s, (d) => {
      d.instances[blueId]!.flipped = true;
    });
    const res = ok(s, { type: 'go_battle', player: P1 });
    s = res.state;
    // p1 не атаковал: жизни p2 целы; урон corn не вырос (прошлый ответный уже был)
    expect(s.players[P2]!.lives).toBe(25);
    expect(s.instances[s.players[P2]!.zones[3]!.creature!]!.damage).toBe(2);
    // но защищаться флипнутое может: p2 атакует снова — ответный урон от флипнутого
    const res2 = ok(s, { type: 'go_battle', player: P2 });
    expect(res2.state.instances[res2.state.players[P2]!.zones[3]!.creature!]!.damage).toBe(4);
  });

  it('щит поглощает урон первым', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'vanilla-swamp', 0); // 2/6
    s = ok(s, { type: 'go_battle', player: P1 }).state; // круг 1, p1 не атакует
    s = deploy(s, P2, 'vanilla-corn', 3);
    s = ok(s, { type: 'go_battle', player: P2 }).state; // corn бьёт: 3 урона в плоть
    // ход p1, круг 2: выдаём щит напрямую (щит даётся способностями — docs/TECH.md № 2)
    const shieldedId = s.players[P1]!.zones[0]!.creature!;
    s = produce(s, (d) => {
      d.instances[shieldedId]!.shield = 2;
      d.instances[shieldedId]!.flipped = true; // чтобы p1 не атаковал
    });
    s = ok(s, { type: 'go_battle', player: P1 }).state; // флипнутое не атакует
    // p2 бьёт снова: 3 урона → 2 в щит, 1 в плоть
    const battle = ok(s, { type: 'go_battle', player: P2 });
    s = battle.state;
    expect(s.instances[shieldedId]!.shield).toBe(0);
    expect(s.instances[shieldedId]!.damage).toBe(3 + 1);
    const shieldEvent = battle.events.find((e) => e.type === 'damage_dealt' && e.targetInstanceId === shieldedId && e.absorbedByShield > 0);
    expect(shieldEvent).toBeDefined();
  });

  it('таймер истёк — автоматический переход в бой', () => {
    let s = startedMatch();
    s = deploy(s, P1, 'vanilla-swamp', 0);
    const res = ok(s, { type: 'time_expired', player: P1 });
    s = res.state;
    expect(res.events).toContainEqual({ type: 'timer_expired', player: P1 });
    expect(s.activePlayer).toBe(P2); // ход перешёл
    expect(s.players[P2]!.lives).toBe(25); // круг 1: p1 не атаковал
  });

  it('стройка не нападает', () => {
    let s = startedMatch();
    s = ok(s, { type: 'go_battle', player: P1 }).state;
    s = deploy(s, P2, 'plain-fortress', 0); // строение, не существо
    s = ok(s, { type: 'go_battle', player: P2 }).state;
    expect(s.players[P1]!.lives).toBe(25);
  });
});
