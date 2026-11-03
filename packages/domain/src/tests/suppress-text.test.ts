import { describe, expect, it } from 'vitest';
import { applyCommand, computeEff, type Command, type MatchState } from '../index';
import { catalog, defaultConfig, forceToHand, handCardId, mustOk, P1, P2, refillActions } from './helpers';
import { startedMatch } from './engine.test';

const deps = { config: defaultConfig, catalog };

/** Edit helper: MatchState is plain JSON (docs/MECHANICS-V2.md §10). */
function edit(state: MatchState, fn: (draft: MatchState) => void): MatchState {
  const draft = JSON.parse(JSON.stringify(state)) as MatchState;
  fn(draft);
  return draft;
}

/** Place a card from the deck straight into a field slot (opponent placement). */
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

function placeBuilding(s: MatchState, playerId: string, zone: number, cardId: string): MatchState {
  return edit(s, (d) => {
    const p = d.players[playerId]!;
    const deckId = p.deck[0]!;
    p.deck = p.deck.filter((id) => id !== deckId);
    d.instances[deckId]!.cardId = cardId;
    d.instances[deckId]!.location = 'field';
    d.instances[deckId]!.zone = zone;
    d.instances[deckId]!.slot = 'building';
    d.instances[deckId]!.playedTurn = d.turn;
    p.zones[zone]!.building = deckId;
  });
}

/** Move one deck copy of cardId into the discard pile. */
function toDiscard(s: MatchState, playerId: string, cardId: string): MatchState {
  return edit(s, (d) => {
    const p = d.players[playerId]!;
    let id = p.deck.find((i) => d.instances[i]!.cardId === cardId);
    if (!id) {
      id = p.deck[0]!;
      d.instances[id]!.cardId = cardId;
    }
    p.deck = p.deck.filter((x) => x !== id);
    d.instances[id]!.location = 'discard';
    p.discard.push(id);
  });
}

function turn(s: MatchState, command: Command): MatchState {
  return mustOk(applyCommand(s, command, deps));
}

function battle(s: MatchState, player: string): MatchState {
  return turn(s, { type: 'go_battle', player });
}

/** Round 2, P1 active: floops are legal (both players passed battle). */
function round2(s: MatchState): MatchState {
  return battle(battle(s, P1), P2);
}

describe('suppress all — «без текста» (Пес)', () => {
  it('строение противника в линии теряет ауру, пока Пес применён', () => {
    // Зеркальные линии: зона 0 P1 смотрит в зону 3 P2 (mirrorZoneIndex).
    let s = round2(startedMatch());
    s = placeBuilding(s, P2, 3, 'aura-fortress'); // +1 ATK своей линии
    s = placeInZone(s, P2, 3, 'vanilla-swamp');
    s = placeInZone(s, P1, 0, 'vanilla-swamp');
    const victimId = s.players[P2]!.zones[3]!.creature!;
    expect(computeEff(s, deps, victimId).attack).toBe(2 + 1); // аура строения жива

    s = forceToHand(s, P1, 'textless-dog');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'textless-dog'), zone: 0 });
    const dogId = s.players[P1]!.zones[0]!.creature!;
    s = turn(s, { type: 'floop', player: P1, instanceId: dogId });
    // Строение «без текста»: аура исчезла.
    expect(computeEff(s, deps, victimId).attack).toBe(2);
    // Пока Пес применён — подавление держится; после конца хода возвращается.
    s = battle(s, P1);
    s = battle(s, P2);
    s = battle(s, P1);
    s = battle(s, P2);
    expect(computeEff(s, deps, victimId).attack).toBe(2 + 1);
  });
});

describe('механика grant_random_discard_active (Школа)', () => {
  it('существо линии теряет свои способности и получает приём из сброса до конца хода', () => {
    let s = round2(startedMatch());
    s = placeInZone(s, P1, 0, 'turn-buffer'); // свой актив: +3 АТК в этот ход
    s = placeInZone(s, P2, 0, 'vanilla-swamp');
    s = toDiscard(s, P1, 'floop-sniper'); // приём из сброса: 2 урона по выбору

    s = forceToHand(s, P1, 'school-building');
    const schoolId = handCardId(s, P1, 'school-building');
    s = turn(s, { type: 'play_card', player: P1, instanceId: schoolId, zone: 0 });
    s = turn(s, { type: 'floop', player: P1, instanceId: schoolId });

    const creatureId = s.players[P1]!.zones[0]!.creature!;
    const enemyId = s.players[P2]!.zones[0]!.creature!;
    // Флюп существа исполняет ВЫДАННУЮ способность (цель — как у floop-sniper).
    const foreign = applyCommand(s, { type: 'floop', player: P1, instanceId: creatureId, targets: [{ kind: 'creature', instanceId: enemyId }] }, deps);
    if (!foreign.ok) throw new Error(`floop: ${foreign.rejected.code}: ${foreign.rejected.message}`);
    s = foreign.state;
    expect(s.instances[enemyId]!.damage).toBe(2);

    // До конца хода: выданный приём работает; после — возвращается свой.
    s = battle(s, P1);
    s = battle(s, P2);
    s = battle(s, P1);
    s = battle(s, P2);
    const own = turn(s, { type: 'floop', player: P1, instanceId: creatureId });
    expect(computeEff(own, deps, creatureId).attack).toBe(1 + 3); // свой актив: +3 АТК
  });

  it('без существа с приёмом в сбросе способность ничего не делает', () => {
    let s = round2(startedMatch());
    s = placeInZone(s, P1, 0, 'turn-buffer');
    s = forceToHand(s, P1, 'school-building');
    const schoolId = handCardId(s, P1, 'school-building');
    s = turn(s, { type: 'play_card', player: P1, instanceId: schoolId, zone: 0 });
    s = turn(s, { type: 'floop', player: P1, instanceId: schoolId });
    expect(s.turnModifiers).toHaveLength(0);
    const creatureId = s.players[P1]!.zones[0]!.creature!;
    // Свой актив не подавлен — флюп существа работает как обычно.
    s = refillActions(s, P1);
    const own = turn(s, { type: 'floop', player: P1, instanceId: creatureId });
    expect(computeEff(own, deps, creatureId).attack).toBe(1 + 3); // свой актив вернулся
  });
});
