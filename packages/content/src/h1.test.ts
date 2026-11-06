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

describe('golden: hero abilities (H7)', () => {
  it('Колдунья-охотница: choose_word сохраняет слово и срабатывает на карте с этим словом', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.heroId = 'hero_huntress_wizard';
      d.players.p1!.lands = ['rainbow', 'rainbow', 'rainbow', 'rainbow'].map((type) => ({
        type: type as 'rainbow', frozen: false, flipped: false, iceTokens: 0,
      }));
      d.players.p1!.actions = 10;
    });
    const chosen = applyCommand(s, { type: 'choose_word', player: 'p1', word: 'Сирена' }, deps);
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) throw new Error(chosen.rejected.message);
    expect(chosen.state.chosenWord.p1).toBe('Сирена');
    // Герой без wordSetup слово выбрать не может (validation by hero data).
    const noWord = applyCommand(chosen.state, { type: 'choose_word', player: 'p2', word: 'Джейк' }, deps);
    expect(noWord.ok).toBe(false);
    s = forceToHand(chosen.state, 'p1', 'bmo_card_12');
    const played = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'bmo_card_12'), zone: 0,
    }, deps);
    expect(played.ok).toBe(true);
    if (!played.ok) throw new Error(played.rejected.message);
    expect(played.state.pending?.player).toBe('p1');
  });

  it('Рикардио: платит 1 жизнь, вскрывает верхнюю карту приватно и решает после вскрытия', () => {
    const s = edit(newMatch(), (d) => { d.players.p1!.heroId = 'hero_ricardio'; });
    const deckBefore = s.players.p1!.deck.length;
    const res = applyCommand(s, { type: 'hero_ability', player: 'p1' }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.players.p1!.lives).toBe(24);
    // Приватное окно: верхняя карта колоды, вопрос — после вскрытия (effect_step).
    const topId = res.state.players.p1!.deck[0]!;
    expect(res.state.peeks.p1).toEqual([topId]);
    expect(res.state.pending?.player).toBe('p1');
    expect(res.state.pending?.ask.kind).toBe('effect_step');
    expect(res.state.players.p1!.deck.length).toBe(deckBefore);
    // «Сбросить» — карта уходит в сброс, окно закрывается.
    const next = applyCommand(res.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'option', option: 'discard' }] },
    }, deps);
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error(next.rejected.message);
    expect(next.state.players.p1!.deck.length).toBe(deckBefore - 1);
    expect(next.state.peeks.p1 ?? []).toEqual([]);
    // Один раз за ход.
    const again = applyCommand(next.state, { type: 'hero_ability', player: 'p1' }, deps);
    expect(again.ok).toBe(false);
  });

  it('Рикардио: ответ keep оставляет карту в колоде и закрывает окно', () => {
    const s = edit(newMatch(), (d) => { d.players.p1!.heroId = 'hero_ricardio'; });
    const deckBefore = s.players.p1!.deck.length;
    const res = applyCommand(s, { type: 'hero_ability', player: 'p1' }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.rejected.message);
    const next = applyCommand(res.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'option', option: 'keep' }] },
    }, deps);
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error(next.rejected.message);
    expect(next.state.players.p1!.deck.length).toBe(deckBefore);
    expect(next.state.peeks.p1 ?? []).toEqual([]);
  });
});

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

/** Place a creature on the OPPONENT's side (zones mirror: p1 zone i ↔ p2 zone 3-i). */
function placeOppCreatures(state: MatchState, cardId: string, zones: number[]): MatchState {
  return edit(state, (d) => {
    zones.forEach((zone) => {
      const id = d.players.p2!.deck[0]!;
      d.players.p2!.deck.splice(0, 1);
      const inst = d.instances[id]!;
      inst.cardId = cardId;
      inst.location = 'field';
      inst.zone = zone;
      inst.slot = 'creature';
      d.players.p2!.zones[zone]!.creature = id;
    });
  });
}

