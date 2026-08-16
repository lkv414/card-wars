/**
 * gameObjectPlacement — чистая геометрия позиций объектов сцены.
 *
 * Вынесена из layout.js, чтобы 3D-компоненты не тянули доменные helpers.
 * Принимает только примитивы и возвращает координаты в мировых координатах.
 */

import { ZONES_PER_PLAYER } from '../constants/gameMultiplayer.js'

export const LANE_WIDTH = 1.55
export const HALF_LANE_DEPTH = 2.4
export const COLUMN_WIDTH = LANE_WIDTH
export const TABLE_DEPTH = 14
export const TABLE_RADIUS = 8.5
export const LANE_FULL_DEPTH = HALF_LANE_DEPTH * 2
export const SLOT_WIDTH = LANE_WIDTH
export const SLOT_DEPTH = HALF_LANE_DEPTH
export const NUM_SLOTS = ZONES_PER_PLAYER
export const PLAY_FIELD_WIDTH = NUM_SLOTS * LANE_WIDTH
export const PLAY_FIELD_DEPTH = LANE_FULL_DEPTH
export const PLAY_FIELD_Y = 0.092
export const CARD_BASE_WIDTH = 0.7
export const CARD_BASE_DEPTH = 1.0
export const LAND_ROW_RADIUS = 3.1

export const LAND_GEOMETRY = Object.freeze({
  WIDTH: LANE_WIDTH,
  DEPTH: HALF_LANE_DEPTH,
})

const PLAYER_ANGLES = {
  2: [180, 0],
  3: [180, 60, 300],
  4: [180, 90, 0, 270],
}

/**
 * @param {number} padding
 * @returns {number} масштаб карты чтобы вписалась в слот
 */
export function computeFieldCardScale(padding = 0.9) {
  const slotDepth = HALF_LANE_DEPTH / 2
  return Math.min(
    (LANE_WIDTH * padding) / CARD_BASE_WIDTH,
    (slotDepth * padding) / CARD_BASE_DEPTH,
  )
}

/**
 * @returns {{creature:{x:number,z:number,width:number,depth:number}, building:...}}
 *   координаты и размеры двух половин земли (creature/building)
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

/**
 * @returns {[number, number, number]} центр игрового поля
 */
export function getBoardCenter() {
  return [0, PLAY_FIELD_Y, 0]
}

/**
 * @param {number} aspect соотношение сторон viewport
 * @param {number} vFovDeg вертикальный FOV в градусах
 * @param {number} margin запас чтобы поле поместилось с краями
 * @returns {number} дистанция камеры
 */
export function computeBoardCameraDistance(aspect, vFovDeg, margin = 1.1) {
  const vFovRad = (vFovDeg * Math.PI) / 180
  const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect)
  const distForWidth = (PLAY_FIELD_WIDTH * margin) / 2 / Math.tan(hFovRad / 2)
  const distForDepth = (PLAY_FIELD_DEPTH * margin) / 2 / Math.tan(vFovRad / 2)
  return Math.max(distForWidth, distForDepth)
}

/**
 * @returns {number[]} X-координаты 4 вертикальных lanes (Card Wars 2-player layout).
 */
export function calculateSharedLaneXs() {
  return Array.from({ length: NUM_SLOTS }, (_, i) => (i - (NUM_SLOTS - 1) / 2) * LANE_WIDTH)
}

/**
 * @param {number} myIndex 0..N-1
 * @returns {Array<{laneIndex, x, near, far}>}
 *   near = моя половина (z>0), far = оппонент (z<0).
 *   near.center/rotationY/playerIndex/zoneIndex — для renderZoneColumn.
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

/**
 * @param {number} playerIndex 0..N-1
 * @param {number} playerCount
 * @returns {Array<{center, rotationY, zoneIndex}>}
 *   2-player: линейный ряд; 3-4-player: круговой.
 */
export function calculatePlayerSlotPositions(playerIndex, playerCount) {
  if (playerCount === 2) return buildTwoPlayerRow(playerIndex)
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
  // +π so cards face the owning player's camera, not the table center.
  const rotationY = Math.atan2(-outwardX, -outwardZ) + Math.PI

  return Array.from({ length: NUM_SLOTS }, (_, i) => {
    const along = (i - (NUM_SLOTS - 1) / 2) * LANE_WIDTH
    return {
      center: [rowCenterX + tangentX * along, PLAY_FIELD_Y, rowCenterZ + tangentZ * along],
      rotationY,
      zoneIndex: i,
    }
  })
}
