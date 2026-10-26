// Table geometry in millimetres — real proportions of the board game
// (docs/UI-3D.md «Размеры»). 1 unit = 1 mm; the scene scale is arbitrary.

export const LAND_W = 92;
export const LAND_H = 129;
export const LAND_GAP = 10;
export const CARD_W = 63;
export const CARD_H = 89;
export const CARD_T = 1.2;
export const TOKEN_D = 25;
export const FROST_D = 25.5;
export const TOKEN_T = 3;
export const ZONE_COUNT = 4;

export const ROW_LEN = ZONE_COUNT * LAND_W + (ZONE_COUNT - 1) * LAND_GAP; // 398

/** Column X for zone index 0..3 (my zones left-to-right from my view). */
export function zoneX(zone: number): number {
  return -(ROW_LEN - LAND_W) / 2 + zone * (LAND_W + LAND_GAP);
}

/** Z of a player's land row: me at +z, opponent at −z. */
export function rowZ(isMe: boolean): number {
  return isMe ? LAND_H / 2 + 6 : -(LAND_H / 2 + 6);
}

/** Creature stands toward the centre line, building toward the owner. */
export function slotLocalZ(slot: 'creature' | 'building', isMe: boolean): number {
  const towardCenter = isMe ? -1 : 1;
  return slot === 'creature' ? towardCenter * 22 : towardCenter * -24;
}

export function deckPos(isMe: boolean): [number, number, number] {
  return [isMe ? -ROW_LEN / 2 - 78 : ROW_LEN / 2 + 78, 4, rowZ(isMe)];
}

export function discardPos(isMe: boolean): [number, number, number] {
  return [isMe ? ROW_LEN / 2 + 78 : -ROW_LEN / 2 - 78, 4, rowZ(isMe)];
}

export function heroPos(isMe: boolean): [number, number, number] {
  return [0, 0, isMe ? LAND_H + 78 : -(LAND_H + 78)];
}

export function livesTokenPos(isMe: boolean): [number, number, number] {
  const [x, , z] = heroPos(isMe);
  return [x + 120, 2, z];
}

/** Mirror pairing (docs/RULES.md): my zone i faces their zone 3-i. */
export function opponentZoneOf(zone: number): number {
  return ZONE_COUNT - 1 - zone;
}

export const CAMERA = {
  position: [0, 560, 640] as const,
  lookAt: [0, 0, 60] as const,
  fov: 46,
};

export const HAND = {
  z: 330,
  y: 6,
  step: 96,
  liftY: 38,
  rotX: -0.5,
};

/** Sprite labels floating over the board (damage numbers etc.). */
export const SPRITE_SCALE = 0.28;
