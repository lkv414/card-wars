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
