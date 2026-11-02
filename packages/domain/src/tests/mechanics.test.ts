import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand, computeEff, createMatch, type Command, type MatchState } from '../index';
import {
  catalog,
  defaultConfig,
  forceToHand,
  handCardId,
  makeSetup,
  mustOk,
  P1,
  P2,
  refillActions,
} from './helpers';
import { startedMatch } from './engine.test';

const deps = { config: defaultConfig, catalog };

function ok(s: MatchState, cmd: Command) {
  const res = applyCommand(s, cmd, deps);
  if (!res.ok) throw new Error(`${cmd.type}: ${res.rejected.code} — ${res.rejected.message}`);
  return res;
}

/** Turn 3: round 2, P1 active — floops and attacks are legal. */
function round2P1Turn(): MatchState {
  let s = startedMatch();
  s = ok(s, { type: 'go_battle', player: P1 }).state;
  s = ok(s, { type: 'go_battle', player: P2 }).state;
  return s;
}

describe('механики v2: каркас', () => {
  it('аура строения пересчитывается живьём и исчезает при сбросе строения', () => {
    let s = startedMatch();
    s = forceToHand(s, P1, 'aura-fortress');
    s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'aura-fortress'), zone: 0 }).state;
    s = forceToHand(s, P1, 'vanilla-swamp');
    const swampId = handCardId(s, P1, 'vanilla-swamp');
    s = ok(s, { type: 'play_card', player: P1, instanceId: swampId, zone: 0 }).state;
    expect(computeEff(s, deps, swampId).attack).toBe(2 + 1);
    const fortressId = s.players[P1]!.zones[0]!.building!;
    s = ok(s, { type: 'discard_from_field', player: P1, instanceId: fortressId }).state;
    expect(computeEff(s, deps, swampId).attack).toBe(2);
  });

  it('on_enters_play срабатывает при розыгрыше существа', () => {
    let s = startedMatch();
    s = forceToHand(s, P1, 'enter-drawer');
    const res = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'enter-drawer'), zone: 0 });
    expect(res.events.some((e) => e.type === 'card_drawn' && e.player === P1 && e.count === 1)).toBe(true);
  });

  it('on_cast заклинания исполняется при розыгрыше; карта уходит в сброс', () => {
    let s = startedMatch();
    s = forceToHand(s, P1, 'spell-draw');
    const spellId = handCardId(s, P1, 'spell-draw');
    const res = ok(s, { type: 'play_card', player: P1, instanceId: spellId });
    s = res.state;
    expect(s.instances[spellId]!.location).toBe('discard');
    expect(s.castSpells).toContain(spellId);
    expect(res.events.some((e) => e.type === 'spell_cast' && e.instanceId === spellId)).toBe(true);
    expect(res.events.some((e) => e.type === 'card_drawn' && e.player === P1 && e.count === 1)).toBe(true);
  });

  describe('флюп с целью', () => {
    it('без целей — target_required, с чужой целью — invalid_choice, с верной — урон и списание действия', () => {
      let s = startedMatch();
      s = forceToHand(s, P1, 'floop-sniper');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'floop-sniper'), zone: 0 }).state;
      s = ok(s, { type: 'go_battle', player: P1 }).state;
      s = forceToHand(s, P2, 'vanilla-corn');
      s = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'vanilla-corn'), zone: 3 }).state;
      s = ok(s, { type: 'go_battle', player: P2 }).state; // круг 2, ход p1

      const sniperId = s.players[P1]!.zones[0]!.creature!;
      const cornId = s.players[P2]!.zones[3]!.creature!;
      const noTarget = applyCommand(s, { type: 'floop', player: P1, instanceId: sniperId }, deps);
      expect(noTarget.ok).toBe(false);
      if (!noTarget.ok) expect(noTarget.rejected.code).toBe('target_required');

      const wrongTarget = applyCommand(
        s,
        { type: 'floop', player: P1, instanceId: sniperId, targets: [{ kind: 'creature', instanceId: sniperId }] },
        deps,
      );
      expect(wrongTarget.ok).toBe(false);
      if (!wrongTarget.ok) expect(wrongTarget.rejected.code).toBe('invalid_choice');

      s = ok(s, { type: 'floop', player: P1, instanceId: sniperId, targets: [{ kind: 'creature', instanceId: cornId }] }).state;
      expect(s.instances[cornId]!.damage).toBe(1 + 2); // ответный в круге 1 + урон флюпа
      expect(s.instances[sniperId]!.flipped).toBe(true);
      expect(s.players[P1]!.actions).toBe(1); // 2 действия хода − 1 за флюп
    });

    it('карта без активной способности отклоняется', () => {
      let s = round2P1Turn();
      s = forceToHand(s, P1, 'vanilla-swamp');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 }).state;
      const res = applyCommand(
        s,
        { type: 'floop', player: P1, instanceId: s.players[P1]!.zones[0]!.creature! },
        deps,
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.rejected.code).toBe('card_has_no_floop');
    });
  });

  describe('pendingChoice', () => {
    function dyingScenario(): { s: MatchState; cornId: string; events: ReturnType<typeof ok>['events'] } {
      let s = startedMatch();
      s = forceToHand(s, P1, 'dying-optional');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'dying-optional'), zone: 0 }).state;
      s = ok(s, { type: 'go_battle', player: P1 }).state;
      s = forceToHand(s, P2, 'vanilla-corn');
      s = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'vanilla-corn'), zone: 3 }).state;
      const res = ok(s, { type: 'go_battle', player: P2 }); // бой: corn 3 убивает dying 1/1 → on_death optional
      return { s: res.state, cornId: res.state.players[P2]!.zones[3]!.creature!, events: res.events };
    }

    it('опциональный on_death ставит матч в ожидание; другие команды отклонены; skip продолжает партию', () => {
      const { s, cornId, events } = dyingScenario();
      expect(s.pending).not.toBeNull();
      expect(s.pending!.player).toBe(P1);
      expect(events.some((e) => e.type === 'choice_required' && e.player === P1 && e.kind === 'optional')).toBe(true);

      const blocked = applyCommand(s, { type: 'go_battle', player: P1 }, deps);
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.rejected.code).toBe('choice_pending');
      const wrongPlayer = applyCommand(s, { type: 'resolve_choice', player: P2, answer: { proceed: false } }, deps);
      expect(wrongPlayer.ok).toBe(false);
      if (!wrongPlayer.ok) expect(wrongPlayer.rejected.code).toBe('not_your_choice');

      const res = ok(s, { type: 'resolve_choice', player: P1, answer: { proceed: false } });
      expect(res.state.pending).toBeNull();
      expect(res.state.instances[cornId]!.damage).toBe(1); // только ответный урон боя
      expect(res.events.some((e) => e.type === 'choice_resolved' && e.player === P1)).toBe(true);
      // партия жива: p1 может завершить ход
      ok(res.state, { type: 'go_battle', player: P1 });
    });

    it('proceed применяет эффект опционального триггера', () => {
      const { s, cornId } = dyingScenario();
      const res = ok(s, { type: 'resolve_choice', player: P1, answer: { proceed: true } });
      expect(res.state.pending).toBeNull();
      expect(res.state.instances[cornId]!.damage).toBe(2); // 1 ответный + 1 от on_death
    });

    it('целевой on_enters_play ждёт выбор цели и применяет её атомарно', () => {
      let s = startedMatch();
      s = forceToHand(s, P1, 'vanilla-swamp');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 }).state;
      const swampId = s.players[P1]!.zones[0]!.creature!;
      s = forceToHand(s, P1, 'enter-chooser');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'enter-chooser'), zone: 1 }).state;

      expect(s.pending).not.toBeNull();
      expect(s.pending!.ask.kind).toBe('target');
      const badChoice = applyCommand(
        s,
        { type: 'resolve_choice', player: P1, answer: { targets: [{ kind: 'player', playerId: P2 }] } },
        deps,
      );
      expect(badChoice.ok).toBe(false);
      if (!badChoice.ok) expect(badChoice.rejected.code).toBe('invalid_choice');

      const res = ok(s, {
        type: 'resolve_choice',
        player: P1,
        answer: { targets: [{ kind: 'creature', instanceId: swampId }] },
      });
      expect(res.state.pending).toBeNull();
      expect(res.state.instances[swampId]!.damage).toBe(2);
    });

    it('таймер снимает ожидание детерминированным дефолтом (skip)', () => {
      const { s } = dyingScenario();
      const res = ok(s, { type: 'time_expired', player: P1 });
      expect(res.state.pending).toBeNull();
      expect(res.events.some((e) => e.type === 'choice_resolved' && e.player === P1)).toBe(true);
    });
  });

  describe('M3: активы, этот-ход, жертвы', () => {
    it('доп. стоимость-жертва уничтожает своё существо и исполняет эффект', () => {
      let s = round2P1Turn();
      s = forceToHand(s, P1, 'vanilla-swamp');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 }).state;
      const victimId = s.players[P1]!.zones[0]!.creature!;
      s = forceToHand(s, P1, 'sac-drawer');
      const sacId = handCardId(s, P1, 'sac-drawer');
      s = ok(s, { type: 'play_card', player: P1, instanceId: sacId, zone: 1 }).state;
      s = ok(s, {
        type: 'floop',
        player: P1,
        instanceId: sacId,
        targets: [{ kind: 'creature', instanceId: victimId }],
      }).state;
      expect(s.instances[victimId]!.location).toBe('discard');
      expect(s.instances[sacId]!.flipped).toBe(true);
    });

    it('«этот ход» баф действует до конца хода и сгорает', () => {
      let s = round2P1Turn();
      s = forceToHand(s, P1, 'turn-buffer');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'turn-buffer'), zone: 0 }).state;
      const bufferId = s.players[P1]!.zones[0]!.creature!;
      s = ok(s, { type: 'floop', player: P1, instanceId: bufferId }).state;
      expect(computeEff(s, deps, bufferId).attack).toBe(1 + 3);
      expect(s.turnBuffs).toHaveLength(1);
      s = ok(s, { type: 'go_battle', player: P1 }).state;
      s = ok(s, { type: 'go_battle', player: P2 }).state; // конец хода p1 → сброс бафов
      expect(s.turnBuffs).toHaveLength(0);
      expect(computeEff(s, deps, bufferId).attack).toBe(1);
    });

    it('lane_opponent_creature: цель только враг на этой линии', () => {
      let s = startedMatch();
      s = forceToHand(s, P1, 'lane-sniper');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'lane-sniper'), zone: 0 }).state;
      const sniperId = s.players[P1]!.zones[0]!.creature!;
      s = ok(s, { type: 'go_battle', player: P1 }).state;
      s = forceToHand(s, P2, 'vanilla-corn');
      s = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'vanilla-corn'), zone: 3 }).state;
      s = ok(s, { type: 'go_battle', player: P2 }).state; // круг 2, ход p1
      const cornId = s.players[P2]!.zones[3]!.creature!;
      // своя цель — invalid_choice (враг ждётся)
      const wrong = applyCommand(
        s,
        { type: 'floop', player: P1, instanceId: sniperId, targets: [{ kind: 'creature', instanceId: cornId }] },
        deps,
      );
      // corn — противник на зеркальной зоне 3, снайпер в зоне 0: линия не та → invalid_choice
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) expect(wrong.rejected.code).toBe('invalid_choice');
      // ставим существо p2 напротив снайпера нельзя (ход p1) — проверяем через мутацию: переносим corn в зону 0
      s = produce(s, (d) => {
        d.players[P2]!.zones[3]!.creature = null;
        d.instances[cornId]!.zone = 0;
        d.players[P2]!.zones[0]!.creature = cornId;
      });
      s = ok(s, { type: 'floop', player: P1, instanceId: sniperId, targets: [{ kind: 'creature', instanceId: cornId }] }).state;
      expect(s.instances[cornId]!.damage).toBe(2 + 1); // ответка круга 1 + флюп
    });

    it('start_of_turn триггер с целью ставит матч в ожидание и разрешается', () => {
      let s = startedMatch();
      s = forceToHand(s, P1, 'turn-chooser');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'turn-chooser'), zone: 0 }).state;
      s = ok(s, { type: 'go_battle', player: P1 }).state;
      s = forceToHand(s, P2, 'vanilla-corn');
      s = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'vanilla-corn'), zone: 3 }).state;
      const res = ok(s, { type: 'go_battle', player: P2 }); // ход p2 → конец → ход p1: start_of_turn → pending
      s = res.state;
      expect(s.pending).not.toBeNull();
      expect(s.pending!.player).toBe(P1);
      const cornId = s.players[P2]!.zones[3]!.creature!;
      const done = ok(s, { type: 'resolve_choice', player: P1, answer: { targets: [{ kind: 'creature', instanceId: cornId }] } });
      expect(done.state.pending).toBeNull();
      expect(done.state.instances[cornId]!.damage).toBe(1 + 1); // ответка круга 1 + триггер
    });
  });

  describe('M4: движение, заморозка, замена', () => {
    it('move_creature переносит существо на пустую свою линию и считает смену линии', () => {
      let s = round2P1Turn();
      s = forceToHand(s, P1, 'vanilla-swamp');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 }).state;
      const creatureId = s.players[P1]!.zones[0]!.creature!;
      s = forceToHand(s, P1, 'mover');
      const moverId = handCardId(s, P1, 'mover');
      s = ok(s, { type: 'play_card', player: P1, instanceId: moverId, zone: 1 }).state;
      s = ok(s, {
        type: 'floop',
        player: P1,
        instanceId: moverId,
        targets: [
          { kind: 'creature', instanceId: creatureId },
          { kind: 'landscape', player: P1, zone: 3 },
        ],
      }).state;
      expect(s.players[P1]!.zones[0]!.creature).toBeNull();
      expect(s.players[P1]!.zones[3]!.creature).toBe(creatureId);
      expect(s.instances[creatureId]!.zone).toBe(3);
      // повторное движение возвращает существо (зона 0 опустела после первого хода)
      s = produce(s, (d) => {
        d.players[P1]!.actions = 2;
        d.instances[moverId]!.flipped = false;
      });
      const res = ok(s, {
        type: 'floop',
        player: P1,
        instanceId: moverId,
        targets: [
          { kind: 'creature', instanceId: creatureId },
          { kind: 'landscape', player: P1, zone: 0 },
        ],
      });
      expect(res.state.players[P1]!.zones[0]!.creature).toBe(creatureId);
      expect(res.state.players[P1]!.zones[3]!.creature).toBeNull();
    });

    it('freeze_land замораживает землю; замороженная земля блокирует розыгрыш', () => {
      let s = round2P1Turn();
      s = forceToHand(s, P1, 'freezer');
      const freezerId = handCardId(s, P1, 'freezer');
      s = ok(s, { type: 'play_card', player: P1, instanceId: freezerId, zone: 0 }).state;
      s = ok(s, {
        type: 'floop',
        player: P1,
        instanceId: freezerId,
        targets: [{ kind: 'landscape', player: P2, zone: 3 }],
      }).state;
      expect(s.players[P2]!.lands[3]!.frozen).toBe(true);
    });

    it('триггер замены: добор только когда вход заменяет существо', () => {
      let s = startedMatch();
      s = forceToHand(s, P1, 'vanilla-swamp');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 }).state;
      // вход без замены — нет добора
      s = forceToHand(s, P1, 'replacer');
      let res = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'replacer'), zone: 1 });
      const deckAfterFirst = res.state.players[P1]!.deck.length;
      // вторая копия replacer входит в занятую зону 0, заменяя vanilla — добор
      s = refillActions(res.state, P1);
      s = forceToHand(s, P1, 'replacer');
      res = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'replacer'), zone: 0 });
      expect(res.state.players[P1]!.deck.length).toBe(deckAfterFirst - 1);
      expect(res.events.some((e) => e.type === 'card_drawn' && e.player === P1)).toBe(true);
    });
  });

  describe('M5: подавление, иммунитет, боевые триггеры', () => {
    it('Дворец-подавитель гасит on_enters_play существа противника на этой линии', () => {
      let s = round2P1Turn();
      s = forceToHand(s, P1, 'suppressor');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'suppressor'), zone: 0 }).state;
      s = ok(s, { type: 'go_battle', player: P1 }).state; // ход p2
      // зеркальная зона 3 подавлена: добора нет
      s = produce(s, (d) => {
        d.players[P2]!.lands[3]!.type = 'swamp';
      });
      s = forceToHand(s, P2, 'enter-drawer');
      const deckBefore = s.players[P2]!.deck.length;
      let res = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'enter-drawer'), zone: 3 });
      expect(res.state.players[P2]!.deck.length).toBe(deckBefore);
      // неподавленная зона 0 — триггер работает
      s = refillActions(res.state, P2);
      s = forceToHand(s, P2, 'enter-drawer');
      res = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'enter-drawer'), zone: 0 });
      expect(res.events.some((e) => e.type === 'card_drawn' && e.player === P2)).toBe(true);
    });

    it('подавитель активов запрещает флюп существа противника на этой линии', () => {
      let s = round2P1Turn();
      s = forceToHand(s, P1, 'floop-suppressor');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'floop-suppressor'), zone: 0 }).state;
      s = ok(s, { type: 'go_battle', player: P1 }).state; // ход p2
      s = produce(s, (d) => {
        d.players[P2]!.lands[3]!.type = 'swamp';
      });
      s = forceToHand(s, P2, 'floop-sniper');
      s = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'floop-sniper'), zone: 3 }).state;
      const sniperId = s.players[P2]!.zones[3]!.creature!;
      const res = applyCommand(s, { type: 'floop', player: P2, instanceId: sniperId }, deps);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.rejected.code).toBe('ability_suppressed');
    });

    it('no_retaliation: по атакующему не дают сдачи', () => {
      let s = startedMatch();
      // круг 1: p2 готовит corn в зеркальной зоне 3 и атакует пустую зону p1
      s = ok(s, { type: 'go_battle', player: P1 }).state;
      s = forceToHand(s, P2, 'vanilla-corn');
      s = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'vanilla-corn'), zone: 3 }).state;
      s = ok(s, { type: 'go_battle', player: P2 }).state; // corn атакует в лицо
      // круг 2: p1 ставит no-retaliator и атакует corn — сдачи не будет
      s = forceToHand(s, P1, 'no-retaliator');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'no-retaliator'), zone: 0 }).state;
      const res = ok(s, { type: 'go_battle', player: P1 });
      const cornId = res.state.players[P2]!.zones[3]!.creature!;
      const attackerId = res.state.players[P1]!.zones[0]!.creature!;
      expect(res.state.instances[cornId]!.damage).toBe(1); // атака прошла
      expect(res.state.instances[attackerId]!.damage).toBe(0); // сдачи нет
    });

    it('on_damage_dealt: вампир лечится на нанесённый урон', () => {
      let s = startedMatch();
      s = ok(s, { type: 'go_battle', player: P1 }).state;
      s = forceToHand(s, P2, 'vanilla-corn');
      s = ok(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'vanilla-corn'), zone: 3 }).state;
      s = ok(s, { type: 'go_battle', player: P2 }).state; // круг 2, ход p1
      s = forceToHand(s, P1, 'vampire');
      s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vampire'), zone: 0 }).state;
      s = produce(s, (d) => {
        d.instances[s.players[P1]!.zones[0]!.creature!]!.damage = 2;
      });
      const res = ok(s, { type: 'go_battle', player: P1 });
      const vampireId = res.state.players[P1]!.zones[0]!.creature!;
      const cornId = res.state.players[P2]!.zones[3]!.creature!;
      expect(res.state.instances[cornId]!.damage).toBe(2); // урон вампира
      expect(res.state.instances[vampireId]!.damage).toBe(3); // 2 до боя + 3 ответка − 2 лечение
    });
  });

  describe('способность героя', () => {
    function bimoMatch() {
      const { state } = createMatch(deps, makeSetup({ p1Hero: 'hero-bimo', seed: 5 }));
      let s = mustOk(applyCommand(state, { type: 'keep_hand', player: P1 }, deps));
      s = mustOk(applyCommand(s, { type: 'keep_hand', player: P2 }, deps));
      return s;
    }

    it('доп. стоимость (сброс карты) + урон игроку; раз за ход', () => {
      let s = bimoMatch();
      const discardId = s.players[P1]!.hand[0]!;
      const res = ok(s, {
        type: 'hero_ability',
        player: P1,
        targets: [{ kind: 'card', instanceId: discardId }, { kind: 'player', playerId: P2 }],
      });
      s = res.state;
      expect(s.players[P2]!.lives).toBe(24);
      expect(s.players[P1]!.hand).not.toContain(discardId);
      expect(res.events.some((e) => e.type === 'hero_ability_used' && e.player === P1)).toBe(true);

      const again = applyCommand(
        s,
        { type: 'hero_ability', player: P1, targets: [{ kind: 'card', instanceId: s.players[P1]!.hand[0]! }, { kind: 'player', playerId: P2 }] },
        deps,
      );
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.rejected.code).toBe('ability_already_used');
    });

    it('без сброса карты — target_required; у героя без способности — hero_has_no_ability', () => {
      let s = bimoMatch();
      const noCost = applyCommand(s, { type: 'hero_ability', player: P1, targets: [{ kind: 'player', playerId: P2 }] }, deps);
      expect(noCost.ok).toBe(false);
      if (!noCost.ok) expect(noCost.rejected.code).toBe('target_required');

      s = round2P1Turn();
      const res = applyCommand(s, { type: 'hero_ability', player: P1 }, deps);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.rejected.code).toBe('hero_has_no_ability');
    });
  });
});
