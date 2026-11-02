import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  computeEff,
  createMatch,
  matchingLandCount,
  type CardCatalog,
  type GameConfig,
  type MatchState,
} from '@card-wars/domain';
import { catalog, deckPresets } from './index.ts';

// Golden tests: real catalog cards through the mechanics v2 pipeline
// (docs/MECHANICS-V2.md §10). State edits are plain JSON clones — MatchState
// is serializable, and direct placement isolates the ability under test.

const config: GameConfig = {
  startingLives: 25,
  teamStartingLives: 50,
  teamSize: 2,
  minPlayers: 2,
  maxPlayers: 4,
  deckSize: 40,
  startingHandSize: 5,
  mulliganCount: 1,
  actionsPerTurn: 2,
  landsPerPlayer: 4,
  landRequirementPerCard: 1,
  freeDrawsPerTurn: 1,
  extraDrawCost: 1,
  companionMaxInPlay: 1,
  copyLimit: 4,
};
const deps = { config, catalog: catalog as CardCatalog };

function newMatch(): MatchState {
  const preset = deckPresets[0]!;
  const { state } = createMatch(deps, {
    players: [
      { id: 'p1', nickname: 'P1', heroId: preset.heroId, deck: [...preset.deck], lands: [...preset.lands] },
      { id: 'p2', nickname: 'P2', heroId: deckPresets[1]!.heroId, deck: [...deckPresets[1]!.deck], lands: [...deckPresets[1]!.lands] },
    ],
    seed: 42,
  });
  let s = applyCommand(state, { type: 'keep_hand', player: 'p1' }, deps);
  expect(s.ok).toBe(true);
  if (!s.ok) throw new Error(s.rejected.message);
  s = applyCommand(s.state, { type: 'keep_hand', player: 'p2' }, deps);
  expect(s.ok).toBe(true);
  if (!s.ok) throw new Error(s.rejected.message);
  return s.state;
}

function edit(state: MatchState, fn: (draft: MatchState) => void): MatchState {
  const draft = JSON.parse(JSON.stringify(state)) as MatchState;
  fn(draft);
  return draft;
}

function forceToHand(state: MatchState, playerId: string, cardId: string): MatchState {
  return edit(state, (d) => {
    const p = d.players[playerId]!;
    if (p.hand.some((i) => d.instances[i]!.cardId === cardId)) return;
    const deckId = p.deck[0];
    const handId = p.hand[0];
    if (!deckId || !handId) throw new Error('need deck and hand cards');
    p.deck.splice(0, 1);
    p.hand.splice(p.hand.indexOf(handId), 1);
    p.deck.push(handId);
    p.hand.push(deckId);
    d.instances[handId]!.location = 'deck';
    const target = d.instances[deckId]!;
    target.location = 'hand';
    target.cardId = cardId;
  });
}

function handIdOf(state: MatchState, playerId: string, cardId: string): string {
  const id = state.players[playerId]!.hand.find((i) => state.instances[i]!.cardId === cardId);
  if (!id) throw new Error(`no ${cardId} in hand`);
  return id;
}

function cardIdOf(state: MatchState, instanceId: string): string {
  return state.instances[instanceId]!.cardId;
}

