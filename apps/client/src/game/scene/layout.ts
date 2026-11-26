import type { PlayerView } from '@card-wars/protocol';

// Table geometry in millimetres — real proportions of the board game
// (docs/UI-3D.md «Размеры»). 1 unit = 1 mm; the scene scale is arbitrary.
// Every board is a local coordinate system facing the table centre; the player
// is always at the bottom, other seats are placed around the table.

export const LAND_W = 133;
export const LAND_H = 192; // 3D-тайл: пропорции оригинального арта земель 489×706 (0.6926), карта 63×89 в своей половине 133×96
export const LAND_GAP = 10;
export const CARD_W = 63;
export const CARD_H = 89;
export const CARD_T = 1.2;
export const TOKEN_D = 25;
export const FROST_D = 25.5;
export const TOKEN_T = 3;
export const ZONE_COUNT = 4;

export const ROW_LEN = ZONE_COUNT * LAND_W + (ZONE_COUNT - 1) * LAND_GAP; // 562
export const ROW_Z = LAND_H / 2; // 96
/**
 * Radius from table center (0, 0) to board origin so that adjacent players'
 * upper combat edges (localZ = -LAND_H / 2) meet/touch corner-to-corner forming
 * a closed regular polygon of N sides of length ROW_LEN:
 *   apothem = (ROW_LEN / 2) / tan(pi / N)
 *   ringRadius = apothem + LAND_H / 2
 */
export function ringRadius(count: number): number {
  if (count <= 2) return ROW_Z;
  return (ROW_LEN / 2) / Math.tan(Math.PI / count) + LAND_H / 2;
}

/** Column X for zone index 0..3 (local row coordinates). */
export function zoneX(zone: number): number {
  return -(ROW_LEN - LAND_W) / 2 + zone * (LAND_W + LAND_GAP);
}

/** Половины тайла: существо у линии боя, строение ближе к владельцу (docs/UI-3D.md «Размеры»). */
export const HALF_W = LAND_W;
export const HALF_H = LAND_H / 2;
/** Creature toward the centre line, building toward the owner, companion in front. */
export function slotLocalZ(slot: 'creature' | 'building' | 'companion'): number {
  if (slot === 'creature') return -HALF_H / 2;
  if (slot === 'building') return HALF_H / 2;
  return -LAND_H / 2 - 52;
}

export const deckLocal: [number, number, number] = [-ROW_LEN / 2 - 78, 4, -10];
export const discardLocal: [number, number, number] = [ROW_LEN / 2 + 78, 4, -10];
export const heroLocal: [number, number, number] = [0, 0, LAND_H / 2 + 78];
export const livesLocal: [number, number, number] = [120, 2, LAND_H / 2 + 78];
/** Жетон мороза лежит на переднем крае тайла. */
export const frostLocalZ = -LAND_H / 2 + 22;
/** Радиус попадания в стопку сброса при перетаскивании (docs/UI-3D.md «Взаимодействие»). */
export const DISCARD_HIT_RADIUS = 95;

/** Raycasting bypass helper for decorative Three.js / R3F meshes (r3f-best-practices §2). */
export const NO_RAYCAST = null as never;

export interface BoardTransform {
  x: number;
  z: number;
  rotation: number;
}

export type ZoneTransform = BoardTransform;

/**
 * 3D world transform for an individual land zone.
 * - 1v1 (2 players): two rows of 4 lands facing each other head-to-head across Z = 0.
 * - 2v2 «стенка» (wall): two rows of 8 lands facing each other head-to-head across Z = 0.
 * - 3–4 FFA / «соседи»:
 *     Zones 0 & 1 face the left neighbour (touching their zones 3 & 2 head-to-head);
 *     Zones 2 & 3 face the right neighbour (touching their zones 1 & 0 head-to-head).
 *     All N combat strips meet head-to-head with zero gap, forming a closed arena.
 */
