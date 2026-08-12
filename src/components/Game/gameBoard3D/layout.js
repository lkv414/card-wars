import { ZONES_PER_PLAYER } from '../../../constants/gameMultiplayer.js'

/** Масштаб игрового поля (увеличен для читаемости карт). */
export const LANE_WIDTH = 1.55
export const HALF_LANE_DEPTH = 2.4
export const COLUMN_WIDTH = LANE_WIDTH

export const TABLE_DEPTH = 14
export const TABLE_RADIUS = 8.5
export const LANE_FULL_DEPTH = HALF_LANE_DEPTH * 2
/** @deprecated use HALF_LANE_DEPTH */
export const COLUMN_DEPTH = HALF_LANE_DEPTH
export const SLOT_GAP = 0
export const SLOT_WIDTH = LANE_WIDTH
export const SLOT_DEPTH = HALF_LANE_DEPTH
export const NUM_SLOTS = ZONES_PER_PLAYER
export const PLAY_FIELD_WIDTH = NUM_SLOTS * LANE_WIDTH
export const PLAY_FIELD_DEPTH = LANE_FULL_DEPTH
/** Y поверхности сукна / земель */
export const PLAY_FIELD_Y = 0.092

export const CARD_BASE_WIDTH = 0.7
export const CARD_BASE_DEPTH = 1.0

export const LAND_ROW_RADIUS = 3.1

export const PLAYER_ANGLES = {
  2: [180, 0],
  3: [180, 60, 300],
  4: [180, 90, 0, 270],
}

/**
 * Земля игрока делится пополам по Z (существо / строение).
 * Центры половин — точки постановки карт.
 */
export function getLandSlotLayout() {
  const slotDepth = HALF_LANE_DEPTH / 2
  return {
    creature: {
      x: 0,
      z: -slotDepth / 2,
      width: LANE_WIDTH,
      depth: slotDepth,
    },
    building: {
      x: 0,
      z: slotDepth / 2,
      width: LANE_WIDTH,
      depth: slotDepth,
    },
  }
}

/** Масштаб карты на столе — вписывается в половину земли без перекрытий. */
export function computeFieldCardScale(padding = 0.9) {
  const { creature } = getLandSlotLayout()
  const maxW = creature.width * padding
  const maxD = creature.depth * padding
  return Math.min(maxW / CARD_BASE_WIDTH, maxD / CARD_BASE_DEPTH)
}

/**
 * Дистанция камеры, чтобы поле целиком влезало во viewport.
 */
export function computeBoardCameraDistance(aspect, vFovDeg, margin = 1.1) {
  const vFovRad = (vFovDeg * Math.PI) / 180
  const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect)
  const distForWidth = (PLAY_FIELD_WIDTH * margin) / 2 / Math.tan(hFovRad / 2)
  const distForDepth = (PLAY_FIELD_DEPTH * margin) / 2 / Math.tan(vFovRad / 2)
  return Math.max(distForWidth, distForDepth)
}

/** X-координаты 4 общих вертикальных lanes (Card Wars). */
export function calculateSharedLaneXs() {
  return Array.from({ length: NUM_SLOTS }, (_, i) => (i - (NUM_SLOTS - 1) / 2) * LANE_WIDTH)
}

/**
 * 2 игрока: 4 shared lanes, в каждой near/far половина без зазора на z=0.
 */
export function calculateTwoPlayerBoard(myIndex) {
  const farPlayerIndex = myIndex === 0 ? 1 : 0
  return calculateSharedLaneXs().map((x, laneIndex) => ({
    laneIndex,
    x,
    near: {
      center: [x, PLAY_FIELD_Y, HALF_LANE_DEPTH / 2],
      rotationY: 0,
      playerIndex: myIndex,
      zoneIndex: laneIndex,
    },
    far: {
      center: [x, PLAY_FIELD_Y, -HALF_LANE_DEPTH / 2],
      rotationY: Math.PI,
      playerIndex: farPlayerIndex,
      zoneIndex: laneIndex,
    },
  }))
}

export function calculatePlayerSlotPositions(playerIndex, playerCount) {
  if (playerCount === 2) {
    return buildTwoPlayerRow(playerIndex)
  }
  return buildCircularRow(playerIndex, playerCount)
}

function buildTwoPlayerRow(playerIndex) {
  const sign = playerIndex === 0 ? 1 : -1
  const centerZ = sign * (HALF_LANE_DEPTH / 2)

  return Array.from({ length: NUM_SLOTS }, (_, i) => ({
    center: [(i - (NUM_SLOTS - 1) / 2) * LANE_WIDTH, PLAY_FIELD_Y, centerZ],
    rotationY: playerIndex === 0 ? 0 : Math.PI,
    zoneIndex: i,
  }))
}

function buildCircularRow(playerIndex, playerCount) {
  const angleDeg = PLAYER_ANGLES[playerCount]?.[playerIndex] ?? 0
  const rad = (angleDeg * Math.PI) / 180

  const outwardX = Math.cos(rad)
  const outwardZ = Math.sin(rad)
  const tangentX = -Math.sin(rad)
  const tangentZ = Math.cos(rad)

  const rowCenterX = outwardX * LAND_ROW_RADIUS
  const rowCenterZ = outwardZ * LAND_ROW_RADIUS
  const rotationY = Math.atan2(-outwardX, -outwardZ)

  return Array.from({ length: NUM_SLOTS }, (_, i) => {
    const along = (i - (NUM_SLOTS - 1) / 2) * LANE_WIDTH
    return {
      center: [rowCenterX + tangentX * along, PLAY_FIELD_Y, rowCenterZ + tangentZ * along],
      rotationY,
      zoneIndex: i,
    }
  })
}

export function ownerRotationY(playerIndex, playerCount) {
  const cols = calculatePlayerSlotPositions(playerIndex, playerCount)
  return cols[0]?.rotationY ?? 0
}

/** @deprecated используйте AdaptiveBoardCamera + computeBoardCameraDistance */
export function calculateCameraPosition(playerIndex, playerCount, aspect = 16 / 9, vFov = 42) {
  const dist = computeBoardCameraDistance(aspect, vFov)
  const angle = PLAYER_ANGLES[playerCount]?.[playerIndex] || 0
  const rad = (angle * Math.PI) / 180

  if (playerCount === 2) {
    const zSign = playerIndex === 0 ? 1 : -1
    return [0, PLAY_FIELD_Y + dist * 0.72, zSign * dist * 0.62]
  }

  return [
    Math.cos(rad) * (LAND_ROW_RADIUS + dist * 0.45),
    PLAY_FIELD_Y + dist * 0.72,
    Math.sin(rad) * (LAND_ROW_RADIUS + dist * 0.45),
  ]
}

export function columnSpacing(playerCount) {
  if (playerCount === 2) {
    const xs = calculateSharedLaneXs()
    const gaps = []
    for (let i = 1; i < xs.length; i++) {
      gaps.push(Math.abs(xs[i] - xs[i - 1]))
    }
    return gaps
  }
  const cols = buildCircularRow(0, playerCount)
  const gaps = []
  for (let i = 1; i < cols.length; i++) {
    const dx = cols[i].center[0] - cols[i - 1].center[0]
    const dz = cols[i].center[2] - cols[i - 1].center[2]
    gaps.push(Math.hypot(dx, dz))
  }
  return gaps
}

export function getBoardLookAtTarget() {
  return [0, PLAY_FIELD_Y, 0]
}