function placeOwnBuilding(state: MatchState, cardId: string, zone: number): MatchState {
  return edit(state, (d) => {
    const id = d.players.p1!.deck[0]!;
    d.players.p1!.deck.splice(0, 1);
    const inst = d.instances[id]!;
    inst.cardId = cardId;
    inst.location = 'field';
    inst.zone = zone;
    inst.slot = 'building';
    d.players.p1!.zones[zone]!.building = id;
  });
}

/** Pass p1's and p2's battle phases to reach p1's next turn (round 2). */
function nextP1Turn(state: MatchState): MatchState {
  const gb1 = applyCommand(state, { type: 'go_battle', player: 'p1' }, deps);
  if (!gb1.ok) throw new Error(gb1.rejected.message);
  const gb2 = applyCommand(gb1.state, { type: 'go_battle', player: 'p2' }, deps);
  if (!gb2.ok) throw new Error(gb2.rejected.message);
  return gb2.state;
}

describe('golden: H9 option branching (батч I)', () => {
  /** Дух воплекура с нулевой АТК: боевой уход nextP1Turn не искажает урон приёма. */
  function poltergeistSetup(): MatchState {
    let s = placeOwnCreatures(newMatch(), 'lich_card_10', [0]);
    const atk = catalog.getCard('lich_card_10')!.attack ?? 0;
    s = edit(s, (d) => {
      d.instances[d.players.p1!.zones[0]!.creature!]!.bonusAttack = -atk;
    });
    return placeOppCreatures(s, 'bmo_card_12', [3, 2]);
  }

  it('Дух воплекура: «всем» — 1 урон каждому существу противника', () => {
    let s = poltergeistSetup();
    s = nextP1Turn(s); // в 1-м раунде первый игрок флюпить не может
    const id = s.players.p1!.zones[0]!.creature!;
    // Массив эффектов спрашивает ветку лениво: флюп без целей → pending → ответ.
    const floop = applyCommand(s, { type: 'floop', player: 'p1', instanceId: id }, deps);
    if (!floop.ok) throw new Error(floop.rejected.message);
    expect(floop.state.pending?.player).toBe('p1');
    const res = applyCommand(floop.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'option', option: 'all' }] },
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    const left = res.state.instances[res.state.players.p2!.zones[3]!.creature!]!;
    const right = res.state.instances[res.state.players.p2!.zones[2]!.creature!]!;
    expect(left.damage).toBe(1);
    expect(right.damage).toBe(1);
  });

  it('Дух воплекура: «одному» — 3 урона существу перед ним, остальные целы', () => {
    let s = poltergeistSetup();
    s = nextP1Turn(s);
    const id = s.players.p1!.zones[0]!.creature!;
    const floop = applyCommand(s, { type: 'floop', player: 'p1', instanceId: id }, deps);
    if (!floop.ok) throw new Error(floop.rejected.message);
    const res = applyCommand(floop.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'option', option: 'one' }] },
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    const front = res.state.instances[res.state.players.p2!.zones[3]!.creature!]!;
    const other = res.state.instances[res.state.players.p2!.zones[2]!.creature!]!;
    expect(front.damage).toBe(3);
    expect(other.damage).toBe(0);
  });

  it('Рубленный стейк: «уничтожь» — без вопросов о картах руки', () => {
    let s = placeOwnCreatures(newMatch(), 'lsp_card_16', [0]);
    s = nextP1Turn(s);
    expect(s.pending?.player).toBe('p1');
    const handBefore = s.players.p1!.hand.length;
    const res = applyCommand(s, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'option', option: 'destroy' }] },
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.players.p1!.zones[0]!.creature).toBeNull();
    expect(res.state.players.p1!.hand.length).toBe(handBefore);
    expect(res.state.pending).toBeNull();
  });

  it('Рубленный стейк: «сбрось 2» — две карты руки в сброс', () => {
    let s = placeOwnCreatures(newMatch(), 'lsp_card_16', [0]);
    s = nextP1Turn(s);
    expect(s.pending?.player).toBe('p1');
    const res1 = applyCommand(s, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'option', option: 'discard' }] },
    }, deps);
    if (!res1.ok) throw new Error(res1.rejected.message);
    expect(res1.state.pending?.player).toBe('p1'); // вопрос о 1-й карте руки
    const card1 = res1.state.players.p1!.hand[0]!;
    const res2 = applyCommand(res1.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'card', instanceId: card1 }] },
    }, deps);
    if (!res2.ok) throw new Error(res2.rejected.message);
    const card2 = res2.state.players.p1!.hand[0]!;
    const res3 = applyCommand(res2.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'card', instanceId: card2 }] },
    }, deps);
    if (!res3.ok) throw new Error(res3.rejected.message);
    expect(res3.state.pending).toBeNull();
    expect(res3.state.players.p1!.zones[0]!.creature).not.toBeNull();
    expect(res3.state.players.p1!.discard.length).toBe(2);
  });

  it('Башня свободы: ПРИЁМ со сбросом карты меняет тип земли линии', () => {
    let s = edit(newMatch(), (d) => { d.players.p1!.actions = 10; });
    s = placeOwnBuilding(s, 'lemongrab_card_29', 0);
    s = nextP1Turn(s);
    const buildingId = s.players.p1!.zones[0]!.building!;
    const payId = s.players.p1!.hand[0]!;
    // Один шаг эффекта: доп. стоимость и выбор типа приходят одной командой.
    const res = applyCommand(s, {
      type: 'floop', player: 'p1', instanceId: buildingId,
      targets: [{ kind: 'card', instanceId: payId }, { kind: 'option', option: 'ice' }],
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.players.p1!.lands[0]!.type).toBe('ice');
    expect(res.state.players.p1!.lands[0]!.originalType).toBeDefined();
  });

  it('Квадурай: бьёт противника с 4+ картами в руке в начале своего хода', () => {
    const s = placeOwnCreatures(newMatch(), 'ftg_card_64', [0]);
    const livesBefore = s.players.p2!.lives;
    const gb1 = applyCommand(s, { type: 'go_battle', player: 'p1' }, deps);
    if (!gb1.ok) throw new Error(gb1.rejected.message);
    const gb2 = applyCommand(gb1.state, { type: 'go_battle', player: 'p2' }, deps);
    if (!gb2.ok) throw new Error(gb2.rejected.message);
    expect(gb2.state.players.p2!.lives).toBe(livesBefore - 2);
  });

  it('Снижение налогов: «свои» — обмен двух своих строений, чужие не спрашиваются', () => {
    let s = edit(newMatch(), (d) => { d.players.p1!.actions = 10; });
    s = placeOwnBuilding(s, 'bmo_card_12', 0);
    s = placeOwnBuilding(s, 'bmo_card_12', 1);
    s = forceToHand(s, 'p1', 'ftg_card_17');
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'ftg_card_17'),
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.pending?.player).toBe('p1');
    const next = applyCommand(res.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'option', option: 'own' }] },
    }, deps);
    if (!next.ok) throw new Error(next.rejected.message);
    expect(next.state.pending?.player).toBe('p1'); // выбор 1-го строения
    const b0 = next.state.players.p1!.zones[0]!.building!;
    const b1 = next.state.players.p1!.zones[1]!.building!;
    const pick1 = applyCommand(next.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'creature', instanceId: b0 }] },
    }, deps);
    if (!pick1.ok) throw new Error(pick1.rejected.message);
    const pick2 = applyCommand(pick1.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'creature', instanceId: b1 }] },
    }, deps);
    if (!pick2.ok) throw new Error(pick2.rejected.message);
    expect(pick2.state.pending).toBeNull();
    expect(pick2.state.players.p1!.zones[0]!.building).toBe(b1);
    expect(pick2.state.players.p1!.zones[1]!.building).toBe(b0);
  });
});