export function zoneWorldTransform(
  view: PlayerView,
  pid: string,
  zone: number,
): ZoneTransform | null {
  const player = view.players[pid];
  if (!player || player.eliminated) return null;
  if (zone < 0 || zone >= ZONE_COUNT) return null;

  // 1. Team wall mode: 8 zones in a row per team
  if (view.mode === 'teams' && view.teamVariant === 'wall') {
    const teams = view.teams ? Object.values(view.teams) : [];
    const team = teams.find((t) => t.playerIds.includes(pid));
    if (!team) return null;
    const myTeamId = view.players[view.me]?.teamId ?? null;
    const myTeam = myTeamId ? view.teams?.[myTeamId] : null;
    const isMyTeam = myTeam?.id === team.id;
    const half = team.playerIds.indexOf(pid);
    const step = ROW_LEN + 220;
    const teamOffset = (half - (team.playerIds.length - 1) / 2) * step;
    const baseOffset = isMyTeam ? teamOffset : -teamOffset;
    const localX = zoneX(zone);
    const x = isMyTeam ? baseOffset + localX : baseOffset - localX;
    return {
      x,
      z: isMyTeam ? ROW_Z : -ROW_Z,
      rotation: isMyTeam ? 0 : Math.PI,
    };
  }

  const alive = view.order.filter((id) => !view.players[id]!.eliminated);
  if (alive.length === 0) return null;
  const meIndex = alive.indexOf(view.me);
  const ordered = meIndex >= 0 ? [...alive.slice(meIndex), ...alive.slice(0, meIndex)] : alive;
  const playerIdx = ordered.indexOf(pid);
  if (playerIdx < 0) return null;

  // 2. 1v1 mode (2 players): two 4-land rows facing head-to-head at Z = 0
  if (ordered.length === 2) {
    if (playerIdx === 0) {
      return {
        x: zoneX(zone),
        z: ROW_Z,
        rotation: 0,
      };
    } else {
      return {
        x: -zoneX(zone),
        z: -ROW_Z,
        rotation: Math.PI,
      };
    }
  }

  // 3. Multi-player mode (FFA 3, FFA 4, 2v2 neighbors):
  // N players arranged in a regular polygon.
  // Each adjacent pair of players shares a 2-lane combat strip.
  const N = ordered.length;
  const pitch = LAND_W + LAND_GAP;
  const laneOffset = pitch / 2;

  // R_strip: distance from center (0, 0) to strip midpoint where lands touch head-to-head
  // Sized so that inner edges meet forming a neat equilateral triangle (N=3) or square (N=4) without overlapping corners
  const halfAngle = Math.PI / N;
  const R_strip = N === 3 ? 280 : N === 4 ? 350 : (LAND_H + 120) / Math.tan(halfAngle);

  // Left wing (zones 0, 1): faces Left neighbor ((playerIdx - 1 + N) % N) along strip S = (playerIdx - 1 + N) % N
  // Right wing (zones 2, 3): faces Right neighbor ((playerIdx + 1) % N) along strip S = playerIdx
  // Matches domain/zones.ts neighborOf(state, pid, -1 | +1).
  const isLeftWing = zone < 2;
  const S = isLeftWing ? (playerIdx - 1 + N) % N : playerIdx;
  const isInner = zone === 1 || zone === 2;
  const n = isInner ? -laneOffset : laneOffset;
  const u = isLeftWing ? LAND_H / 2 : -LAND_H / 2;

  // Midpoint angle of strip S (increasing clockwise from +Z toward +X):
  const phi = (S + 0.5) * (2 * Math.PI / N);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);

  const uVecX = cosPhi;
  const uVecZ = -sinPhi;
  const nVecX = sinPhi;
  const nVecZ = cosPhi;

  const midX = R_strip * sinPhi;
  const midZ = R_strip * cosPhi;

  const x = midX + u * uVecX + n * nVecX;
  const z = midZ + u * uVecZ + n * nVecZ;

  const faceX = isLeftWing ? -uVecX : uVecX;
  const faceZ = isLeftWing ? -uVecZ : uVecZ;
  const rotation = Math.atan2(-faceX, -faceZ);

  return { x, z, rotation };
}

