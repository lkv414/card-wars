import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createMatch,
  type Command,
  type MatchState,
  type PlayerSetup,
} from '../index';
import {
  buildDeck,
  catalog,
  defaultConfig,
  forceToHand,
  handCardId,
  mustOk,
  P1,
  P1_POOL,
  P2,
  P2_POOL,
  refillActions,
} from './helpers';

const deps = { config: defaultConfig, catalog };
const P3 = 'p3';
const P4 = 'p4';
const LANDS = [
  ['swamp', 'swamp', 'swamp', 'rainbow'],
  ['corn', 'corn', 'good', 'swamp'],
  ['swamp', 'swamp', 'swamp', 'rainbow'],
  ['corn', 'corn', 'good', 'swamp'],
] as const;

function newTeamMatch(seed = 2026): MatchState {
  const players: PlayerSetup[] = [P1, P2, P3, P4].map((id, i) => ({
    id,
    nickname: `Игрок ${i + 1}`,
    heroId: 'hero-billy',
    deck: buildDeck(i % 2 === 0 ? P1_POOL : P2_POOL),
    lands: [...LANDS[i]!],
  }));
  const { state } = createMatch(deps, {
    players,
    seed,
    mode: 'teams',
    teamVariant: 'wall',
  });
  let s = state;
  for (const pid of state.order) s = mustOk(applyCommand(s, { type: 'keep_hand', player: pid }, deps));
  return s;
}

function edit(state: MatchState, fn: (draft: MatchState) => void): MatchState {
  const draft = JSON.parse(JSON.stringify(state)) as MatchState;
  fn(draft);
  return draft;
}

function placeInZone(s: MatchState, playerId: string, zone: number, cardId: string): MatchState {
  return edit(s, (d) => {
    const deckId = d.players[playerId]!.deck[0];
    if (!deckId) throw new Error(`deck of ${playerId} is empty`);
    d.players[playerId]!.deck = d.players[playerId]!.deck.filter((id) => id !== deckId);
    d.instances[deckId]!.cardId = cardId;
    d.instances[deckId]!.location = 'field';
    d.instances[deckId]!.zone = zone;
    d.instances[deckId]!.slot = 'creature';
    d.instances[deckId]!.playedTurn = d.turn;
    d.players[playerId]!.zones[zone]!.creature = deckId;
  });
}

function withTurnCounters(s: MatchState, counters: Record<string, number>): MatchState {
  return edit(s, (d) => {
    d.turnCounters = { ...d.turnCounters, ...counters };
  });
}

function turn(s: MatchState, command: Command): MatchState {
  return mustOk(applyCommand(s, command, deps));
}

function battle(s: MatchState, player: string): MatchState {
  return turn(s, { type: 'go_battle', player });
}

describe('парные карты 2 на 2', () => {
  it('Вклад даёт карту другому партнёру после трёх доборов', () => {
    let s = newTeamMatch();
    s = forceToHand(s, P2, 'companion-ally-draw');
    const played = mustOk(applyCommand(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'companion-ally-draw') }, deps));
    s = withTurnCounters(played, { [`cards_drawn:${P1}`]: 3 });

    const before = s.players[P2]!.hand.length;
    s = battle(s, P1);
    s = battle(s, P2);
    expect(s.pending?.player).toBe(P2);
    s = turn(s, {
      type: 'resolve_choice',
      player: P2,
      answer: { proceed: true },
    });
    expect(s.players[P2]!.hand.length).toBe(before + 1);
  });

  it('Подмога считает сыгранные существа стоимостью 2+ на стороне команды', () => {
    let s = newTeamMatch(2027);
    s = forceToHand(s, P2, 'companion-support-draw');
    s = turn(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'companion-support-draw') });
    s = withTurnCounters(s, { [`creature_cost_2_plus_played:${P1}`]: 1 });

    const before = s.players[P2]!.hand.length;
    s = battle(s, P1);
    s = battle(s, P2);
    expect(s.pending?.player).toBe(P2);
    s = turn(s, {
      type: 'resolve_choice',
      player: P2,
      answer: { proceed: true },
    });
    expect(s.players[P2]!.hand.length).toBe(before + 1);
  });

  it('Товарищество бьёт вражескую команду, когда вражеское существо бьёт твою', () => {
    let s = newTeamMatch(2028);
    s = forceToHand(s, P1, 'companion-team-retaliation');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'companion-team-retaliation') });
    s = placeInZone(s, P4, 1, 'vanilla-swamp');

    s = battle(s, P1);
    s = battle(s, P2);
    s = battle(s, P3);
    s = battle(s, P4);
    s = battle(s, P1);
    s = battle(s, P2);
    s = battle(s, P3);
    s = battle(s, P4);
    expect(s.teams!['team-b']!.lives).toBe(defaultConfig.teamStartingLives - 1);
  });

});