describe('golden: H10 death/leave reactions (батч II)', () => {
  /** Put one own creature of the given card into the given zone. */
  function placeOwn(state: MatchState, cardId: string, zone: number, damage = 0): MatchState {
    return edit(state, (d) => {
      const id = d.players.p1!.deck[0]!;
      d.players.p1!.deck.splice(0, 1);
      const inst = d.instances[id]!;
      inst.cardId = cardId;
      inst.location = 'field';
      inst.zone = zone;
      inst.slot = 'creature';
      inst.damage = damage;
      d.players.p1!.zones[zone]!.creature = id;
    });
  }

  /** Place a vanilla creature for p2 in the given zone. */
  function placeOpp(state: MatchState, zone: number, damage = 0): MatchState {
    return edit(state, (d) => {
      const id = d.players.p2!.deck[0]!;
      d.players.p2!.deck.splice(0, 1); // изъять из колоды, чтобы не вытянулась
      const inst = d.instances[id]!;
      inst.location = 'field';
      inst.zone = zone;
      inst.slot = 'creature';
      inst.damage = damage;
      d.players.p2!.zones[zone]!.creature = id;
    });
  }

  it('Бестелесый обжор: поглощает умершее призрачное существо (+1 ATK/+2 DEF навсегда)', () => {
    let s = placeOwn(newMatch(), 'lich_card_13', 0);
    s = placeOwn(s, 'lich_card_13', 1, 99); // призрачный спутник с летальным уроном
    const gluttonId = s.players.p1!.zones[0]!.creature!;
    const base = computeEff(s, deps, gluttonId);
    const gb = applyCommand(s, { type: 'go_battle', player: 'p1' }, deps);
    if (!gb.ok) throw new Error(gb.rejected.message);
    expect(gb.state.players.p1!.zones[1]!.creature).toBeNull();
    const glutton = gb.state.instances[gluttonId]!;
    expect(glutton.attached?.length).toBe(1);
    const eff = computeEff(gb.state, deps, gluttonId);
    expect(eff.attack).toBe(base.attack + 1);
    expect(eff.defense).toBe(base.defense + 2);
  });

  it('Берсеркорова: убивает в бою — карта жертвы под ней, +1 ATK навсегда', () => {
    let s = placeOwn(newMatch(), 'tree_trunks_card_16', 0);
    const berserkId = s.players.p1!.zones[0]!.creature!;
    s = edit(s, (d) => {
      d.instances[berserkId]!.bonusAttack = 50;
    });
    s = placeOpp(s, 3);
    s = nextP1Turn(s); // в 1-м раунде первый игрок не атакует
    const gb = applyCommand(s, { type: 'go_battle', player: 'p1' }, deps);
    if (!gb.ok) throw new Error(gb.rejected.message);
    expect(gb.state.players.p2!.zones[3]!.creature).toBeNull();
    const berserk = gb.state.instances[berserkId]!;
    expect(berserk.attached?.length).toBe(1);
    expect(berserk.bonusAttack).toBe(51);
  });

  it('Очаровательный трупоедик: ПРИЁМ кладёт верхнюю карту чужого сброса под себя (+1 ATK)', () => {
    let s = placeOwn(newMatch(), 'lich_card_44', 0);
    const corpseId = s.players.p1!.zones[0]!.creature!;
    s = edit(s, (d) => {
      const id = d.players.p2!.deck[0]!;
      d.players.p2!.deck.splice(0, 1); // изъять из колоды, чтобы не вытянулась
      d.instances[id]!.location = 'discard';
      d.players.p2!.discard.push(id);
    });
    s = nextP1Turn(s);
    const discardBefore = s.players.p2!.discard.length;
    const floop = applyCommand(s, { type: 'floop', player: 'p1', instanceId: corpseId }, deps);
    if (!floop.ok) throw new Error(floop.rejected.message);
    const corpse = floop.state.instances[corpseId]!;
    expect(corpse.attached?.length).toBe(1);
    expect(floop.state.players.p2!.discard.length).toBe(discardBefore - 1);
    expect(corpse.bonusAttack).toBe(1);
  });

  it('Каракум: подкладывает ушедшее существо под себя, +1/+1 за каждую карту (аура)', () => {
    let s = placeOwn(newMatch(), 'lemongrab_card_33', 0);
    const rugId = s.players.p1!.zones[0]!.creature!;
    s = placeOwn(s, 'bmo_card_12', 1, 99);
    const base = computeEff(s, deps, rugId);
    const gb = applyCommand(s, { type: 'go_battle', player: 'p1' }, deps);
    if (!gb.ok) throw new Error(gb.rejected.message);
    // опциональная способность ждёт решения
    expect(gb.state.pending?.player).toBe('p1');
    const res = applyCommand(gb.state, {
      type: 'resolve_choice', player: 'p1', answer: { proceed: true },
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    const rug = res.state.instances[rugId]!;
    expect(rug.attached?.length).toBe(1);
    const eff = computeEff(res.state, deps, rugId);
    expect(eff.attack).toBe(base.attack + 1);
    expect(eff.defense).toBe(base.defense + 1);
  });

  it('Некромансер: переезжает на пустую землю ушедшего своего существа', () => {
    let s = placeOwn(newMatch(), 'charlie_card_15', 0);
    const necroId = s.players.p1!.zones[0]!.creature!;
    s = placeOwn(s, 'bmo_card_12', 1, 99);
    s = forceToHand(s, 'p1', 'bmo_card_12');
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'bmo_card_12'), zone: 2,
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.pending?.player).toBe('p1');
    const next = applyCommand(res.state, {
      type: 'resolve_choice', player: 'p1', answer: { proceed: true },
    }, deps);
    if (!next.ok) throw new Error(next.rejected.message);
    expect(next.state.players.p1!.zones[0]!.creature).toBeNull();
    expect(next.state.players.p1!.zones[1]!.creature).toBe(necroId);
  });

  it('Болотная бомба-лягушка: уходя подготовленной, наносит 2 урона существам противника', () => {
    let s = placeOwn(newMatch(), 'marceline_card_19', 0);
    const frogId = s.players.p1!.zones[0]!.creature!;
    s = edit(s, (d) => {
      d.instances[frogId]!.flipped = true;
      d.instances[frogId]!.damage = 99;
    });
    s = placeOpp(s, 3);
    s = forceToHand(s, 'p1', 'bmo_card_12');
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'bmo_card_12'), zone: 1,
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    const victimId = res.state.players.p2!.zones[3]!.creature!;
    expect(res.state.instances[victimId]!.damage).toBe(2);
    expect(res.state.players.p1!.zones[0]!.creature).toBeNull();
  });

  it('Бездомный болот: уходя подготовленным, заставляет противника сбросить карту', () => {
    let s = placeOwn(newMatch(), 'marceline_card_17', 0);
    const bogId = s.players.p1!.zones[0]!.creature!;
    s = edit(s, (d) => {
      d.instances[bogId]!.flipped = true;
      d.instances[bogId]!.damage = 99;
    });
    s = forceToHand(s, 'p1', 'bmo_card_12');
    const handBefore = s.players.p2!.hand.length;
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'bmo_card_12'), zone: 1,
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.players.p2!.hand.length).toBe(handBefore - 1);
    expect(res.state.players.p2!.discard.length).toBe(1);
  });
});

