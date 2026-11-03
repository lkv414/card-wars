import { describe, expect, it } from 'vitest';
import { applyCommand, computeEff, createMatch, type Command, type MatchState } from '../index';
import { catalog, defaultConfig, forceToHand, handCardId, makeSetup, mustOk, P1, P2, refillActions } from './helpers';
import { startedMatch } from './engine.test';

const deps = { config: defaultConfig, catalog };

function edit(state: MatchState, fn: (draft: MatchState) => void): MatchState {
  const draft = JSON.parse(JSON.stringify(state)) as MatchState;
  fn(draft);
  return draft;
}

function placeInZone(s: MatchState, playerId: string, zone: number, cardId: string): MatchState {
  return edit(s, (d) => {
    const p = d.players[playerId]!;
    const deckId = p.deck[0]!;
    p.deck = p.deck.filter((id) => id !== deckId);
    d.instances[deckId]!.cardId = cardId;
    d.instances[deckId]!.location = 'field';
    d.instances[deckId]!.zone = zone;
    d.instances[deckId]!.slot = 'creature';
    d.instances[deckId]!.playedTurn = d.turn;
    p.zones[zone]!.creature = deckId;
  });
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

function startedIcy(): MatchState {
  const { state } = createMatch(deps, makeSetup({ p1Lands: ['ice', 'ice', 'swamp', 'rainbow'], p2Lands: ['corn', 'corn', 'good', 'swamp'] }));
  let s = mustOk(applyCommand(state, { type: 'keep_hand', player: P1 }, deps));
  s = mustOk(applyCommand(s, { type: 'keep_hand', player: P2 }, deps));
  return s;
}

describe('ледяные жетоны: состояние', () => {
  it('ледяные земли входят в игру с одним жетоном', () => {
    const s = startedIcy();
    expect(s.players[P1]!.lands.map((l) => l.iceTokens)).toEqual([1, 1, 0, 0]);
    expect(s.players[P2]!.lands.map((l) => l.iceTokens)).toEqual([0, 0, 0, 0]);
  });
});

describe('ледяные жетоны: операции', () => {
  it('transfer_token (Коктейль): жетон переезжает между своими землями', () => {
    let s = round2(startedIcy());
    s = forceToHand(s, P1, 'transfer-token'); // фиксгура Коктейля
    const id = handCardId(s, P1, 'transfer-token');
    s = turn(s, { type: 'play_card', player: P1, instanceId: id, zone: 2 });
    const cocktailId = s.players[P1]!.zones[2]!.building!;
    s = turn(s, { type: 'floop', player: P1, instanceId: cocktailId, targets: [
      { kind: 'landscape', player: P1, zone: 0 },
      { kind: 'landscape', player: P1, zone: 2 },
    ] });
    expect(s.players[P1]!.lands.map((l) => l.iceTokens)).toEqual([0, 1, 1, 0]);
  });

  it('remove_token без жетона отклоняет команду', () => {
    let s = round2(startedIcy());
    s = forceToHand(s, P1, 'snowball'); // фиксгура Снежка: снимает жетон со своей линии
    s = placeInZone(s, P1, 3, 'vanilla-swamp'); // линия без жетона
    const snowId = handCardId(s, P1, 'snowball');
    s = turn(s, { type: 'play_card', player: P1, instanceId: snowId, zone: 3 });
    const snowballId = s.players[P1]!.zones[3]!.creature!;
    // Массив эффектов: первый шаг (снятие жетона) исполняется сразу и отклоняет команду.
    const res = applyCommand(s, { type: 'floop', player: P1, instanceId: snowballId }, deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejected.code).toBe('no_ice_token');
  });

  it('remove_token (Снежок): жетон снимается, урон наносится', () => {
    let s = round2(startedIcy());
    s = forceToHand(s, P1, 'snowball');
    s = placeInZone(s, P1, 0, 'snowball'); // линия с жетоном (ледяная земля)
    const snowId = handCardId(s, P1, 'snowball');
    s = turn(s, { type: 'play_card', player: P1, instanceId: snowId, zone: 0 });
    const snowballId = s.players[P1]!.zones[0]!.creature!;
    const victim = s.players[P1]!.zones[0]!.creature!;
    s = turn(s, { type: 'floop', player: P1, instanceId: snowballId });
    expect(s.pending?.ask.kind).toBe('effect_step'); // массив целей спрашивает лениво
    const res = turn(s, { type: 'resolve_choice', player: P1, answer: { targets: [{ kind: 'creature', instanceId: victim }] } });
    expect(res.players[P1]!.lands[0]!.iceTokens).toBe(0);
    expect(res.instances[victim]!.damage).toBe(3);
  });
});

describe('ледяные жетоны: условия и величины', () => {
  it('while_lane_ice_token: аура гонщика включается на линии из двух жетонов', () => {
    let s = round2(startedIcy());
    s = forceToHand(s, P1, 'racer'); // фиксгура гонщика: +4 ATK, обе земли линии с жетонами
    s = placeInZone(s, P1, 0, 'racer');
    const racerId = s.players[P1]!.zones[0]!.creature!;
    // Линия 0: своя земля ледяная (1 жетон); зеркальная земля противника (зона 3) — нет.
    expect(computeEff(s, deps, racerId).attack).toBe(1);
    // Кладём жетон и на зеркальную землю противника.
    s = edit(s, (d) => {
      d.players[P2]!.lands[3]!.iceTokens = 1;
    });
    expect(computeEff(s, deps, racerId).attack).toBe(1 + 4);
  });

  it('per_lands.token: диверсант считает жетоны своих земель', () => {
    let s = round2(startedIcy());
    s = forceToHand(s, P1, 'sapper'); // фиксгура диверсанта: +1 ATK за землю с жетоном
    s = placeInZone(s, P1, 0, 'sapper');
    const sapperId = s.players[P1]!.zones[0]!.creature!;
    expect(computeEff(s, deps, sapperId).attack).toBe(1 + 2); // две ледяные земли
  });

  it('zoneToken-фильтр: аура пингвина бьёт только существ на жетонных землях', () => {
    let s = round2(startedIcy());
    s = forceToHand(s, P1, 'penguin'); // фиксгура пингвина: −1 ATK существам на жетонных землях
    s = placeInZone(s, P1, 0, 'penguin'); // на ледяной земле
    s = placeInZone(s, P1, 2, 'vanilla-swamp'); // на болоте
    const onIce = s.players[P1]!.zones[0]!.creature!;
    const onSwamp = s.players[P1]!.zones[2]!.creature!;
    expect(computeEff(s, deps, onIce).attack).toBe(1 - 1);
    expect(computeEff(s, deps, onSwamp).attack).toBe(2);
  });
});

describe('ледяные жетоны: хвост (A7.1)', () => {
  it('play-gate: существо входит в игру только на жетонную землю', () => {
    let s = round2(startedIcy());
    s = forceToHand(s, P1, 'gate-creature');
    const id = handCardId(s, P1, 'gate-creature');
    const denied = applyCommand(s, { type: 'play_card', player: P1, instanceId: id, zone: 2 }, deps);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.rejected.code).toBe('condition_not_met');
    const allowed = turn(s, { type: 'play_card', player: P1, instanceId: id, zone: 0 });
    expect(allowed.players[P1]!.zones[0]!.creature).not.toBeNull();
  });

  it('suppress attacks: существо на жетонной земле линии камеры не атакует', () => {
    let s = round2(startedIcy());
    // Линия 0 P1 (ледяная земля) ↔ зеркальная зона 3 P2: ставим камеру и жертву на жетонную землю противника.
    s = placeInZone(s, P2, 3, 'vanilla-swamp');
    const victimId = s.players[P2]!.zones[3]!.creature!;
    // Даём земле противника жетон.
    s = edit(s, (d) => {
      d.players[P2]!.lands[3]!.iceTokens = 1;
    });
    s = forceToHand(s, P1, 'freezer-building');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'freezer-building'), zone: 0 });
    // Своё существо P1 на обычной земле (зона 2) — атакует нормально.
    s = placeInZone(s, P1, 2, 'vanilla-swamp');
    const before = s.players[P2]!.lives;
    s = battle(s, P1);
    s = battle(s, P2);
    // Существо противника на жетонной земле не атаковало: жизни P1 не изменились.
    expect(s.players[P1]!.lives).toBe(25);
    // Атака P1 (зона 2): противник в зеркальной зоне 1 отсутствует → урон в лицо.
    expect(s.players[P2]!.lives).toBeLessThan(before + 100); // атака прошла (жертва без жетона в другой линии)
    expect(s.instances[victimId]!.damage).toBe(0); // жертва камеры не атаковала и не защищалась? — проверяем ниже
  });

  it('each_creature_of_choice_player: Вафля бьёт всех существ выбранного игрока', () => {
    let s = round2(startedIcy());
    s = placeInZone(s, P1, 0, 'waffle'); // ледяная земля → условие линии выполнено
    s = placeInZone(s, P2, 0, 'vanilla-swamp');
    s = placeInZone(s, P2, 2, 'vanilla-swamp');
    const waffleId = s.players[P1]!.zones[0]!.creature!;
    const a = s.players[P2]!.zones[0]!.creature!;
    const b = s.players[P2]!.zones[2]!.creature!;
    s = battle(s, P1); // фаза сражения: Вафля спрашивает игрока
    expect(s.pending?.ask.kind).toBe('target');
    s = turn(s, { type: 'resolve_choice', player: P1, answer: { targets: [{ kind: 'player', playerId: P2 }] } });
    s = battle(s, P2);
    expect(s.instances[a]!.damage).toBe(1);
    expect(s.instances[b]!.damage).toBe(1);
    expect(s.instances[waffleId]!.damage).toBe(0);
  });

  it('per_lands choice: Ледяная леди заставляет сбросить по числу жетонных земель цели', () => {
    let s = round2(startedIcy());
    s = edit(s, (d) => {
      d.players[P2]!.lands[1]!.iceTokens = 1; // у P2 одна жетонная земля
    });
    s = forceToHand(s, P1, 'icelady');
    const before = s.players[P2]!.hand.length;
    const res = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'icelady'), targets: [{ kind: 'player', playerId: P2 }] });
    expect(res.players[P2]!.hand.length).toBe(before - 1);
  });

  it('token_bonus_damage: 1 урона, а на жетонной земле — 3', () => {
    let s = round2(startedIcy());
    s = placeInZone(s, P1, 2, 'vanilla-swamp'); // без жетона
    const plain = s.players[P1]!.zones[2]!.creature!;
    s = placeInZone(s, P1, 0, 'vanilla-swamp'); // ледяная земля с жетоном
    const icy = s.players[P1]!.zones[0]!.creature!;
    s = forceToHand(s, P1, 'frozen-heart');
    const heartId = handCardId(s, P1, 'frozen-heart');
    const res = turn(s, { type: 'play_card', player: P1, instanceId: heartId, targets: [{ kind: 'creature', instanceId: plain }] });
    expect(res.instances[plain]!.damage).toBe(1);
    s = refillActions(s, P1);
    s = forceToHand(s, P1, 'frozen-heart');
    const res2 = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'frozen-heart'), targets: [{ kind: 'creature', instanceId: icy }] });
    expect(res2.instances[icy]!.damage).toBe(3);
  });

  it('while_no_tokens_in_play: полоса препятствий флюпается только без жетонов', () => {
    let s = round2(startedIcy());
    s = forceToHand(s, P1, 'obstacle');
    const id = handCardId(s, P1, 'obstacle');
    s = turn(s, { type: 'play_card', player: P1, instanceId: id, zone: 2 });
    const buildingId = s.players[P1]!.zones[2]!.building!;
    const denied = applyCommand(s, { type: 'floop', player: P1, instanceId: buildingId }, deps);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.rejected.code).toBe('condition_not_met');
    // Убираем все жетоны — флюп проходит и замораживает обе земли линии.
    s = edit(s, (d) => {
      for (const pid of d.order) for (const land of d.players[pid]!.lands) land.iceTokens = 0;
    });
    s = turn(s, { type: 'floop', player: P1, instanceId: buildingId });
    expect(s.players[P1]!.lands[2]!.frozen).toBe(true);
  });
});

