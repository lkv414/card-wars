import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@card-wars/protocol';
import {
  CARD_H,
  CARD_W,
  HALF_H,
  HALF_W,
  LAND_GAP,
  LAND_H,
  LAND_W,
  ROW_LEN,
  ROW_Z,
  ZONE_COUNT,
  boardTransform,
  localToWorld,
  playerAccessoriesTransform,
  slotLocalZ,
  worldOfDeck,
  worldOfDiscard,
  worldOfHero,
  worldOfSlot,
  worldToLocal,
  zoneFromWorld,
  zoneWorldTransform,
  zoneX,
} from './layout';

function makeMockView(players: string[], me: string = players[0]!): PlayerView {
  return {
    gameId: 'test-game',
    status: 'running',
    round: 1,
    turn: 1,
    activePlayer: me,
    activePlayers: [me],
    priorityPlayer: me,
    phase: 'main',
    mode: 'ffa',
    order: players,
    me,
    players: Object.fromEntries(
      players.map((pid) => [
        pid,
        {
          id: pid,
          nickname: pid,
          heroId: 'finn',
          lives: 25,
          actions: 2,
          maxActions: 2,
          deckCount: 30,
          discard: [],
          lands: [
            { type: 'corn', frozen: false, flipped: false, iceTokens: 0 },
            { type: 'corn', frozen: false, flipped: false, iceTokens: 0 },
            { type: 'corn', frozen: false, flipped: false, iceTokens: 0 },
            { type: 'corn', frozen: false, flipped: false, iceTokens: 0 },
          ],
          zones: [
            { creature: null, building: null },
            { creature: null, building: null },
            { creature: null, building: null },
            { creature: null, building: null },
          ],
          companion: null,
          battleReady: false,
          eliminated: false,
        },
      ]),
    ),
    myHand: [],
    winner: null,
    castSpells: [],
    events: [],
  } as unknown as PlayerView;
}

/** Helper: computes the 3D world position of a land's top (combat front) edge. */
function landTopEdge(t: { x: number; z: number; rotation: number }) {
  const sin = Math.sin(t.rotation);
  const cos = Math.cos(t.rotation);
  return {
    x: t.x + (LAND_H / 2) * (-sin),
    z: t.z + (LAND_H / 2) * (-cos),
  };
}

describe('Table geometry and dimensions', () => {
  it('has correct land dimensions matching real land art aspect ratio 489:706', () => {
    expect(LAND_W).toBe(133);
    expect(LAND_H).toBe(192);
    expect(HALF_W).toBe(133);
    expect(HALF_H).toBe(96);
    expect(CARD_W).toBe(63);
    expect(CARD_H).toBe(89);
    // Aspect ratio matches original scans (~0.6926)
    expect(Math.abs(LAND_W / LAND_H - 133 / 192)).toBeLessThan(1e-6);
    expect(Math.abs(LAND_W / LAND_H - 489 / 706)).toBeLessThan(0.001);
  });

  it('creature and building slots fit within 133x96 halves with comfortable margins', () => {
    expect(slotLocalZ('creature')).toBe(-48);
    expect(slotLocalZ('building')).toBe(48);
    // 63x89 cards inside 133x96 half: margins in X = (133 - 63)/2 = 35mm, Z = (96 - 89)/2 = 3.5mm
    expect(HALF_W - CARD_W).toBe(70);
    expect(HALF_H - CARD_H).toBe(7);
  });

  it('ROW_LEN and ROW_Z calculations are correct', () => {
    expect(ROW_LEN).toBe(ZONE_COUNT * LAND_W + (ZONE_COUNT - 1) * LAND_GAP); // 562
    expect(ROW_LEN).toBe(562);
    expect(ROW_Z).toBe(LAND_H / 2); // 96
  });

  it('zoneX calculates centered coordinates for 4 zones', () => {
    const x0 = zoneX(0);
    const x1 = zoneX(1);
    const x2 = zoneX(2);
    const x3 = zoneX(3);
    // Symmetric around 0
    expect(x0).toBe(-x3);
    expect(x1).toBe(-x2);
    expect(x1 - x0).toBe(LAND_W + LAND_GAP);
    expect(x2 - x1).toBe(LAND_W + LAND_GAP);
    expect(x3 - x2).toBe(LAND_W + LAND_GAP);
    // Outer edges match ROW_LEN
    expect(x0 - LAND_W / 2).toBe(-ROW_LEN / 2);
    expect(x3 + LAND_W / 2).toBe(ROW_LEN / 2);
  });
});

