import * as THREE from 'three';
import type { PlayerView } from '@card-wars/protocol';
import { boardTransform, cameraOrbitFor } from './layout';

export type CameraMode = 'follow' | 'self' | 'top' | 'opponents' | 'manual';
export type CameraSnap = 'top' | 'self' | 'opponents' | 'follow' | `player_${string}` | string;

export interface CameraAnchorState {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  up: THREE.Vector3;
  fov: number;
  angle: number;
  u: number; // 0 for perspective, 1 for top-down
  isTop: boolean;
  targetPid: string;
}

/** Check if a snap or mode identifier represents the top-down anchor. */
export function isTopSnap(snap?: string, mode?: string): boolean {
  if (snap === 'top' || snap?.startsWith('top_')) return true;
  if (!snap && mode === 'top') return true;
  return false;
}

/** Check if a snap identifier represents the combat-lands top-down focus. */
export function isCombatSnap(snap?: string): boolean {
  return snap === 'combat' || Boolean(snap?.startsWith('combat_'));
}

/** Parses a snap identifier into its layer and optional player target ID. */
export function parseSnapTarget(snap?: string): {
  layer: 'top' | 'combat' | 'player' | 'follow' | 'opponents';
  playerId: string | null;
} {
  if (!snap || snap === 'follow') return { layer: 'follow', playerId: null };
  if (snap === 'opponents') return { layer: 'opponents', playerId: null };
  if (snap === 'top') return { layer: 'top', playerId: null };
  if (snap.startsWith('top_')) return { layer: 'top', playerId: snap.slice(4) };
  if (snap === 'combat') return { layer: 'combat', playerId: null };
  if (snap.startsWith('combat_')) return { layer: 'combat', playerId: snap.slice(7) };
  if (snap === 'self') return { layer: 'player', playerId: null };
  if (snap.startsWith('player_')) return { layer: 'player', playerId: snap.slice(7) };
  return { layer: 'player', playerId: snap };
}

/** Resolves the target player ID based on view, mode, and snap identifier. */
export function resolveTargetPlayer(
  view: PlayerView,
  cameraMode: CameraMode,
  cameraSnap?: string,
): string {
  // Explicit snap identifiers always take precedence
  if (cameraSnap && cameraSnap.startsWith('player_')) {
    const rawPid = cameraSnap.slice(7);
    if (rawPid === 'me' || rawPid === view.me) return view.me;
    if (view.players[rawPid] && !view.players[rawPid].eliminated) return rawPid;
  }
  if (cameraSnap && cameraSnap.startsWith('top_')) {
    const rawPid = cameraSnap.slice(4);
    if (rawPid === 'me' || rawPid === view.me) return view.me;
    if (view.players[rawPid] && !view.players[rawPid].eliminated) return rawPid;
  }
  if (cameraSnap && cameraSnap.startsWith('combat_')) {
    const rawPid = cameraSnap.slice(7);
    if (rawPid === 'me' || rawPid === view.me) return view.me;
    if (view.players[rawPid] && !view.players[rawPid].eliminated) return rawPid;
  }
  if (cameraSnap === 'self' || cameraSnap === 'combat' || cameraMode === 'self') {
    return view.me;
  }
  if (cameraSnap === 'follow' || cameraMode === 'follow') {
    if (view.activePlayers.includes(view.me)) return view.me;
    return view.activePlayers[0] ?? view.me;
  }
  if (cameraSnap === 'opponents' || cameraMode === 'opponents') {
    const aliveEnemies = view.order.filter((id) => id !== view.me && !view.players[id]?.eliminated);
    return aliveEnemies[0] ?? view.me;
  }
  if (cameraSnap && view.players[cameraSnap] && !view.players[cameraSnap].eliminated) {
    return cameraSnap;
  }
  // Fallback to active player or local player
  if (view.activePlayers.includes(view.me)) return view.me;
  return view.activePlayers[0] ?? view.me;
}

/**
 * Calculates the exact 3D camera anchor for a given player and view mode.
 */
