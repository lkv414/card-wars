import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@card-wars/protocol';
import {
  calculateCameraAnchor,
  classifySwipe,
  getNextPlayerId,
  interpolateCameraPose,
  isTopSnap,
  resolveTargetPlayer,
} from './cameraSnap';

function makeMockView(overrides?: Partial<PlayerView>): PlayerView {
  return {
    status: 'running',
    mode: 'ffa',
    phase: 'main',
    round: 1,
    turnNumber: 1,
    activePlayers: ['p0'],
    order: ['p0', 'p1'],
    me: 'p0',
    teams: null,
    teamVariant: null,
    myHand: [],
    board: {
      p0: Array(4).fill(null).map((_, i) => ({ zone: i, land: null, creature: null, building: null, frozen: false })),
      p1: Array(4).fill(null).map((_, i) => ({ zone: i, land: null, creature: null, building: null, frozen: false })),
    },
    players: {
      p0: {
        id: 'p0',
        name: 'Player 0',
        heroId: 'finn',
        health: 25,
        maxHealth: 25,
        actions: 2,
        maxActions: 2,
        deckCount: 30,
        discard: [],
        handCount: 5,
        eliminated: false,
        disconnected: false,
        battleReady: false,
      },
      p1: {
        id: 'p1',
        name: 'Player 1',
        heroId: 'jake',
        health: 25,
        maxHealth: 25,
        actions: 0,
        maxActions: 2,
        deckCount: 30,
        discard: [],
        handCount: 5,
        eliminated: false,
        disconnected: false,
        battleReady: false,
      },
    },
    revealed: {},
    pending: null,
    winner: null,
    journal: [],
    ...overrides,
  } as unknown as PlayerView;
}

describe('cameraSnap', () => {
  it('identifies top snap correctly', () => {
    expect(isTopSnap('top')).toBe(true);
    expect(isTopSnap('top_p1')).toBe(true);
    expect(isTopSnap('player_p0')).toBe(false);
    expect(isTopSnap('self')).toBe(false);
  });

  it('resolves target player based on camera mode and snap', () => {
    const view = makeMockView();

    // explicit player snap targets that player
    expect(resolveTargetPlayer(view, 'self', 'player_p1')).toBe('p1');
    expect(resolveTargetPlayer(view, 'manual', 'player_p1')).toBe('p1');
    expect(resolveTargetPlayer(view, 'manual', 'top_p1')).toBe('p1');
    expect(resolveTargetPlayer(view, 'manual', 'player_me')).toBe('p0');
    expect(resolveTargetPlayer(view, 'manual', 'player_unknown')).toBe('p0');

    // self mode / self snap targets me
    expect(resolveTargetPlayer(view, 'self', 'self')).toBe('p0');
    expect(resolveTargetPlayer(view, 'self', undefined)).toBe('p0');

    // follow mode targets active player when no explicit player snap
    expect(resolveTargetPlayer(view, 'follow', 'top')).toBe('p0');
    expect(resolveTargetPlayer(makeMockView({ activePlayers: ['p1'] }), 'follow', 'top')).toBe('p1');
  });

  it('cycles players in circular order', () => {
    const view = makeMockView({ order: ['p0', 'p1', 'p2'] });
    const p1 = (view.players as Record<string, unknown>).p1 as object;
    (view.players as Record<string, unknown>).p2 = { ...p1, id: 'p2', nickname: 'Player 2' };

    expect(getNextPlayerId(view, 'p0', 'next')).toBe('p1');
    expect(getNextPlayerId(view, 'p1', 'next')).toBe('p2');
    expect(getNextPlayerId(view, 'p2', 'next')).toBe('p0');

    expect(getNextPlayerId(view, 'p0', 'prev')).toBe('p2');
    expect(getNextPlayerId(view, 'p2', 'prev')).toBe('p1');
  });

  it('calculates anchor for perspective player view', () => {
    const view = makeMockView();
    const anchor = calculateCameraAnchor(view, 'p0', false, 1.6, 1);

    expect(anchor.isTop).toBe(false);
    expect(anchor.u).toBe(0);
    expect(anchor.up.y).toBe(1);
    expect(anchor.position.y).toBeGreaterThan(100);
    expect(anchor.position.z).toBeGreaterThan(100);
    expect(anchor.lookAt.y).toBe(0);
  });

  it('calculates anchor for top-down view with orientation toward player', () => {
    const view = makeMockView();
    const anchorP0 = calculateCameraAnchor(view, 'p0', true, 1.6, 1);

    expect(anchorP0.isTop).toBe(true);
    expect(anchorP0.u).toBe(1);
    expect(anchorP0.position.x).toBe(0);
    expect(anchorP0.position.z).toBe(0);
    expect(anchorP0.position.y).toBeGreaterThan(400);
    expect(anchorP0.lookAt.x).toBe(0);
    expect(anchorP0.lookAt.z).toBe(0);
    // For p0 (angle = 0), up is (0, 0, -1), placing p0 at bottom of screen
    expect(anchorP0.up.x).toBeCloseTo(0);
    expect(anchorP0.up.z).toBeCloseTo(-1);

    // For p1 (angle = PI), up is (0, 0, 1), placing p1 at bottom of screen
    const anchorP1 = calculateCameraAnchor(view, 'p1', true, 1.6, 1);
    expect(anchorP1.up.x).toBeCloseTo(0);
    expect(anchorP1.up.z).toBeCloseTo(1);
  });

  it('interpolates smoothly between perspective and top-down view without NaN', () => {
    const view = makeMockView();
    for (let u = 0; u <= 1; u += 0.2) {
      const pose = interpolateCameraPose(view, 0, u, 1.6, 1);
      expect(Number.isNaN(pose.position.x)).toBe(false);
      expect(Number.isNaN(pose.position.y)).toBe(false);
      expect(Number.isNaN(pose.position.z)).toBe(false);
      expect(Number.isNaN(pose.up.x)).toBe(false);
      expect(Number.isNaN(pose.up.y)).toBe(false);
      expect(Number.isNaN(pose.up.z)).toBe(false);
      expect(pose.up.length()).toBeCloseTo(1, 4);
    }
  });

  it('classifies drag swipes accurately', () => {
    expect(classifySwipe(0, 60)).toBe('down');
    expect(classifySwipe(0, -60)).toBe('up');
    expect(classifySwipe(-60, 0)).toBe('left');
    expect(classifySwipe(60, 0)).toBe('right');
    // under threshold
    expect(classifySwipe(10, 10)).toBe(null);
  });
});