describe('именованная механика copy_spell (Связь)', () => {
  it('партнёр копирует радужное заклинание стоимости 0 и выбирает новую цель', () => {
    let s = newTeamMatch(2029);
    s = forceToHand(s, P1, 'companion-copier');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'companion-copier') });
    s = placeInZone(s, P1, 0, 'vanilla-swamp');
    s = placeInZone(s, P3, 0, 'vanilla-corn');
    s = placeInZone(s, P3, 1, 'vanilla-corn');

    s = forceToHand(s, P1, 'spell-bolt-0');
    const bolt = handCardId(s, P1, 'spell-bolt-0');
    const original = s.players[P3]!.zones[0]!.creature!;
    const copyTarget = s.players[P3]!.zones[1]!.creature!;
    s = turn(s, { type: 'play_card', player: P1, instanceId: bolt, targets: [{ kind: 'creature', instanceId: original }] });
    const castResult = applyCommand(s, { type: 'resolve_choice', player: P2, answer: { proceed: true } }, deps);
    // Оригинал применён сразу; «другой партнёр» (P2) решает, копировать ли.
    expect(s.instances[original]!.damage).toBe(2);
    expect(s.pending?.player).toBe(P2);
    expect(s.pending?.ask.kind).toBe('optional');
    if (!castResult.ok) throw new Error(castResult.rejected.message);
    s = castResult.state;
    // Цель копии спрашивается по targets скопированного заклинания, легальные для P2.
    expect(s.pending?.ask.kind).toBe('target');
    const resolvedResult = applyCommand(s, {
      type: 'resolve_choice',
      player: P2,
      answer: { targets: [{ kind: 'creature', instanceId: copyTarget }] },
    }, deps);
    if (!resolvedResult.ok) throw new Error(resolvedResult.rejected.message);
    const resolved = resolvedResult.state;
    expect(resolved.instances[copyTarget]!.damage).toBe(2);
    expect(resolved.instances[bolt]!.location).toBe('discard'); // копия не двигает карты
    // Событие копии — в шаге «согласился копировать», цель приходит отдельным ответом.
    expect(castResult.events.some((e) => e.type === 'spell_cast' && e.player === P2 && e.copy === true)).toBe(true);
    expect(resolvedResult.events.some((e) => e.type === 'spell_cast' && e.player === P2 && e.copy === true)).toBe(false);
  });

  it('отказ партнёра не копирует заклинание', () => {
    let s = newTeamMatch(2030);
    s = forceToHand(s, P1, 'companion-copier');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'companion-copier') });
    s = placeInZone(s, P3, 0, 'vanilla-corn');
    s = forceToHand(s, P1, 'spell-bolt-0');
    const target = s.players[P3]!.zones[0]!.creature!;
    s = turn(s, {
      type: 'play_card',
      player: P1,
      instanceId: handCardId(s, P1, 'spell-bolt-0'),
      targets: [{ kind: 'creature', instanceId: target }],
    });
    expect(s.pending?.player).toBe(P2);
    s = turn(s, { type: 'resolve_choice', player: P2, answer: { proceed: false } });
    expect(s.pending).toBeNull();
  });

  it('заклинание не стоимости 0 не копируется', () => {
    let s = newTeamMatch(2031);
    s = forceToHand(s, P1, 'companion-copier');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'companion-copier') });
    s = placeInZone(s, P3, 0, 'vanilla-corn');
    s = forceToHand(s, P1, 'spell-bolt-1');
    const target = s.players[P3]!.zones[0]!.creature!;
    s = turn(s, {
      type: 'play_card',
      player: P1,
      instanceId: handCardId(s, P1, 'spell-bolt-1'),
      targets: [{ kind: 'creature', instanceId: target }],
    });
    expect(s.pending).toBeNull();
    expect(s.instances[target]!.damage).toBe(2);
  });

  it('не радужное заклинание не копируется', () => {
    let s = newTeamMatch(2032);
    s = forceToHand(s, P1, 'companion-copier');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'companion-copier') });
    s = forceToHand(s, P1, 'spell-swamp-0');
    const before = s.players[P1]!.hand.length;
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'spell-swamp-0') });
    expect(s.pending).toBeNull();
    expect(s.players[P1]!.hand.length).toBe(before); // on_cast уже тянул карту
  });

  it('копирует только один раз за партию', () => {
    let s = newTeamMatch(2033);
    s = forceToHand(s, P1, 'companion-copier');
    s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'companion-copier') });
    s = placeInZone(s, P3, 0, 'vanilla-corn');
    s = forceToHand(s, P1, 'spell-bolt-0');
    const target = s.players[P3]!.zones[0]!.creature!;
    s = turn(s, {
      type: 'play_card',
      player: P1,
      instanceId: handCardId(s, P1, 'spell-bolt-0'),
      targets: [{ kind: 'creature', instanceId: target }],
    });
    s = turn(s, { type: 'resolve_choice', player: P2, answer: { proceed: true } });
    s = turn(s, { type: 'resolve_choice', player: P2, answer: { targets: [{ kind: 'creature', instanceId: target }] } });
    expect(s.pending).toBeNull();

    // Вторая копия в той же партии не предлагается.
    s = refillActions(s, P1);
    s = forceToHand(s, P1, 'spell-bolt-0');
    s = turn(s, {
      type: 'play_card',
      player: P1,
      instanceId: handCardId(s, P1, 'spell-bolt-0'),
      targets: [{ kind: 'creature', instanceId: target }],
    });
    expect(s.pending).toBeNull();
  });
});
