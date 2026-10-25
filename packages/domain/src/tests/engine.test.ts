import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch, type MatchState } from '../index';
import { catalog, defaultConfig, forceToHand, handCardId, makeSetup, mustOk, P1, P2 } from './helpers';

const deps = { config: defaultConfig, catalog };

/** Created match with both hands kept: running, turn 1, p1 to act. */
export function startedMatch(seed = 12345): MatchState {
  const { state } = createMatch(deps, makeSetup({ seed }));
  let s = mustOk(applyCommand(state, { type: 'keep_hand', player: P1 }, deps));
  s = mustOk(applyCommand(s, { type: 'keep_hand', player: P2 }, deps));
  return s;
}

describe('createMatch', () => {
  it('раздаёт стартовые руки и тасует колоды', () => {
    const { state, events } = createMatch(deps, makeSetup());
    expect(state.status).toBe('mulligan');
    expect(state.players[P1]!.hand).toHaveLength(5);
    expect(state.players[P1]!.deck).toHaveLength(35);
    expect(state.players[P2]!.hand).toHaveLength(5);
    expect(events[0]!.type).toBe('match_started');
  });

  it('детерминирован по сиду', () => {
    const a = createMatch(deps, makeSetup({ seed: 42 })).state;
    const b = createMatch(deps, makeSetup({ seed: 42 })).state;
    expect(a).toEqual(b);
    const c = createMatch(deps, makeSetup({ seed: 43 })).state;
    expect(a.players[P1]!.deck).not.toEqual(c.players[P1]!.deck);
  });

  it('отклоняет неверный сетап', () => {
    const shortDeck = makeSetup();
    shortDeck.players[0]!.deck = shortDeck.players[0]!.deck.slice(1);
    expect(() => createMatch(deps, shortDeck)).toThrow(/40/);

    const tooManyCopies = makeSetup();
    tooManyCopies.players[0]!.deck = Array.from({ length: 40 }, () => 'vanilla-swamp');
    expect(() => createMatch(deps, tooManyCopies)).toThrow(/copy/);

    const badHero = makeSetup();
    badHero.players[0]!.heroId = 'nope';
    expect(() => createMatch(deps, badHero)).toThrow(/hero/);
  });
});

describe('муллиган', () => {
  it('перемешивает руку в колоду и даёт 5 новых; событие виден всем', () => {
    const { state } = createMatch(deps, makeSetup());
    const before = [...state.players[P1]!.hand];
    const res = applyCommand(state, { type: 'mulligan', player: P1 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[P1]!.hand).toHaveLength(5);
    expect(res.state.players[P1]!.deck).toHaveLength(35);
    expect(res.events).toContainEqual({ type: 'mulligan_made', player: P1 });
    expect(res.state.players[P1]!.hand).not.toEqual(before);
  });

  it('муллиган доступен один раз', () => {
    const { state } = createMatch(deps, makeSetup());
    const once = applyCommand(state, { type: 'mulligan', player: P1 }, deps);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = applyCommand(once.state, { type: 'mulligan', player: P1 }, deps);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.rejected.code).toBe('mulligan_unavailable');
  });

  it('матч стартует, когда оба решили; первый ход у p1 с бесплатным добором', () => {
    const s = startedMatch();
    expect(s.status).toBe('running');
    expect(s.activePlayer).toBe(P1);
    expect(s.turn).toBe(1);
    expect(s.round).toBe(1);
    expect(s.phase).toBe('main');
    expect(s.players[P1]!.hand).toHaveLength(6);
    expect(s.players[P1]!.actions).toBe(2);
  });
});

describe('ход', () => {
  it('передаёт ход по кругу и сжигает действия', () => {
    let s = startedMatch();
    const res = applyCommand(s, { type: 'go_battle', player: P1 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    s = res.state;
    expect(s.activePlayer).toBe(P2);
    expect(s.turn).toBe(2);
    expect(s.round).toBe(1);
    expect(s.players[P2]!.actions).toBe(2);
    expect(s.castSpells).toHaveLength(0);
    // p1's leftover actions burned
    expect(s.players[P1]!.actions).toBe(0);
  });

  it('второй круг начинается после хода последнего игрока', () => {
    let s = startedMatch();
    s = mustOk(applyCommand(s, { type: 'go_battle', player: P1 }, deps));
    s = mustOk(applyCommand(s, { type: 'go_battle', player: P2 }, deps));
    expect(s.activePlayer).toBe(P1);
    expect(s.turn).toBe(3);
    expect(s.round).toBe(2);
  });

  it('герой Бимо даёт дополнительный добор в начале хода', () => {
    const { state } = createMatch(deps, makeSetup({ p1Hero: 'hero-bimo', seed: 7 }));
    let s = mustOk(applyCommand(state, { type: 'keep_hand', player: P1 }, deps));
    s = mustOk(applyCommand(s, { type: 'keep_hand', player: P2 }, deps));
    expect(s.players[P1]!.hand).toHaveLength(7);
  });

  it('start_of_turn эффект карты срабатывает в начале хода владельца', () => {
    let s = startedMatch(99);
    s = forceToHand(s, P1, 'start-of-turn-mill');
    const deckBefore = s.players[P1]!.deck.length;
    s = mustOk(applyCommand(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'start-of-turn-mill'), zone: 0 }, deps));
    // два конца хода → снова ход p1, эффект сработал при старте его хода
    s = mustOk(applyCommand(s, { type: 'go_battle', player: P1 }, deps));
    const res2 = applyCommand(s, { type: 'go_battle', player: P2 }, deps);
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    s = res2.state;
    expect(s.activePlayer).toBe(P1);
    expect(s.players[P1]!.deck.length).toBe(deckBefore - 2); // добор хода + сброс от эффекта
    expect(
      res2.events.some((e) => e.type === 'card_discarded' && e.from === 'deck' && e.player === P1),
    ).toBe(true);
  });
});
