import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@card-wars/protocol';
import {
  cycleCameraPlayer,
  emitEmote,
  setCameraSnap,
  setUi,
  snapCameraPlayer,
  snapCameraTop,
  useGame,
} from '../../store';

function makeMockView(overrides?: Partial<PlayerView>): PlayerView {
  return {
    status: 'running',
    mode: 'ffa',
    phase: 'main',
    round: 1,
    turn: 1,
    activePlayers: ['p0'],
    activePlayer: 'p0',
    order: ['p0', 'p1'],
    me: 'p0',
    anyLand: false,
    teams: null,
    teamVariant: null,
    myHand: [],
    castSpells: [],
    revealed: {},
    myPeek: [],
    pending: null,
    winners: null,
    finishReason: null,
    journal: [],
    myWord: null,
    players: {
      p0: {
        id: 'p0',
        nickname: 'Player 0',
        heroId: 'bmo',
        lives: 25,
        maxLives: 25,
        actions: 2,
        connected: true,
        lands: [],
        zones: [],
        deckCount: 30,
        handCount: 5,
        discard: [],
        companion: null,
        surrendered: false,
        eliminated: false,
        teamId: null,
        battleReady: false,
        mulliganDecision: null,
      },
      p1: {
        id: 'p1',
        nickname: 'Player 1',
        heroId: 'billy',
        lives: 25,
        maxLives: 25,
        actions: 0,
        connected: true,
        lands: [],
        zones: [],
        deckCount: 30,
        handCount: 5,
        discard: [],
        companion: null,
        surrendered: false,
        eliminated: false,
        teamId: null,
        battleReady: false,
        mulliganDecision: null,
      },
    },
    ...overrides,
  };
}

describe('HudSidebar & Store Integration', () => {
  it('updates cameraSnap and cameraMode on snapCameraTop', () => {
    snapCameraTop();
    const state = useGame.getState();
    expect(state.ui.cameraSnap).toBe('top');
    expect(state.ui.cameraMode).toBe('top');
  });

  it('updates cameraSnap on snapCameraPlayer', () => {
    useGame.setState({ view: makeMockView() });
    snapCameraPlayer('p0');
    expect(useGame.getState().ui.cameraSnap).toBe('self');

    snapCameraPlayer('p1');
    expect(useGame.getState().ui.cameraSnap).toBe('player_p1');
  });

  it('cycles through alive players with cycleCameraPlayer', () => {
    useGame.setState({
      view: makeMockView({ order: ['p0', 'p1', 'p2'], players: {
        ...makeMockView().players,
        p2: { ...makeMockView().players.p1!, id: 'p2', nickname: 'Player 2' },
      } }),
    });

    setCameraSnap('self');
    cycleCameraPlayer('next');
    expect(useGame.getState().ui.cameraSnap).toBe('player_p1');

    cycleCameraPlayer('next');
    expect(useGame.getState().ui.cameraSnap).toBe('player_p2');

    cycleCameraPlayer('next');
    expect(useGame.getState().ui.cameraSnap).toBe('self');
  });

  it('emits active emote toast via emitEmote', () => {
    emitEmote('Finn', 'Флюпни это!', '🌀');
    const toast = useGame.getState().ui.activeEmote;
    expect(toast).not.toBeNull();
    expect(toast?.sender).toBe('Finn');
    expect(toast?.text).toBe('Флюпни это!');
    expect(toast?.emoji).toBe('🌀');
  });

  it('handles combat forecast hover toggle via setUi', () => {
    setUi({ combatForecastHover: true });
    expect(useGame.getState().ui.combatForecastHover).toBe(true);
    setUi({ combatForecastHover: false });
    expect(useGame.getState().ui.combatForecastHover).toBe(false);
  });

  it('correctly calculates 2v2 team readiness state', () => {
    const view2v2 = makeMockView({
      mode: 'teams',
      teamVariant: 'wall',
      teams: {
        'team-a': {
          id: 'team-a',
          playerIds: ['p0', 'p1'],
          lives: 40,
          maxLives: 40,
          eliminated: false,
        },
      },
    });
    view2v2.players.p0!.teamId = 'team-a';
    view2v2.players.p1!.teamId = 'team-a';
    view2v2.players.p0!.battleReady = true;
    view2v2.players.p1!.battleReady = false;

    const me = view2v2.players[view2v2.me]!;
    const myTeam = me.teamId ? view2v2.teams?.[me.teamId] : null;
    const teammateId = myTeam?.playerIds.find((id) => id !== view2v2.me);
    const teammate = teammateId ? view2v2.players[teammateId] : null;
    const teamReadyCount = (me.battleReady ? 1 : 0) + (teammate?.battleReady ? 1 : 0);

    expect(teamReadyCount).toBe(1);
    expect(me.battleReady).toBe(true);
    expect(teammate?.battleReady).toBe(false);
  });
});