/** World transform for a player's accessory station (Hero stand, deck, discard, lives). */
export function playerAccessoriesTransform(view: PlayerView, pid: string): BoardTransform | null {
  const player = view.players[pid];
  if (!player || player.eliminated) return null;

  if (view.mode === 'teams' && view.teamVariant === 'wall') {
    const teams = view.teams ? Object.values(view.teams) : [];
    const team = teams.find((t) => t.playerIds.includes(pid));
    if (!team) return null;
    const myTeamId = view.players[view.me]?.teamId ?? null;
    const myTeam = myTeamId ? view.teams?.[myTeamId] : null;
    const isMyTeam = myTeam?.id === team.id;
    const half = team.playerIds.indexOf(pid);
    const step = ROW_LEN + 220;
    const offset = (half - (team.playerIds.length - 1) / 2) * step;
    return {
      x: isMyTeam ? offset : -offset,
      z: isMyTeam ? ROW_Z : -ROW_Z,
      rotation: isMyTeam ? 0 : Math.PI,
    };
  }

  const alive = view.order.filter((id) => !view.players[id]!.eliminated);
  if (alive.length === 0) return null;
  const meIndex = alive.indexOf(view.me);
  const ordered = meIndex >= 0 ? [...alive.slice(meIndex), ...alive.slice(0, meIndex)] : alive;
  const playerIdx = ordered.indexOf(pid);
  if (playerIdx < 0) return null;

  if (ordered.length === 2) {
    return playerIdx === 0
      ? { x: 0, z: ROW_Z, rotation: 0 }
      : { x: 0, z: -ROW_Z, rotation: Math.PI };
  }

  const N = ordered.length;
  const halfAngle = Math.PI / N;
  const R_strip = N === 3 ? 280 : N === 4 ? 350 : (LAND_H + 120) / Math.tan(halfAngle);
  const R_vertex = R_strip / Math.cos(halfAngle);
  const R_acc = R_vertex + 60;

  const theta = playerIdx * (2 * Math.PI / N);
  return {
    x: R_acc * Math.sin(theta),
    z: R_acc * Math.cos(theta),
    rotation: theta,
  };
}

/**
 * Board placement (docs/UI-3D.md «Раскладки стола»):
 * Backward-compatible wrapper returning the player's accessory anchor.
 */
export function boardTransform(view: PlayerView, pid: string): BoardTransform | null {
  return playerAccessoriesTransform(view, pid);
}

export function myBoardTransform(view: PlayerView): BoardTransform {
  return boardTransform(view, view.me) ?? { x: 0, z: ROW_Z, rotation: 0 };
}

export function deckLocalFor(view: PlayerView): [number, number, number] {
  if (view.mode === 'teams' && view.teamVariant === 'wall') {
    return [-140, 4, LAND_H / 2 + 78];
  }
  const alive = view.order.filter((id) => !view.players[id]?.eliminated);
  if (alive.length >= 3) {
    return [-140, 4, 30];
  }
  return deckLocal;
}

export function discardLocalFor(view: PlayerView): [number, number, number] {
  if (view.mode === 'teams' && view.teamVariant === 'wall') {
    return [140, 4, LAND_H / 2 + 78];
  }
  const alive = view.order.filter((id) => !view.players[id]?.eliminated);
  if (alive.length >= 3) {
    return [140, 4, 30];
  }
  return discardLocal;
}

export function heroLocalFor(view: PlayerView): [number, number, number] {
  if (view.mode === 'teams' && view.teamVariant === 'wall') {
    return [0, 0, LAND_H / 2 + 78];
  }
  const alive = view.order.filter((id) => !view.players[id]?.eliminated);
  if (alive.length >= 3) {
    return [0, 0, 40];
  }
  return heroLocal;
}

export function livesLocalFor(view: PlayerView): [number, number, number] {
  if (view.mode === 'teams' && view.teamVariant === 'wall') {
    return [60, 2, LAND_H / 2 + 78];
  }
  const alive = view.order.filter((id) => !view.players[id]?.eliminated);
  if (alive.length >= 3) {
    return [60, 2, 40];
  }
  return livesLocal;
}

/** Square felt playmat size (mm) sized to contain all zones & accessories for the current table layout. */
export function playmatSizeFor(view: PlayerView | null): number {
  if (!view) return 960;
  if (view.mode === 'teams' && view.teamVariant === 'wall') return 1760;
  const alive = view.order.filter((id) => !view.players[id]?.eliminated).length;
  if (alive <= 2) return 960;
  if (alive === 3) return 1600;
  return 1600;
}

/** World X/Z offsets for the four decorative picnic props around the felt playmat. */
export function picnicPropOffsetsFor(matSize: number): { x: number; z: number } {
  if (matSize <= 1000) {
    return { x: matSize / 2 + 80, z: matSize / 2 - 60 };
  }
  return { x: matSize / 2 + 80, z: matSize / 2 + 80 };
}

/** World position of a point given in a board's local coordinates. */
export function localToWorld(
  transform: BoardTransform,
  x: number,
  z: number,
): { x: number; z: number } {
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    x: transform.x + x * cos + z * sin,
    z: transform.z - x * sin + z * cos,
  };
}