describe('1v1 (2 players) head-to-head touching lands', () => {
  it('opponent and local lands touch head-to-head at Z = 0 with zero gap across all 4 zones', () => {
    const view = makeMockView(['p1', 'p2']);

    for (let z = 0; z < 4; z++) {
      const opposingZ = 3 - z;
      const t1 = zoneWorldTransform(view, 'p1', z)!;
      const t2 = zoneWorldTransform(view, 'p2', opposingZ)!;

      const top1 = landTopEdge(t1);
      const top2 = landTopEdge(t2);

      expect(top1.z).toBeCloseTo(0, 5);
      expect(top2.z).toBeCloseTo(0, 5);
      expect(top1.x).toBeCloseTo(top2.x, 5);
      expect(Math.hypot(top1.x - top2.x, top1.z - top2.z)).toBeLessThan(1e-5);

      // Rotations are opposite (differ by PI)
      const diffRot = Math.abs(t1.rotation - t2.rotation);
      expect(diffRot).toBeCloseTo(Math.PI, 5);
    }
  });
});

describe('FFA 3 (3 players) closed triangle arena with head-to-head touching lands', () => {
  it('zones 0-1 touch left opponent head-to-head, and zones 2-3 touch right opponent head-to-head', () => {
    const view = makeMockView(['p1', 'p2', 'p3']);

    // P1 zones 0 & 1 face P2 (left neighbor) zones 3 & 2
    // P1 zones 2 & 3 face P3 (right neighbor) zones 1 & 0
    // P2 zones 0 & 1 face P3 zones 3 & 2
    const pairs: Array<[[string, number], [string, number]]> = [
      [['p1', 0], ['p2', 3]], // P1 zone 0 <-> P2 zone 3 (outer left)
      [['p1', 1], ['p2', 2]], // P1 zone 1 <-> P2 zone 2 (inner left)
      [['p1', 2], ['p3', 1]], // P1 zone 2 <-> P3 zone 1 (inner right)
      [['p1', 3], ['p3', 0]], // P1 zone 3 <-> P3 zone 0 (outer right)
      [['p2', 0], ['p3', 3]], // P2 zone 0 <-> P3 zone 3 (outer top)
      [['p2', 1], ['p3', 2]], // P2 zone 1 <-> P3 zone 2 (inner top)
    ];

    for (const [[pA, zA], [pB, zB]] of pairs) {
      const tA = zoneWorldTransform(view, pA, zA)!;
      const tB = zoneWorldTransform(view, pB, zB)!;

      const topA = landTopEdge(tA);
      const topB = landTopEdge(tB);

      const distance = Math.hypot(topA.x - topB.x, topA.z - topB.z);
      expect(distance).toBeLessThan(1e-5);

      // Opposing lands face each other (rotations differ by PI)
      const deltaAngle = Math.atan2(Math.sin(tA.rotation - tB.rotation), Math.cos(tA.rotation - tB.rotation));
      expect(Math.abs(Math.abs(deltaAngle) - Math.PI)).toBeLessThan(1e-5);
    }
  });

  it('places player accessory stations evenly around the table center', () => {
    const view = makeMockView(['p1', 'p2', 'p3']);
    const a0 = playerAccessoriesTransform(view, 'p1')!;
    const a1 = playerAccessoriesTransform(view, 'p2')!;
    const a2 = playerAccessoriesTransform(view, 'p3')!;

    const r0 = Math.hypot(a0.x, a0.z);
    const r1 = Math.hypot(a1.x, a1.z);
    const r2 = Math.hypot(a2.x, a2.z);

    // All players are equidistant from the center
    expect(r0).toBeCloseTo(r1, 3);
    expect(r1).toBeCloseTo(r2, 3);

    // Angular spacing is 120 degrees (2*PI/3)
    const angle01 = Math.abs(a0.rotation - a1.rotation);
    const angle12 = Math.abs(a1.rotation - a2.rotation);
    expect(angle01).toBeCloseTo((2 * Math.PI) / 3, 5);
    expect(angle12).toBeCloseTo((2 * Math.PI) / 3, 5);
  });
});

describe('FFA 4 (4 players) closed square arena with head-to-head touching lands', () => {
  it('all 4 players have their lands touch their neighbors head-to-head with zero gap', () => {
    const view = makeMockView(['p1', 'p2', 'p3', 'p4']);
    const players = ['p1', 'p2', 'p3', 'p4'];

    const lanePairs: Array<[number, number]> = [[0, 3], [1, 2]];
    for (let s = 0; s < 4; s++) {
      const leftIdx = (s + 1) % 4;
      const pCurrent = players[s]!;
      const pLeft = players[leftIdx]!;

      // Zones 0 and 1 touch left neighbor's zones 3 and 2
      for (const [zA, zB] of lanePairs) {
        const tA = zoneWorldTransform(view, pCurrent, zA)!;
        const tB = zoneWorldTransform(view, pLeft, zB)!;

        const topA = landTopEdge(tA);
        const topB = landTopEdge(tB);

        const distance = Math.hypot(topA.x - topB.x, topA.z - topB.z);
        expect(distance).toBeLessThan(1e-5);
      }
    }
  });
});

