import type { PlayerView } from '@card-wars/protocol';

// Table geometry in millimetres — real proportions of the board game
// (docs/UI-3D.md «Размеры»). 1 unit = 1 mm; the scene scale is arbitrary.
// Every board is a local coordinate system facing the table centre; the player
// is always at the bottom, other seats are placed around the table.

export const LAND_W = 96;
export const LAND_H = 188; // 3D-тайл увеличен против оригинала: карта 63×89 целиком в своей половине 96×94 (docs/UI-3D.md «Размеры»)
export const LAND_GAP = 10;
export const CARD_W = 63;
export const CARD_H = 89;
export const CARD_T = 1.2;
export const TOKEN_D = 25;
export const FROST_D = 25.5;
export const TOKEN_T = 3;
export const ZONE_COUNT = 4;

export const ROW_LEN = ZONE_COUNT * LAND_W + (ZONE_COUNT - 1) * LAND_GAP; // 414
export const ROW_Z = LAND_H / 2 + 6;
const RING_RADIUS = 380;

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

export const deckLocal: [number, number, number] = [-ROW_LEN / 2 - 78, 4, 0];
export const discardLocal: [number, number, number] = [ROW_LEN / 2 + 78, 4, 0];
export const heroLocal: [number, number, number] = [0, 0, LAND_H / 2 + 78];
export const livesLocal: [number, number, number] = [120, 2, LAND_H / 2 + 78];
/** Жетон мороза лежит на переднем крае тайла. */
export const frostLocalZ = -LAND_H / 2 + 22;
/** Радиус попадания в стопку сброса при перетаскивании (docs/UI-3D.md «Взаимодействие»). */
export const DISCARD_HIT_RADIUS = 95;

export interface BoardTransform {
  x: number;
  z: number;
  rotation: number;
}

/**
 * Board placement (docs/UI-3D.md «Раскладки стола»):
 * - 2 players: two rows facing each other;
 * - 3–4 FFA / «соседи»: my row at the bottom, neighbours clockwise;
 * - «стенка»: two rows of 8 zones, allies next to each other.
 * Eliminated players have no board; the rest re-seat around the table.
 */
export function boardTransform(view: PlayerView, pid: string): BoardTransform | null {
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
    const step = ROW_LEN + 30;
    const offset = (half - (team.playerIds.length - 1) / 2) * step;
    // The enemy row is read reversed from our side: mirror the half offsets too,
    // otherwise the 8-zone mirror (zone N ↔ 9−N) would not line up visually.
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
  const index = ordered.indexOf(pid);
  if (index < 0) return null;

  if (ordered.length === 2) {
    return index === 0
      ? { x: 0, z: ROW_Z, rotation: 0 }
      : { x: 0, z: -ROW_Z, rotation: Math.PI };
  }

  if (ordered.length === 3) {
    if (index === 0) return { x: 0, z: ROW_Z, rotation: 0 };
    const side = index === 1 ? 1 : -1;
    return { x: side * (RING_RADIUS * 0.85), z: -150, rotation: side * (2 * Math.PI / 3) };
  }

  // 4 alive (or more in future modes): bottom, right, top, left.
  if (index === 0) return { x: 0, z: ROW_Z, rotation: 0 };
  if (index === 1) return { x: RING_RADIUS, z: -40, rotation: Math.PI / 2 };
  if (index === 2) return { x: 0, z: -RING_RADIUS, rotation: Math.PI };
  return { x: -RING_RADIUS, z: -40, rotation: -Math.PI / 2 };
}

export function myBoardTransform(view: PlayerView): BoardTransform {
  return boardTransform(view, view.me) ?? { x: 0, z: ROW_Z, rotation: 0 };
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

export function worldOfSlot(
  view: PlayerView,
  pid: string,
  zone: number,
  slot: 'creature' | 'building' | 'companion',
): [number, number, number] | null {
  const transform = boardTransform(view, pid);
  if (!transform) return null;
  const world = localToWorld(transform, zoneX(zone), slotLocalZ(slot));
  return [world.x, 3, world.z];
}

export function worldOfHero(view: PlayerView, pid: string): [number, number, number] | null {
  const transform = boardTransform(view, pid);
  if (!transform) return null;
  const world = localToWorld(transform, heroLocal[0], heroLocal[2]);
  return [world.x, 0, world.z];
}

export function worldOfCompanion(view: PlayerView, pid: string): [number, number, number] | null {
  const transform = boardTransform(view, pid);
  if (!transform) return null;
  const world = localToWorld(transform, 0, slotLocalZ('companion'));
  return [world.x, 8, world.z];
}

export function worldOfDeck(view: PlayerView, pid: string): [number, number, number] | null {
  const transform = boardTransform(view, pid);
  if (!transform) return null;
  const world = localToWorld(transform, deckLocal[0], deckLocal[2]);
  return [world.x, 4, world.z];
}

export function worldOfDiscard(view: PlayerView, pid: string): [number, number, number] | null {
  const transform = boardTransform(view, pid);
  if (!transform) return null;
  const world = localToWorld(transform, discardLocal[0], discardLocal[2]);
  return [world.x, 4, world.z];
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
  const origin = myBoardTransform(view);
  const localX = worldX - origin.x;
  const localZ = worldZ - origin.z;
  if (Math.abs(localX) > ROW_LEN / 2 + 20) return null;
  if (Math.abs(localZ) > LAND_H / 2 + 30) return null;
  const step = LAND_W + LAND_GAP;
  const index = Math.round((localX - zoneX(0)) / step);
  return Math.max(0, Math.min(ZONE_COUNT - 1, index));
}

/** Which player's side the camera faces in the current camera mode (docs/UI-3D.md). */
export function cameraTargetPlayer(view: PlayerView, mode: 'follow' | 'self' = 'self'): string {
  if (mode === 'self' || view.status !== 'running') return view.me;
  if (view.activePlayers.includes(view.me)) return view.me;
  return view.activePlayers[0] ?? view.me;
}

/** Camera orbit parameters around the central table anchor. */
export function cameraOrbitFor(
  view: PlayerView,
  mode: 'follow' | 'self' = 'self',
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

  if (view.mode === 'teams' && view.teamVariant === 'wall') {
    return { angle, height: 640, radius: 760, lookOffset: 15, fov: 44 };
  }
  const alive = view.order.filter((pid) => !view.players[pid]!.eliminated).length;
  if (alive >= 3) {
    return { angle, height: 730, radius: 880, lookOffset: 0, fov: 45 };
  }
  return { angle, height: 540, radius: 620, lookOffset: 24, fov: 43 };
}

export function cameraFor(
  view: PlayerView,
  mode: 'follow' | 'self' = 'self',
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
export function handWorldPos(view: PlayerView, mode: 'follow' | 'self' = 'self'): [number, number, number] {
  const orbit = cameraOrbitFor(view, mode);
  const r = orbit.radius - 240;
  return [r * Math.sin(orbit.angle), 120, r * Math.cos(orbit.angle)];
}

/** Sprite labels floating over the board (damage numbers etc.). */
export const SPRITE_SCALE = 0.28;