/** Local position of a world point relative to a board's coordinate system. */
export function worldToLocal(
  transform: BoardTransform,
  worldX: number,
  worldZ: number,
): { x: number; z: number } {
  const dx = worldX - transform.x;
  const dz = worldZ - transform.z;
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

export function worldOfSlot(
  view: PlayerView,
  pid: string,
  zone: number,
  slot: 'creature' | 'building' | 'companion',
): [number, number, number] | null {
  const t = zoneWorldTransform(view, pid, zone);
  if (!t) return null;
  const lz = slotLocalZ(slot);
  const sin = Math.sin(t.rotation);
  const cos = Math.cos(t.rotation);
  return [t.x + lz * sin, 3, t.z + lz * cos];
}

export function worldOfHero(view: PlayerView, pid: string): [number, number, number] | null {
  const transform = playerAccessoriesTransform(view, pid);
  if (!transform) return null;
  const local = heroLocalFor(view);
  const world = localToWorld(transform, local[0], local[2]);
  return [world.x, 0, world.z];
}

export function worldOfCompanion(view: PlayerView, pid: string): [number, number, number] | null {
  const transform = playerAccessoriesTransform(view, pid);
  if (!transform) return null;
  const world = localToWorld(transform, 0, slotLocalZ('companion'));
  return [world.x, 8, world.z];
}

/** World transform of the player's draw deck: always to the left of their 1st land (zone 0). */
export function deckWorldTransform(view: PlayerView, pid: string): BoardTransform | null {
  const lt0 = zoneWorldTransform(view, pid, 0);
  if (!lt0) return null;
  const pos = localToWorld(lt0, -LAND_W / 2 - 58, 12);
  return { x: pos.x, z: pos.z, rotation: lt0.rotation };
}

/** World transform of the player's discard pile: always to the right of their 4th land (zone 3). */
export function discardWorldTransform(view: PlayerView, pid: string): BoardTransform | null {
  const lt3 = zoneWorldTransform(view, pid, ZONE_COUNT - 1);
  if (!lt3) return null;
  const pos = localToWorld(lt3, LAND_W / 2 + 58, 12);
  return { x: pos.x, z: pos.z, rotation: lt3.rotation };
}

export function worldOfDeck(view: PlayerView, pid: string): [number, number, number] | null {
  const t = deckWorldTransform(view, pid);
  if (!t) return null;
  return [t.x, 4, t.z];
}

export function worldOfDiscard(view: PlayerView, pid: string): [number, number, number] | null {
  const t = discardWorldTransform(view, pid);
  if (!t) return null;
  return [t.x, 4, t.z];
}

/** Находимся ли мировые координаты указателя над моей стопкой сброса (drag & drop). */
export function overMyDiscard(view: PlayerView, worldX: number, worldZ: number): boolean {
  const world = worldOfDiscard(view, view.me);
  if (!world) return false;
  const dx = worldX - world[0];
  const dz = worldZ - world[2];
  return dx * dx + dz * dz <= DISCARD_HIT_RADIUS * DISCARD_HIT_RADIUS;
}

/** Задевает ли ЛУЧ указателя цилиндр моей стопки сброса — без параллакса
 *  плоскости драга (стопка лежит на столе, плоскость ловушки выше). */
export function overMyDiscardRay(
  view: PlayerView,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): boolean {
  const world = worldOfDiscard(view, view.me);
  if (!world) return false;
  const px = world[0] - ox;
  const py = world[1] - oy;
  const pz = world[2] - oz;
  const dd = dx * dx + dy * dy + dz * dz;
  if (dd === 0) return false;
  const t = (px * dx + py * dy + pz * dz) / dd;
  const cx = px - dx * t;
  const cy = py - dy * t;
  const cz = pz - dz * t;
  return cx * cx + cy * cy + cz * cz <= DISCARD_HIT_RADIUS * DISCARD_HIT_RADIUS;
}

/** Which of my zones is under a world pointer position (drag & drop). */
export function zoneFromWorld(view: PlayerView, worldX: number, worldZ: number): number | null {
  for (let z = 0; z < ZONE_COUNT; z++) {
    const t = zoneWorldTransform(view, view.me, z);
    if (!t) continue;
    const dx = worldX - t.x;
    const dz = worldZ - t.z;
    const sin = Math.sin(t.rotation);
    const cos = Math.cos(t.rotation);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    if (Math.abs(lx) <= LAND_W / 2 + 10 && Math.abs(lz) <= LAND_H / 2 + 10) {
      return z;
    }
  }
  return null;
}

/** Which player's side the camera faces in the current camera mode (docs/UI-3D.md). */
export function cameraTargetPlayer(
  view: PlayerView,
  mode: 'follow' | 'self' | 'top' | 'opponents' | 'manual' = 'self',
): string {
  if (mode === 'self' || view.status !== 'running') return view.me;
  if ((mode as string) === 'opponents') {
    const aliveOpponents = view.order.filter((id) => id !== view.me && !view.players[id]?.eliminated);
    return aliveOpponents[0] ?? view.me;
  }
  if (view.activePlayers.includes(view.me)) return view.me;
  return view.activePlayers[0] ?? view.me;
}

/** Camera orbit parameters around the central table anchor. */
export function cameraOrbitFor(
  view: PlayerView,
  mode: 'follow' | 'self' | 'top' | 'opponents' | 'manual' = 'self',
): {
  angle: number;
  radius: number;
  height: number;
  lookOffset: number;
  fov: number;
} {
  const targetPid = cameraTargetPlayer(view, mode);
  const transform = boardTransform(view, targetPid);
  const angle = transform?.rotation ?? 0;

  if ((mode as string) === 'top') {
    return { angle, height: 1100, radius: 10, lookOffset: 0, fov: 44 };
  }

  if (view.mode === 'teams' && view.teamVariant === 'wall') {
    return { angle, height: 640, radius: 760, lookOffset: 15, fov: 44 };
  }
  const alive = view.order.filter((pid) => !view.players[pid]!.eliminated).length;
  if (alive >= 3) {
    // Combat focus: frames own 4 lands + 2 bordering lands of left & right neighbors without opposite clutter
    return { angle, height: 610, radius: 730, lookOffset: 105, fov: 44 };
  }
  return { angle, height: 540, radius: 620, lookOffset: 24, fov: 43 };
}

export function cameraFor(
  view: PlayerView,
  mode: 'follow' | 'self' | 'top' | 'opponents' | 'manual' = 'self',
): {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
} {
  const orbit = cameraOrbitFor(view, mode);
  const sin = Math.sin(orbit.angle);
  const cos = Math.cos(orbit.angle);
  return {
    position: [orbit.radius * sin, orbit.height, orbit.radius * cos],
    lookAt: [orbit.lookOffset * sin, 0, orbit.lookOffset * cos],
    fov: orbit.fov,
  };
}

/**
 * Camera rotation easing on turn change (docs/UI-3D.md):
 * smooth acceleration -> sharp braking into overshoot (~9%) -> rollback settle to 1.0.
 */
export function cameraTurnEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const peakT = 0.64;
  const overshoot = 1.09;
  if (t < peakT) {
    const u = t / peakT;
    const uAccel = Math.pow(u, 1.7);
    const braked = 1 - Math.pow(1 - uAccel, 3.2);
    return overshoot * braked;
  }
  const v = (t - peakT) / (1 - peakT);
  const settle = 1 - Math.pow(1 - v, 2.6);
  return overshoot + (1 - overshoot) * settle;
}

/**
 * 3D hand parameters attached to the camera frame (docs/UI-3D.md):
 * local camera coordinates (-Z forward, -Y bottom) keep cards above the table,
 * close enough for readable text, and following the camera around the table.
 */
export const HAND = {
  /** World Z reference for card flight animations. */
  z: 260,
  y: 95,
  step: 66,
  liftY: 42,
  rotX: -0.5,
  /** Camera-local coordinates for the hand fan. */
  camZ: -340,
  camLiftZ: -250,
  camY: -94,
  camLiftY: -46,
};

/** World position of the player's hand (used by AnimLayer card flights). */
export function handWorldPos(view: PlayerView, mode: string = 'self'): [number, number, number] {
  const effectiveMode: 'follow' | 'self' = mode === 'follow' ? 'follow' : 'self';
  const orbit = cameraOrbitFor(view, effectiveMode);
  const r = orbit.radius - 240;
  return [r * Math.sin(orbit.angle), 120, r * Math.cos(orbit.angle)];
}

/** Sprite labels floating over the board (damage numbers etc.). */
export const SPRITE_SCALE = 0.28;