describe('Coordinate transformations and zone hit testing', () => {
  it('localToWorld and worldToLocal are exact inverses', () => {
    const transform = { x: 120, z: -250, rotation: 1.25 };
    const lx = 45;
    const lz = -75;
    const world = localToWorld(transform, lx, lz);
    const recovered = worldToLocal(transform, world.x, world.z);
    expect(recovered.x).toBeCloseTo(lx, 5);
    expect(recovered.z).toBeCloseTo(lz, 5);
  });

  it('zoneFromWorld identifies zones correctly in 1v1', () => {
    const view = makeMockView(['p1', 'p2']);

    for (let z = 0; z < 4; z++) {
      const t = zoneWorldTransform(view, 'p1', z)!;
      expect(zoneFromWorld(view, t.x, t.z)).toBe(z);
    }

    // Outside bounds
    expect(zoneFromWorld(view, 5000, 0)).toBeNull();
    expect(zoneFromWorld(view, 0, 5000)).toBeNull();
  });

  it('zoneFromWorld identifies zones correctly in FFA 3', () => {
    const view = makeMockView(['p1', 'p2', 'p3']);

    for (let z = 0; z < 4; z++) {
      const t = zoneWorldTransform(view, 'p1', z)!;
      expect(zoneFromWorld(view, t.x, t.z)).toBe(z);
    }
  });

  it('world slot helpers return valid coordinates', () => {
    const view = makeMockView(['p1', 'p2']);
    const creatureSlot = worldOfSlot(view, 'p1', 0, 'creature');
    const buildingSlot = worldOfSlot(view, 'p1', 0, 'building');
    const hero = worldOfHero(view, 'p1');
    const deck = worldOfDeck(view, 'p1');
    const discard = worldOfDiscard(view, 'p1');

    expect(creatureSlot).not.toBeNull();
    expect(buildingSlot).not.toBeNull();
    expect(hero).not.toBeNull();
    expect(deck).not.toBeNull();
    expect(discard).not.toBeNull();

    // Creature is closer to center (smaller Z) than building
    expect(creatureSlot![2]).toBeLessThan(buildingSlot![2]);
    // Hero is behind building
    expect(hero![2]).toBeGreaterThan(buildingSlot![2]);
  });
});

describe('Coordinate transformations and zone hit testing', () => {
  it('localToWorld and worldToLocal are exact inverses', () => {
    const transform = { x: 120, z: -250, rotation: 1.25 };
    const lx = 45;
    const lz = -75;
    const world = localToWorld(transform, lx, lz);
    const recovered = worldToLocal(transform, world.x, world.z);
    expect(recovered.x).toBeCloseTo(lx, 5);
    expect(recovered.z).toBeCloseTo(lz, 5);
  });

  it('zoneFromWorld identifies zones correctly', () => {
    const view = makeMockView(['p1', 'p2']);
    const t = boardTransform(view, 'p1')!;

    for (let z = 0; z < 4; z++) {
      const world = localToWorld(t, zoneX(z), 0);
      expect(zoneFromWorld(view, world.x, world.z)).toBe(z);
    }

    // Outside bounds
    expect(zoneFromWorld(view, 5000, 0)).toBeNull();
    expect(zoneFromWorld(view, 0, 5000)).toBeNull();
  });

  it('world slot helpers return valid coordinates', () => {
    const view = makeMockView(['p1', 'p2']);
    const creatureSlot = worldOfSlot(view, 'p1', 0, 'creature');
    const buildingSlot = worldOfSlot(view, 'p1', 0, 'building');
    const hero = worldOfHero(view, 'p1');
    const deck = worldOfDeck(view, 'p1');
    const discard = worldOfDiscard(view, 'p1');

    expect(creatureSlot).not.toBeNull();
    expect(buildingSlot).not.toBeNull();
    expect(hero).not.toBeNull();
    expect(deck).not.toBeNull();
    expect(discard).not.toBeNull();

    // Creature is closer to center (smaller Z) than building
    expect(creatureSlot![2]).toBeLessThan(buildingSlot![2]);
    // Hero is behind building
    expect(hero![2]).toBeGreaterThan(buildingSlot![2]);
  });
});