describe('golden: H11 buildings, distribute, shielded targets (батч III)', () => {
  function placeOwn(state: MatchState, cardId: string, zone: number, damage = 0): MatchState {
    return edit(state, (d) => {
      const id = d.players.p1!.deck[0]!;
      d.players.p1!.deck.splice(0, 1);
      const inst = d.instances[id]!;
      inst.cardId = cardId;
      inst.location = 'field';
      inst.zone = zone;
      inst.slot = 'creature';
      inst.damage = damage;
      d.players.p1!.zones[zone]!.creature = id;
    });
  }

  function placeOwnBuilding(state: MatchState, cardId: string, zone: number): MatchState {
    return edit(state, (d) => {
      const id = d.players.p1!.deck[0]!;
      d.players.p1!.deck.splice(0, 1);
      const inst = d.instances[id]!;
      inst.cardId = cardId;
      inst.location = 'field';
      inst.zone = zone;
      inst.slot = 'building';
      d.players.p1!.zones[zone]!.building = id;
    });
  }

  it('Помощник лесоруба: ПРИЁМ переставляет своё строение на землю без строения', () => {
    let s = placeOwn(newMatch(), 'cake_card_29', 0);
    s = placeOwnBuilding(s, 'bmo_card_12', 1);
    s = nextP1Turn(s);
    const builderId = s.players.p1!.zones[0]!.creature!;
    const buildingId = s.players.p1!.zones[1]!.building!;
    const floop = applyCommand(s, {
      type: 'floop', player: 'p1', instanceId: builderId,
      targets: [
        { kind: 'creature', instanceId: buildingId },
        { kind: 'landscape', player: 'p1', zone: 2 },
      ],
    }, deps);
    if (!floop.ok) throw new Error(floop.rejected.message);
    expect(floop.state.players.p1!.zones[1]!.building).toBeNull();
    expect(floop.state.players.p1!.zones[2]!.building).toBe(buildingId);
  });

  it('Восстановление ландшафта: «перевернуть» — только земля, строение не спрашивается', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lands[0]!.type = 'rainbow'; // заклинание радужное
      d.players.p1!.lands[0]!.flipped = true;
      d.players.p1!.actions = 10;
    });
    s = placeOwnBuilding(s, 'bmo_card_12', 0);
    s = forceToHand(s, 'p1', 'jake_card_29');
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'jake_card_29'),
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.pending?.player).toBe('p1');
    const next = applyCommand(res.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'option', option: 'flip' }] },
    }, deps);
    if (!next.ok) throw new Error(next.rejected.message);
    expect(next.state.pending?.player).toBe('p1'); // выбор земли
    const next2 = applyCommand(next.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'landscape', player: 'p1', zone: 0 }] },
    }, deps);
    if (!next2.ok) throw new Error(next2.rejected.message);
    expect(next2.state.pending).toBeNull();
    expect(next2.state.players.p1!.lands[0]!.flipped).toBe(false);
  });

  it('Абрака-тилиус: восстанавливает N жизней и распределяет N урона по своим', () => {
    let s = placeOwn(newMatch(), 'bmo_card_12', 0, 2);
    s = placeOwn(s, 'bmo_card_12', 1, 1);
    s = edit(s, (d) => { d.players.p1!.lives = 20; d.players.p1!.actions = 10; });
    s = forceToHand(s, 'p1', 'tree_trunks_card_21');
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'tree_trunks_card_21'),
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.pending?.player).toBe('p1'); // amount
    const next = applyCommand(res.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'amount', value: 3 }] },
    }, deps);
    if (!next.ok) throw new Error(next.rejected.message);
    expect(next.state.players.p1!.lives).toBe(23);
    expect(next.state.pending?.player).toBe('p1'); // damage_distribution
    const c0 = next.state.players.p1!.zones[0]!.creature!;
    const c1 = next.state.players.p1!.zones[1]!.creature!;
    // 3 урона поверх текущих (2 и 1): итог 4 и 2, сумма +3
    const dist = applyCommand(next.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'amounts', values: [4, 2] }] },
    }, deps);
    if (!dist.ok) throw new Error(dist.rejected.message);
    expect(dist.state.instances[c0]!.damage).toBe(4);
    expect(dist.state.instances[c1]!.damage).toBe(2);
  });

  it('Облачная башня: чужое заклинание не может выбрать прикрытое существо целью', () => {
    let s = placeOwn(newMatch(), 'bmo_card_12', 0); // существо на земле башни
    s = placeOwnBuilding(s, 'charlie_card_8', 0);
    const shieldedId = s.players.p1!.zones[0]!.creature!;
    s = edit(s, (d) => {
      d.players.p2!.actions = 10;
      d.players.p2!.lands[0]!.type = 'rainbow'; // Букет мечей — радужное
    });
    s = forceToHand(s, 'p2', 'fiona_card_5');
    const gb = applyCommand(s, { type: 'go_battle', player: 'p1' }, deps); // ход p2
    if (!gb.ok) throw new Error(gb.rejected.message);
    s = gb.state;
    // p2 целится в прикрытое существо — отказ
    const blocked = applyCommand(s, {
      type: 'play_card', player: 'p2', instanceId: handIdOf(s, 'p2', 'fiona_card_5'),
      targets: [{ kind: 'creature', instanceId: shieldedId }],
    }, deps);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.rejected.message).toContain('shielded');
    // открытая цель (зона 2) — проходит
    s = placeOwn(s, 'bmo_card_12', 2);
    const openId = s.players.p1!.zones[2]!.creature!;
    const allowed = applyCommand(s, {
      type: 'play_card', player: 'p2', instanceId: handIdOf(s, 'p2', 'fiona_card_5'),
      targets: [{ kind: 'creature', instanceId: openId }],
    }, deps);
    if (!allowed.ok) throw new Error(allowed.rejected.message);
  });

  it('Ведьмак: враг сбрасывает карту — 1 урон ему', () => {
    let s = placeOwnH(newMatch(), 'marceline_card_15', 0);
    const gb = applyCommand(s, { type: 'go_battle', player: 'p1' }, deps); // ход p2
    if (!gb.ok) throw new Error(gb.rejected.message);
    s = gb.state;
    const livesBefore = s.players.p2!.lives;
    const handBefore = s.players.p2!.hand.length;
    const res = applyCommand(s, {
      type: 'discard_from_hand', player: 'p2', instanceId: s.players.p2!.hand[0]!,
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.players.p2!.hand.length).toBe(handBefore - 1);
    expect(res.state.players.p2!.lives).toBe(livesBefore - 1);
  });

  it('Загробный дом: сброс врага даёт +1 ATK до конца следующего хода', () => {
    let s = placeOwnH(newMatch(), 'bmo_card_12', 0);
    s = placeOwnHBuilding(s, 'marceline_card_1', 0);
    const creatureId = s.players.p1!.zones[0]!.creature!;
    const base = computeEff(s, deps, creatureId).attack;
    const gb = applyCommand(s, { type: 'go_battle', player: 'p1' }, deps); // ход p2
    if (!gb.ok) throw new Error(gb.rejected.message);
    const res = applyCommand(gb.state, {
      type: 'discard_from_hand', player: 'p2', instanceId: gb.state.players.p2!.hand[0]!,
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(computeEff(res.state, deps, creatureId).attack).toBe(base + 1);
    const buff = res.state.turnBuffs.find((b) => b.instanceId === creatureId);
    expect(buff?.untilTurn).toBe(res.state.turn + 1);
  });

  it('Ванна крови: враг с картой 2+ сбрасывает; без таких — 5 урона', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lands[0]!.type = 'swamp';
      d.players.p1!.actions = 10;
    });
    s = forceToHand(s, 'p1', 'marceline_card_3');
    // сценарий 1: во руке p2 есть дорогая карта (фиксируем cost 2)
    s = edit(s, (d) => {
      const first = d.players.p2!.hand[0]!;
      d.instances[first]!.cardId = 'bmo_card_12';
    });
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'marceline_card_3'),
      targets: [{ kind: 'player', playerId: 'p2' }],
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.players.p2!.hand.length).toBe(4);
    expect(res.state.players.p2!.lives).toBe(25);
    // сценарий 2: рука p2 пуста → 5 урона
    let s2 = edit(newMatch(), (d) => {
      d.players.p1!.lands[0]!.type = 'swamp';
      d.players.p1!.actions = 10;
      d.players.p2!.hand = [];
    });
    s2 = forceToHand(s2, 'p1', 'marceline_card_3');
    const livesBefore = s2.players.p2!.lives;
    const res2 = applyCommand(s2, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s2, 'p1', 'marceline_card_3'),
      targets: [{ kind: 'player', playerId: 'p2' }],
    }, deps);
    if (!res2.ok) throw new Error(res2.rejected.message);
    expect(res2.state.players.p2!.lives).toBe(livesBefore - 5);
  });

  it('Белкобомбы!: пустая рука врага — 2 урона каждому его существу', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lands[0]!.type = 'swamp';
      d.players.p1!.actions = 10;
      d.players.p2!.hand = [];
    });
    s = placeOwnH(s, 'bmo_card_12', 0);
    s = edit(s, (d) => {
      const id = d.players.p2!.deck[0]!;
      d.players.p2!.deck.splice(0, 1);
      const inst = d.instances[id]!;
      inst.location = 'field';
      inst.zone = 3;
      inst.slot = 'creature';
      d.players.p2!.zones[3]!.creature = id;
    });
    s = forceToHand(s, 'p1', 'marceline_card_5');
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'marceline_card_5'),
      targets: [{ kind: 'player', playerId: 'p2' }],
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    // урон идёт существам ВЫБРАННОГО игрока: у p1 существо цело
    expect(res.state.instances[res.state.players.p1!.zones[0]!.creature!]!.damage).toBe(0);
  });

  it('Переливание крови: изымает карту из сброса и лечит на её стоимость', () => {
    let s = edit(newMatch(), (d) => {
      d.players.p1!.lands[0]!.type = 'rainbow';
      d.players.p1!.actions = 10;
    });
    s = placeOwnH(s, 'bmo_card_12', 0, 2);
    const hurtId = s.players.p1!.zones[0]!.creature!;
    // карта стоимости 2 (bmo_card_12) в свой сброс
    s = edit(s, (d) => {
      const id = d.players.p1!.deck[0]!;
      d.players.p1!.deck.splice(0, 1);
      d.instances[id]!.cardId = 'bmo_card_12';
      d.instances[id]!.location = 'discard';
      d.players.p1!.discard.push(id);
    });
    const banishedId = s.players.p1!.discard[0]!;
    s = forceToHand(s, 'p1', 'marceline_card_35');
    const res = applyCommand(s, {
      type: 'play_card', player: 'p1', instanceId: handIdOf(s, 'p1', 'marceline_card_35'),
    }, deps);
    if (!res.ok) throw new Error(res.rejected.message);
    expect(res.state.pending?.player).toBe('p1');
    const next = applyCommand(res.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'card', instanceId: banishedId }] },
    }, deps);
    if (!next.ok) throw new Error(next.rejected.message);
    const next2 = applyCommand(next.state, {
      type: 'resolve_choice', player: 'p1',
      answer: { targets: [{ kind: 'creature', instanceId: hurtId }] },
    }, deps);
    if (!next2.ok) throw new Error(next2.rejected.message);
    expect(next2.state.instances[banishedId]!.location).toBe('removed');
    // в сбросе остаётся только само разыгранное заклинание
    expect(next2.state.players.p1!.discard).toEqual([handIdOf(s, 'p1', 'marceline_card_35')]);
    expect(next2.state.instances[hurtId]!.damage).toBe(0);
  });
});

/** Place an own creature (h1 batch IV helpers). */
function placeOwnH(state: MatchState, cardId: string, zone: number, damage = 0): MatchState {
  return edit(state, (d) => {
    const id = d.players.p1!.deck[0]!;
    d.players.p1!.deck.splice(0, 1);
    const inst = d.instances[id]!;
    inst.cardId = cardId;
    inst.location = 'field';
    inst.zone = zone;
    inst.slot = 'creature';
    inst.damage = damage;
    d.players.p1!.zones[zone]!.creature = id;
  });
}

/** Place an own building (h1 batch IV helpers). */
function placeOwnHBuilding(state: MatchState, cardId: string, zone: number): MatchState {
  return edit(state, (d) => {
    const id = d.players.p1!.deck[0]!;
    d.players.p1!.deck.splice(0, 1);
    const inst = d.instances[id]!;
    inst.cardId = cardId;
    inst.location = 'field';
    inst.zone = zone;
    inst.slot = 'building';
    d.players.p1!.zones[zone]!.building = id;
  });
}