export function calculateCameraAnchor(
  view: PlayerView,
  targetPid: string,
  isTop: boolean,
  aspect: number,
  zoomScale: number = 1,
): CameraAnchorState {
  const transform = boardTransform(view, targetPid);
  const angle = transform?.rotation ?? 0;
  const orbit = cameraOrbitFor(view, 'self');

  // Smoothly pull back on narrow viewports (e.g. mobile or side-by-side split screen)
  const fitScale = aspect < 1.35 ? Math.min(1.75, 1.35 / Math.max(0.55, aspect)) : 1;
  const baseDist = Math.hypot(orbit.radius, orbit.height) * fitScale;

  if (isTop) {
    const topDist = baseDist * 0.95 * zoomScale;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    return {
      position: new THREE.Vector3(0, topDist, 0),
      lookAt: new THREE.Vector3(0, 0, 0),
      // Camera up points opposite to player position, orienting the player at the bottom of screen
      up: new THREE.Vector3(-sin, 0, -cos),
      fov: orbit.fov,
      angle,
      u: 1,
      isTop: true,
      targetPid,
    };
  }

  // Perspective view from the player's side
  const basePitch = Math.atan2(orbit.height, orbit.radius);
  const dist = baseDist * zoomScale;
  const horizR = dist * Math.cos(basePitch);
  const h = dist * Math.sin(basePitch);
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  return {
    position: new THREE.Vector3(horizR * sin, h, horizR * cos),
    lookAt: new THREE.Vector3(orbit.lookOffset * sin, 0, orbit.lookOffset * cos),
    up: new THREE.Vector3(0, 1, 0),
    fov: orbit.fov,
    angle,
    u: 0,
    isTop: false,
    targetPid,
  };
}

/** Cubic ease in-out for smooth vertical and horizontal transitions without overshoot. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Interpolates camera position, lookAt, and up vector between perspective and top-down states.
 * Monotonic quaternions, zero gimbal lock, zero table clipping.
 */
export function interpolateCameraPose(
  view: PlayerView,
  angle: number,
  u: number,
  aspect: number,
  zoomScale: number = 1,
  combatFocus: number = 0,
): { position: THREE.Vector3; lookAt: THREE.Vector3; up: THREE.Vector3; fov: number } {
  const orbit = cameraOrbitFor(view, 'self');
  const fitScale = aspect < 1.35 ? Math.min(1.75, 1.35 / Math.max(0.55, aspect)) : 1;
  const baseDist = Math.hypot(orbit.radius, orbit.height) * fitScale;
  const basePitch = Math.atan2(orbit.height, orbit.radius);

  const pitch = THREE.MathUtils.lerp(basePitch, Math.PI / 2, u);
  const topZoom = THREE.MathUtils.lerp(0.95, 0.58, combatFocus);
  const targetDist = THREE.MathUtils.lerp(baseDist, baseDist * topZoom, u) * zoomScale;

  const horizR = targetDist * Math.cos(pitch);
  const h = targetDist * Math.sin(pitch);

  const aliveCount = view.order.filter((id) => !view.players[id]?.eliminated).length;
  const isPolygon = aliveCount >= 3 && !(view.mode === 'teams' && view.teamVariant === 'wall');
  const combatCenterOffset = (isPolygon ? 295 : 85) * combatFocus;
  const lookDist = (1 - u) * orbit.lookOffset + u * combatCenterOffset;

  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  const position = new THREE.Vector3(
    horizR * sin + combatCenterOffset * u * sin,
    h,
    horizR * cos + combatCenterOffset * u * cos,
  );
  const lookAt = new THREE.Vector3(lookDist * sin, 0, lookDist * cos);

  // Up vector blends smoothly between (0, 1, 0) and (-sin, 0, -cos)
  const rad = u * (Math.PI / 2);
  const up = new THREE.Vector3(
    -sin * Math.sin(rad),
    Math.cos(rad),
    -cos * Math.sin(rad),
  ).normalize();

  return { position, lookAt, up, fov: orbit.fov };
}

export type SwipeDirection = 'down' | 'up' | 'left' | 'right';

/**
 * Classifies a drag delta into a swipe gesture:
 * - down: top to bottom (swipes into top-down view)
 * - up: bottom to top (swipes back to perspective)
 * - left / right: rotates between player sides
 */
export function classifySwipe(
  dx: number,
  dy: number,
  minDistance: number = 42,
): SwipeDirection | null {
  const dist = Math.hypot(dx, dy);
  if (dist < minDistance) return null;

  if (Math.abs(dy) > Math.abs(dx)) {
    return dy > 0 ? 'down' : 'up';
  }
  return dx < 0 ? 'left' : 'right';
}

/** Get next or previous player ID in circular table order. */
export function getNextPlayerId(
  view: PlayerView,
  currentPid: string,
  direction: 'next' | 'prev' = 'next',
): string {
  const alive = view.order.filter((id) => !view.players[id]?.eliminated);
  if (alive.length === 0) return view.me;
  const meIndex = alive.indexOf(view.me);
  const ordered = meIndex >= 0 ? [...alive.slice(meIndex), ...alive.slice(0, meIndex)] : alive;
  const idx = ordered.indexOf(currentPid);
  const targetIdx =
    idx < 0
      ? 0
      : direction === 'next'
        ? (idx + 1) % ordered.length
        : (idx - 1 + ordered.length) % ordered.length;
  return ordered[targetIdx] ?? view.me;
}
