import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  computeEff,
  createMatch,
  type CardCatalog,
  type GameConfig,
  type MatchState,
} from '@card-wars/domain';
import { catalog, deckPresets } from './index.ts';

// Golden tests for the H1 primitives (docs/MECHANICS-V2.md §H1–H3).
const config: GameConfig = {
  startingLives: 25, teamStartingLives: 50, teamSize: 2, minPlayers: 2, maxPlayers: 4,
  deckSize: 40, startingHandSize: 5, mulliganCount: 1, actionsPerTurn: 2,
  landsPerPlayer: 4, landRequirementPerCard: 1, freeDrawsPerTurn: 1, extraDrawCost: 1,
  companionMaxInPlay: 1, copyLimit: 4,
};
const deps = {
  config,
  catalog: catalog as CardCatalog,
  events: [] as never[],
  frame: { queue: [], steps: 0 },
};

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
    const deckId = p.deck[0]!;
    const handId = p.hand[0]!;
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

function placeOwnCreatures(state: MatchState, cardId: string, damage: number[]): MatchState {
  return edit(state, (d) => {
    d.players.p1!.actions = 10;
    damage.forEach((amount, zone) => {
      const id = d.players.p1!.deck[0]!;
      d.players.p1!.deck.splice(0, 1);
      const inst = d.instances[id]!;
      inst.cardId = cardId;
      inst.location = 'field';
      inst.zone = zone;
      inst.slot = 'creature';
      inst.damage = amount;
      d.players.p1!.zones[zone]!.creature = id;
    });
  });
}

describe('golden: H1 primitives', () => {
  it('Заплатка: перераспределение урона сохраняет сумму', () => {
    let s = placeOwnCreatures(newMatch(), 'bmo_card_12', [3, 1]);
    s = forceToHand(s, 'p1', 'jake_2v2_card_6');
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'jake_2v2_card_6'),
      targets: [{ kind: 'amounts', values: [1, 3] }],
    }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.rejected.message);
    const damages = [0, 1].map((zone) => res.state.instances[res.state.players.p1!.zones[zone]!.creature!]!.damage);
    expect(damages).toEqual([1, 3]);
  });

  it('Заплатка: запрещено менять сумму урона', () => {
    let s = placeOwnCreatures(newMatch(), 'bmo_card_12', [3, 1]);
    s = forceToHand(s, 'p1', 'jake_2v2_card_6');
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'jake_2v2_card_6'),
      targets: [{ kind: 'amounts', values: [1, 1] }],
    }, deps);
    expect(res.ok).toBe(false);
  });

  it('Хлопковый Великан: АТК удваивается при остатке DEF ≤ 3', () => {
    const card = catalog.getCard('tree_trunks_card_1')!;
    const s = placeOwnCreatures(newMatch(), 'tree_trunks_card_1', [(card.defense ?? 0) - 2]);
    const id = s.players.p1!.zones[0]!.creature!;
    expect(computeEff(s, deps, id).attack).toBe((card.attack ?? 0) * 2);
  });

  it('Ожерелье черных дыр: +X ATK по числу типов земель противника', () => {
    let s = placeOwnCreatures(newMatch(), 'bmo_card_12', [0]);
    s = forceToHand(s, 'p1', 'marceline_card_33');
    const target = s.players.p1!.zones[0]!.creature!;
    const expected = new Set(s.players.p2!.lands.map((l) => l.type)).size;
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'marceline_card_33'),
      targets: [{ kind: 'creature', instanceId: target }],
    }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.turnBuffs.some((b) => b.instanceId === target && b.amount === expected)).toBe(true);
  });

  it('Воскресная школа: +2 ATK только при чётном числе жизней', () => {
    let base = placeOwnCreatures(newMatch(), 'bmo_card_12', [0]);
    base = edit(base, (d) => {
      const id = d.players.p1!.deck[0]!;
      d.players.p1!.deck.splice(0, 1);
      const inst = d.instances[id]!;
      inst.cardId = 'ftg_card_48';
      inst.location = 'field';
      inst.zone = 0;
      inst.slot = 'building';
      d.players.p1!.zones[0]!.building = id;
      d.players.p1!.lives = 24;
    });
    const id = base.players.p1!.zones[0]!.creature!;
    const even = computeEff(base, deps, id).attack;
    const odd = edit(base, (d) => { d.players.p1!.lives = 23; });
    expect(even - computeEff(odd, deps, id).attack).toBe(2);
  });

  it('Плюшевый: урон по ATK и удвоение ATK в этом ходу', () => {
    let s = placeOwnCreatures(newMatch(), 'bmo_card_12', [0]);
    s = forceToHand(s, 'p1', 'charlie_card_38');
    const target = s.players.p1!.zones[0]!.creature!;
    const baseAttack = computeEff(s, deps, target).attack;
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'charlie_card_38'),
      targets: [{ kind: 'creature', instanceId: target }],
    }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.rejected.message);
    // Effect arrays ask for their choices lazily (docs §6), so the creature
    // answer arrives through resolve_choice, not with play_card.
    let state = res.state;
    if (state.pending) {
      const next = applyCommand(state, {
        type: 'resolve_choice', player: 'p1',
        answer: { targets: [{ kind: 'creature', instanceId: target }] },
      }, deps);
      expect(next.ok).toBe(true);
      if (!next.ok) throw new Error(next.rejected.message);
      state = next.state;
    }
    expect(state.instances[target]!.damage).toBe(baseAttack);
    expect(computeEff(state, deps, target).attack).toBe(baseAttack * 2);
  });

  it('Бесконечный комбайн: урон себе по остатку DEF и уничтожение существа', () => {
    let s = placeOwnCreatures(newMatch(), 'bmo_card_12', [2]);
    s = forceToHand(s, 'p1', 'jake_2v2_card_29');
    const target = s.players.p1!.zones[0]!.creature!;
    const remaining = computeEff(s, deps, target).defense - 2;
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'jake_2v2_card_29'),
      targets: [{ kind: 'creature', instanceId: target }],
    }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.players.p1!.lives).toBe(25 - remaining);
    expect(res.state.players.p1!.zones[0]!.creature).toBeNull();
  });

  it('Милый Оверлорд: уничтожить N своих существ и добрать N карт', () => {
    let s = placeOwnCreatures(newMatch(), 'bmo_card_12', [0, 0]);
    s = forceToHand(s, 'p1', 'gunter_card_3');
    const handBefore = s.players.p1!.hand.length;
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'gunter_card_3'),
      targets: [{ kind: 'amount', value: 2 }],
    }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.players.p1!.zones[0]!.creature).toBeNull();
    expect(res.state.players.p1!.zones[1]!.creature).toBeNull();
    expect(res.state.players.p1!.hand.length).toBe(handBefore - 1 + 2);
  });

  it('Кольцо пушистости: +X ATK по урону на выбранном существе', () => {
    let s = placeOwnCreatures(newMatch(), 'bmo_card_12', [3]);
    s = forceToHand(s, 'p1', 'bubblegum_card_14');
    const target = s.players.p1!.zones[0]!.creature!;
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'bubblegum_card_14'),
      targets: [{ kind: 'creature', instanceId: target }],
    }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.turnBuffs.some((b) => b.instanceId === target && b.stat === 'attack' && b.amount === 3)).toBe(true);
  });
});