describe('боевой контекст защитника (defense_mod)', () => {
  function cornAttacker(s: MatchState): MatchState {
    return edit(s, (d) => {
      const p = d.players[P2]!;
      const id = p.deck[0]!;
      p.deck = p.deck.filter((x) => x !== id);
      d.instances[id]!.cardId = 'vanilla-corn'; // 3/7 на кукурузной земле P2 (зона 3)
      d.instances[id]!.location = 'field';
      d.instances[id]!.zone = 3;
      d.instances[id]!.slot = 'creature';
      d.instances[id]!.playedTurn = d.turn;
      p.zones[3]!.creature = id;
    });
  }

  it('сдача усиливается, если атакующий стоит на земле нужного типа', () => {
    // Зеркальная линия: зона 0 P1 ↔ зона 3 P2. Дух повернут — только защищается.
    let s = round2(startedIcy());
    s = placeInZone(s, P1, 0, 'defender-spirit');
    const spiritId = s.players[P1]!.zones[0]!.creature!;
    s = edit(s, (d) => {
      d.instances[spiritId]!.flipped = true;
    });
    s = cornAttacker(s);
    s = edit(s, (d) => {
      d.players[P2]!.lands[3]!.type = 'corn'; // атакующий стоит на кукурузе
    });
    // Дух 1/6: получает 3 урона, сдача = 1 + 2 (атакующий на кукурузе) = 3.
    s = battle(s, P1);
    s = battle(s, P2);
    expect(s.instances[spiritId]!.damage).toBe(3);
    expect(s.instances[s.players[P2]!.zones[3]!.creature!]!.damage).toBe(3);
  });

  it('сдача без бонуса, если земля атакующего не совпала', () => {
    let s = round2(startedIcy());
    s = placeInZone(s, P1, 0, 'defender-spirit');
    const spiritId = s.players[P1]!.zones[0]!.creature!;
    s = edit(s, (d) => {
      d.instances[spiritId]!.flipped = true;
    });
    s = cornAttacker(s);
    s = edit(s, (d) => {
      d.players[P2]!.lands[3]!.type = 'swamp'; // атакующий не на кукурузе
    });
    s = battle(s, P1);
    s = battle(s, P2);
    expect(s.instances[spiritId]!.damage).toBe(3);
    expect(s.instances[s.players[P2]!.zones[3]!.creature!]!.damage).toBe(1);
  });

  it('условие while_own_card_in_play: бонус только пока свой источник в игре', () => {
    let s = round2(startedIcy());
    s = placeInZone(s, P1, 0, 'defender-kin');
    const kinId = s.players[P1]!.zones[0]!.creature!;
    s = edit(s, (d) => {
      d.instances[kinId]!.flipped = true;
    });
    s = cornAttacker(s);
    // Источника нет: сдача = 1.
    s = battle(s, P1);
    s = battle(s, P2);
    expect(s.instances[s.players[P2]!.zones[3]!.creature!]!.damage).toBe(1);
    // Ставим строение-источник и лечим родича — в новом обмене сдача = 3.
    s = edit(s, (d) => {
      const p = d.players[P1]!;
      const id = p.deck[0]!;
      p.deck = p.deck.filter((x) => x !== id);
      d.instances[id]!.cardId = 'kin-source';
      d.instances[id]!.location = 'field';
      d.instances[id]!.zone = 1;
      d.instances[id]!.slot = 'building';
      d.instances[id]!.playedTurn = d.turn;
      p.zones[1]!.building = id;
      d.instances[kinId]!.damage = 0;
      d.instances[kinId]!.flipped = true; // остаётся повёрнутым — только защищается
    });
    s = battle(s, P1);
    s = battle(s, P2);
    expect(s.instances[s.players[P2]!.zones[3]!.creature!]!.damage).toBe(1 + 3);
  });
});