describe('golden: ауры и модификаторы (M2)', () => {
  it('Крепость Крови: +1 ATK существу своей линии, живой пересчёт', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lands = [
        { type: 'rainbow', frozen: false, flipped: false },
        { type: 'blue', frozen: false, flipped: false },
        { type: 'blue', frozen: false, flipped: false },
        { type: 'blue', frozen: false, flipped: false },
      ];
      d.players.p1!.actions = 10;
    });
    s = forceToHand(s, 'p1', 'bmo_card_6');
    const res = applyCommand(s, { type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'bmo_card_6'), zone: 0 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    s = forceToHand(res.state, 'p1', 'bmo_card_12');
    const res2 = applyCommand(s, { type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'bmo_card_12'), zone: 0 }, deps);
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    const creatureId = res2.state.players.p1!.zones[0]!.creature!;
    expect(computeEff(res2.state, deps, creatureId).attack).toBe(3 + 1);
    // сброс строения убирает ауру
    const fortressId = res2.state.players.p1!.zones[0]!.building!;
    const res3 = applyCommand(res2.state, { type: 'discard_from_field', player: 'p1', instanceId: fortressId }, deps);
    expect(res3.ok).toBe(true);
    if (!res3.ok) return;
    expect(computeEff(res3.state, deps, creatureId).attack).toBe(3);
  });

  it('Темный ангел: +1 ATK за каждые 5 карт в сбросе', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lands = [
        { type: 'swamp', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
      ];
      d.players.p1!.actions = 10;
    });
    s = forceToHand(s, 'p1', 'bmo_card_18');
    const res = applyCommand(s, { type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'bmo_card_18'), zone: 0 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const angelId = res.state.players.p1!.zones[0]!.creature!;
    expect(computeEff(res.state, deps, angelId).attack).toBe(0);
    const withDiscard = edit(res.state, (d) => {
      const p = d.players.p1!;
      for (let i = 0; i < 12; i++) {
        const id = p.deck.shift()!;
        d.instances[id]!.location = 'discard';
        p.discard.push(id);
      }
    });
    expect(computeEff(withDiscard, deps, angelId).attack).toBe(2); // 12 / 5 = 2
  });

  it('Остролист: стоимость −2 при 10+ картах в сбросе', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lands = [
        { type: 'swamp', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
      ];
      d.players.p1!.actions = 10;
    });
    // без условия: полная стоимость 2
    s = forceToHand(s, 'p1', 'bmo_card_29');
    const full = applyCommand(s, { type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'bmo_card_29'), zone: 0 }, deps);
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.state.players.p1!.actions).toBe(10 - 2);
    // с условием: 10 карт в сбросе → 0 действий
    let s2 = edit(newMatch(), (d) => {
      d.players.p1!.lands = [
        { type: 'swamp', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
      ];
      d.players.p1!.actions = 10;
      const p = d.players.p1!;
      for (let i = 0; i < 10; i++) {
        const id = p.deck.shift()!;
        d.instances[id]!.location = 'discard';
        p.discard.push(id);
      }
    });
    s2 = forceToHand(s2, 'p1', 'bmo_card_29');
    const cheap = applyCommand(s2, { type: 'play_card', player: 'p1', instanceId: handIdOf(s2, 'p1', 'bmo_card_29'), zone: 0 }, deps);
    expect(cheap.ok).toBe(true);
    if (!cheap.ok) return;
    expect(cheap.state.players.p1!.actions).toBe(10);
  });

  it('Ферма: считается за дополнительную Кукурузную землю', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lands = [
        { type: 'corn', frozen: false, flipped: true },
        { type: 'blue', frozen: false, flipped: false },
        { type: 'blue', frozen: false, flipped: false },
        { type: 'blue', frozen: false, flipped: false },
      ];
    });
    expect(matchingLandCount(s, deps, 'p1', 'corn')).toBe(0); // перевёрнутая не считается
    // ставим Ферму напрямую в строенийый слот зоны 0
    s = edit(s, (d) => {
      const p = d.players.p1!;
      const deckId = p.deck[0]!;
      d.instances[deckId]!.cardId = 'cake_card_15';
      d.instances[deckId]!.location = 'field';
      d.instances[deckId]!.zone = 0;
      d.instances[deckId]!.slot = 'building';
      p.zones[0]!.building = deckId;
    });
    expect(matchingLandCount(s, deps, 'p1', 'corn')).toBe(1);
  });

  it('Бочка: +1 ATK и +1 DEF за каждую другую Бочку в игре', () => {
    let s = newMatch();
    s = edit(s, (d) => {
      const p1 = d.players.p1!;
      const a = p1.deck[0]!;
      const b = p1.deck[1]!;
      for (const [id, zone] of [[a, 0], [b, 1]] as const) {
        d.instances[id]!.cardId = 'charlie_card_2';
        d.instances[id]!.location = 'field';
        d.instances[id]!.zone = zone;
        d.instances[id]!.slot = 'creature';
        p1.zones[zone]!.creature = id;
      }
    });
    const aId = s.players.p1!.zones[0]!.creature!;
    expect(computeEff(s, deps, aId).attack).toBe(1 + 1);
    expect(computeEff(s, deps, aId).defense).toBe(5 + 1);
  });

  it('Милашка: флюп лечит игрока (жизни 25 → 24 → 25)', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lives = 24;
      d.round = 2; // флюп запрещён в первом круге для первого игрока
      d.players.p1!.lands = [
        { type: 'good', frozen: false, flipped: false },
        { type: 'blue', frozen: false, flipped: false },
        { type: 'blue', frozen: false, flipped: false },
        { type: 'blue', frozen: false, flipped: false },
      ];
      d.players.p1!.actions = 10;
    });
    s = forceToHand(s, 'p1', 'bubblegum_card_20');
    const res = applyCommand(s, { type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'bubblegum_card_20'), zone: 0 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const res2 = applyCommand(res.state, { type: 'floop', player: 'p1', instanceId: res.state.players.p1!.zones[0]!.creature! }, deps);
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect(res2.state.players.p1!.lives).toBe(25);
  });

  it('Лысый бродяга: в начале хода верхняя карта колоды — в сброс', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lands = [
        { type: 'swamp', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
      ];
      d.players.p1!.actions = 10;
    });
    s = forceToHand(s, 'p1', 'bmo_card_10');
    const res = applyCommand(s, { type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'bmo_card_10'), zone: 0 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const deckBefore = res.state.players.p1!.deck.length;
    const discardBefore = res.state.players.p1!.discard.length;
    // пропускаем ход p1 и ход p2: снова ход p1 — триггер сработал
    let s2 = applyCommand(res.state, { type: 'go_battle', player: 'p1' }, deps);
    expect(s2.ok).toBe(true);
    if (!s2.ok) return;
    s2 = applyCommand(s2.state, { type: 'go_battle', player: 'p2' }, deps);
    expect(s2.ok).toBe(true);
    if (!s2.ok) return;
    expect(s2.state.players.p1!.deck.length).toBe(deckBefore - 2); // добор хода + мельница
    expect(s2.state.players.p1!.discard.length).toBe(discardBefore + 1); // только мельница
  });

  it('гномы: урон только существам противника на земле нужного типа', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lands = [
        { type: 'swamp', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
        { type: 'rainbow', frozen: false, flipped: false },
      ];
      d.players.p1!.actions = 10;
      d.round = 2; // флюп запрещён в первом круге для первого игрока
      // существо p2 на болоте (зона 0 зеркальна зоне 3 p1? — ставим p2 напрямую)
      const p2 = d.players.p2!;
      const a = p2.deck[0]!;
      const b = p2.deck[1]!;
      for (const [id, zone] of [[a, 0], [b, 1]] as const) {
        d.instances[id]!.location = 'field';
        d.instances[id]!.zone = zone;
        d.instances[id]!.slot = 'creature';
        p2.zones[zone]!.creature = id;
      }
      d.players.p2!.lands[0]!.type = 'swamp';
      d.players.p2!.lands[1]!.type = 'blue';
    });
    s = forceToHand(s, 'p1', 'ftg_card_2'); // Голубой гном: ПРИЕМ — 1 урон каждому существу противника на Бесполезных болотах
    const res = applyCommand(s, { type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'ftg_card_2'), zone: 2 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const swampId = res.state.players.p2!.zones[0]!.creature!;
    const blueId = res.state.players.p2!.zones[1]!.creature!;
    const gnomeId = res.state.players.p1!.zones[2]!.creature!;
    const floop = applyCommand(res.state, { type: 'floop', player: 'p1', instanceId: gnomeId }, deps);
    expect(floop.ok).toBe(true);
    if (!floop.ok) return;
    const state = floop.state;
    expect(state.instances[swampId]!.damage).toBe(1);
    expect(state.instances[blueId]!.damage).toBe(0);
  });

  it('герой Бимо: сброс карты с руки >>> 1 урон выбранному существу; раз за ход', () => {
    let s = newMatch();
    s = edit(s, (d) => {
      d.players.p1!.heroId = 'hero_bmo';
      const p2 = d.players.p2!;
      const a = p2.deck[0]!;
      d.instances[a]!.location = 'field';
      d.instances[a]!.zone = 0;
      d.instances[a]!.slot = 'creature';
      p2.zones[0]!.creature = a;
    });
    const creatureId = s.players.p2!.zones[0]!.creature!;
    const discardId = s.players.p1!.hand[0]!;
    const res = applyCommand(
      s,
      { type: 'hero_ability', player: 'p1', targets: [{ kind: 'card', instanceId: discardId }, { kind: 'creature', instanceId: creatureId }] },
      deps,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.instances[creatureId]!.damage).toBe(1);
    expect(res.state.players.p1!.hand).not.toContain(discardId);
    const again = applyCommand(
      res.state,
      { type: 'hero_ability', player: 'p1', targets: [{ kind: 'card', instanceId: res.state.players.p1!.hand[0]! }, { kind: 'creature', instanceId: creatureId }] },
      deps,
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.rejected.code).toBe('ability_already_used');
  });

  it('Угнетающая пирамида: −2 DEF существу противника, но не ниже 1', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lands = [
        { type: 'swamp', frozen: false, flipped: false },
        { type: 'blue', frozen: false, flipped: false },
        { type: 'blue', frozen: false, flipped: false },
        { type: 'blue', frozen: false, flipped: false },
      ];
      const p1 = d.players.p1!;
      const b = p1.deck[0]!;
      d.instances[b]!.cardId = 'lich_card_28';
      d.instances[b]!.location = 'field';
      d.instances[b]!.zone = 0;
      d.instances[b]!.slot = 'building';
      p1.zones[0]!.building = b;
      const p2 = d.players.p2!;
      const c = p2.deck[0]!;
      d.instances[c]!.cardId = 'bmo_card_12'; // 3/9
      d.instances[c]!.location = 'field';
      d.instances[c]!.zone = 3;
      d.instances[c]!.slot = 'creature';
      p2.zones[3]!.creature = c;
    });
    const victimId = s.players.p2!.zones[3]!.creature!;
    expect(cardIdOf(s, victimId)).toBe('bmo_card_12');
    expect(computeEff(s, deps, victimId).defense).toBe(Math.max(1, 9 - 2));
  });
});
