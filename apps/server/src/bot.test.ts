import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch } from '@card-wars/domain';
import { viewFor } from '@card-wars/application';
import { catalog, deckPresets } from '@card-wars/content';
import { decideBotCommand } from './bot';
import { config } from './config';

const deps = { config, catalog };

function newMatch(seed = 99) {
  const { state } = createMatch(deps, {
    players: [
      {
        id: 'p1',
        nickname: 'Бот',
        heroId: deckPresets[0]!.heroId,
        deck: [...deckPresets[0]!.deck],
        lands: [...deckPresets[0]!.lands],
      },
      {
        id: 'p2',
        nickname: 'Игрок',
        heroId: deckPresets[1]!.heroId,
        deck: [...deckPresets[1]!.deck],
        lands: [...deckPresets[1]!.lands],
      },
    ],
    seed,
  });
  return state;
}

describe('бот', () => {
  it('на муллигане принимает решение и не трогает чужую руку', () => {
    const state = newMatch();
    const view = viewFor(deps, state, 'p1');
    const command = decideBotCommand(view, deps);
    expect(command).not.toBeNull();
    expect(['keep_hand', 'mulligan']).toContain(command!.type);
    expect(command!.player).toBe('p1');
  });

  it('в свой ход возвращает команду своего игрока', () => {
    let state = newMatch();
    for (const pid of ['p1', 'p2']) {
      const res = applyCommand(state, { type: 'keep_hand', player: pid }, deps);
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }
    const view = viewFor(deps, state, 'p1', { journal: [] });
    const command = decideBotCommand(view, deps);
    expect(command).not.toBeNull();
    expect(command!.player).toBe('p1');
    expect(['play_card', 'floop', 'draw_extra', 'go_battle']).toContain(command!.type);
  });

  it('не действует, когда ходит другой игрок', () => {
    let state = newMatch();
    for (const pid of ['p1', 'p2']) {
      const res = applyCommand(state, { type: 'keep_hand', player: pid }, deps);
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }
    const view = viewFor(deps, state, 'p2', { journal: [] });
    expect(decideBotCommand(view, deps)).toBeNull();
  });
});
