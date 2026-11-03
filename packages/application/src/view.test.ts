import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch, type MatchState } from '@card-wars/domain';
import { catalog, deckPresets } from '@card-wars/content';
import { journalLines } from './journal';
import { viewFor } from './view';

const deps = { config: {
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
}, catalog };

function newMatch(): MatchState {
  const { state } = createMatch(deps, {
    players: [
      { id: 'p1', nickname: 'Бимо', heroId: deckPresets[0]!.heroId, deck: [...deckPresets[0]!.deck], lands: [...deckPresets[0]!.lands] },
      { id: 'p2', nickname: 'Билли', heroId: deckPresets[1]!.heroId, deck: [...deckPresets[1]!.deck], lands: [...deckPresets[1]!.lands] },
    ],
    seed: 42,
  });
  const keep1 = applyCommand(state, { type: 'keep_hand', player: 'p1' }, deps);
  if (!keep1.ok) throw new Error(keep1.rejected.message);
  const keep2 = applyCommand(keep1.state, { type: 'keep_hand', player: 'p2' }, deps);
  if (!keep2.ok) throw new Error(keep2.rejected.message);
  return keep2.state;
}

describe('viewFor', () => {
  it('скрывает руку и колоду соперника — утечек нет', () => {
    const s = newMatch();
    const view = viewFor(deps, s, 'p1', { journal: [] });
    expect(view.me).toBe('p1');
    // 5 стартовых + добор (способности героев вернутся с механиками v2 — docs/TECH.md № 2)
    expect(view.myHand).toHaveLength(6);
    // чужая рука представлена только счётчиком (p2 ещё не ходил — добора не было)
    expect(view.players.p2!.handCount).toBe(5);
    // ни один id карты из руки/колоды p2 не встречается в JSON вида
    const json = JSON.stringify(view);
    for (const id of s.players.p2!.hand) expect(json).not.toContain(`"${id}"`);
    for (const id of s.players.p2!.deck) expect(json).not.toContain(`"${id}"`);
    // карточные id в руке вида — только собственные
    for (const card of view.myHand) {
      expect(s.players.p1!.hand).toContain(card.instanceId);
    }
  });

  it('пробрасывает публичное вскрытие колоды в вид', () => {
    const s = newMatch();
    const instanceId = s.players.p1!.deck[0]!;
    const edited = JSON.parse(JSON.stringify(s)) as MatchState;
    edited.revealed = { p1: [instanceId] };
    const view = viewFor(deps, edited, 'p2');
    expect(view.revealed.p1).toEqual([
      { instanceId, cardId: s.instances[instanceId]!.cardId },
    ]);
  });

  it('сброс и поле открыты, эффективные статы посчитаны', () => {
    const s = newMatch();
    const handId = s.players.p1!.hand[0]!;
    const play = applyCommand(s, { type: 'discard_from_hand', player: 'p1', instanceId: handId }, deps);
    expect(play.ok).toBe(true);
    if (!play.ok) return;
    const view = viewFor(deps, play.state, 'p2');
    expect(view.players.p1!.discard).toHaveLength(1);
    expect(view.players.p1!.discard[0]!.instanceId).toBe(handId);
  });
});

describe('viewFor — 2 на 2', () => {
  it('отдаёт режим, команды и обоих активных союзников', () => {
    const { state } = createMatch(deps, {
      players: [0, 1, 2, 3].map((i) => ({
        id: `p${i + 1}`,
        nickname: `Игрок ${i + 1}`,
        heroId: deckPresets[i % 2]!.heroId,
        deck: [...deckPresets[i % 2]!.deck],
        lands: [...deckPresets[i % 2]!.lands],
      })),
      seed: 7,
      mode: 'teams',
      teamVariant: 'wall',
    });
    let s = state;
    for (const pid of state.order) {
      const res = applyCommand(s, { type: 'keep_hand', player: pid }, deps);
      if (!res.ok) throw new Error(res.rejected.message);
      s = res.state;
    }
    const view = viewFor(deps, s, 'p1');
    expect(view.mode).toBe('teams');
    expect(view.teamVariant).toBe('wall');
    expect(view.teams!['team-a']!.playerIds).toEqual(['p1', 'p2']);
    expect(view.activePlayers).toEqual(['p1', 'p2']);
    expect(view.players.p1!.teamId).toBe('team-a');
    expect(view.players.p1!.lives).toBe(50);
    expect(view.players.p1!.battleReady).toBe(false);

    const json = JSON.stringify(view);
    for (const id of s.players.p2!.hand) expect(json).not.toContain(`"${id}"`);
  });
});

describe('journalLines', () => {
  it('формирует русские строки для ключевых событий', () => {
    const s = newMatch();
    const res = applyCommand(s, { type: 'go_battle', player: 'p1' }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lines = journalLines(deps, res.state, res.events);
    expect(lines.some((l) => l.includes('Ход 2') && l.includes('Билли'))).toBe(true);
    const revealEvent = [{ type: 'cards_revealed' as const, player: 'p1' as const, cardIds: [s.players.p1!.deck[0]!] }];
    expect(journalLines(deps, s, revealEvent)[0]).toContain('открывает');
    const started = journalLines(deps, s, [{ type: 'match_started', players: [
      { id: 'p1', nickname: 'Бимо', heroId: 'hero_bmo' },
      { id: 'p2', nickname: 'Билли', heroId: 'hero_billy' },
    ], firstPlayer: 'p1', mode: 'ffa', teamVariant: null, teams: null }]);
    expect(started[0]).toContain('Партия начата');
    expect(started[0]).toContain('Бимо');
    expect(started[0]).toContain('Билли');
  });
});
