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
