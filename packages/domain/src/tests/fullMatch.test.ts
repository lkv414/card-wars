import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch, type Command, type MatchState } from '../index';
import {
  buildDeck,
  catalog,
  defaultConfig,
  forceToHand,
  handCardId,
  makeSetup,
  mustOk,
  P1,
  P2,
  P1_POOL,
} from './helpers';

const deps = { config: defaultConfig, catalog };

const AGGRESSIVE_P2 = [
  'big-swamp',
  'cheap-rainbow',
  'vanilla-swamp',
  'vanilla-corn',
  'floop-shield',
  'spell-heal-face',
  'freezer',
  'bomber',
  'grand-fortress',
  'floop-paid-damage',
];

function newGame(seed = 2026): MatchState {
  const { state } = createMatch(
    deps,
    makeSetup({ seed, p2Deck: buildDeck(AGGRESSIVE_P2) }),
  );
  let s = mustOk(applyCommand(state, { type: 'keep_hand', player: P1 }, deps));
  s = mustOk(applyCommand(s, { type: 'keep_hand', player: P2 }, deps));
  return s;
}

/**
 * Скрипт партии: p1 всегда сразу «В бой», p2 каждый ход выставляет big-swamp (5 АТК)
 * в следующую зону и атакует. p1 не защищается — урон идёт в лицо.
 */
function script(seed = 2026): { final: MatchState; finished: boolean } {
  let s = newGame(seed);
  let guard = 0;
  while (s.status !== 'finished' && guard++ < 100) {
    const player = s.activePlayer;
    let cmd: Command;
    if (player === P1) {
      cmd = { type: 'go_battle', player: P1 };
    } else {
      const zone = (s.turn - 1) % 4;
      if (!s.players[P2]!.zones[zone]!.creature) {
        s = forceToHand(s, P2, 'big-swamp');
        const play = applyCommand(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'big-swamp'), zone }, deps);
        if (!play.ok) throw new Error(`play: ${play.rejected.code}`);
        s = play.state;
      }
      cmd = { type: 'go_battle', player: P2 };
    }
    const res = applyCommand(s, cmd, deps);
    if (!res.ok) throw new Error(`${cmd.type}: ${res.rejected.code} — ${res.rejected.message}`);
    s = res.state;
  }
  return { final: s, finished: s.status === 'finished' };
}

describe('полная партия', () => {
  it('доходит до победы по жизням', () => {
    const { final, finished } = script();
    expect(finished).toBe(true);
    expect(final.winners).toEqual([P2]);
    expect(final.finishReason).toBe('elimination');
    expect(final.players[P1]!.eliminated).toBe(true);
    expect(final.players[P1]!.lives).toBeLessThanOrEqual(0);
    expect(final.players[P2]!.lives).toBe(25); // p1 ни разу не атаковал
  });

  it('детерминирована: одинаковый сид — одинаковая партия', () => {
    const a = script(777).final;
    const b = script(777).final;
    expect(a).toEqual(b);
  });

  it('обрыв соединения: поражение обрывавшему (команда сервера disconnect_loss)', () => {
    const s = newGame();
    const res = applyCommand(s, { type: 'disconnect_loss', player: P2 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.status).toBe('finished');
    expect(res.state.winners).toEqual([P1]);
    expect(res.state.finishReason).toBe('disconnect');
    expect(res.events).toContainEqual({ type: 'player_disconnected', player: P2 });
    expect(res.events).toContainEqual({ type: 'match_finished', winners: [P1], reason: 'disconnect' });
  });

  it('сдача завершает партию победой соперника', () => {
    const s = newGame();
    const res = applyCommand(s, { type: 'surrender', player: P1 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.status).toBe('finished');
    expect(res.state.winners).toEqual([P2]);
    expect(res.state.finishReason).toBe('surrender');
    expect(res.state.players[P1]!.surrendered).toBe(true);
    // команды после конца партии отклоняются
    const after = applyCommand(res.state, { type: 'go_battle', player: P2 }, deps);
    expect(after.ok).toBe(false);
  });

  it('после победы партия недоступна для команд (atomic state)', () => {
    const { final } = script();
    const any = applyCommand(final, { type: 'draw_extra', player: P2 }, deps);
    expect(any.ok).toBe(false);
    if (!any.ok) expect(any.rejected.code).toBe('match_finished');
    void P1_POOL;
  });
});
