import { ZONES_PER_PLAYER } from '../../../constants/gameMultiplayer'

export const TABLE_DEPTH = 12
export const TABLE_RADIUS = 6
export const SLOT_WIDTH = 1.1
export const SLOT_DEPTH = 1.4
export const SLOT_GAP = 0.4
export const NUM_SLOTS = ZONES_PER_PLAYER
export const CAMERA_HEIGHT = 9
export const CAMERA_BACK = 2
export const PLAYER_DISTANCE = 4

export const PLAYER_ANGLES = {
  2: [180, 0],
  3: [180, 60, 300],
  4: [180, 90, 0, 270],
}

export function calculatePlayerSlotPositions(playerIndex, playerCount) {
  const angle = PLAYER_ANGLES[playerCount]?.[playerIndex] || 0
  const rad = (angle * Math.PI) / 180

  if (playerCount === 2) {
    if (playerIndex === 0) {
      return Array.from({ length: NUM_SLOTS }).map((_, i) => {
        const x = (i - (NUM_SLOTS - 1) / 2) * (SLOT_WIDTH + SLOT_GAP)
        return { building: [x, 0.05, 3.0], land: [x, 0.05, 1.5] }
      })
    }
    return Array.from({ length: NUM_SLOTS }).map((_, i) => {
      const x = -(i - (NUM_SLOTS - 1) / 2) * (SLOT_WIDTH + SLOT_GAP)
      return { building: [x, 0.05, -3.0], land: [x, 0.05, -1.5] }
    })
  }

  const baseX = Math.cos(rad) * PLAYER_DISTANCE
  const baseZ = Math.sin(rad) * PLAYER_DISTANCE

  return Array.from({ length: NUM_SLOTS }).map((_, i) => {
    const slotOffset = (i - (NUM_SLOTS - 1) / 2) * (SLOT_WIDTH + SLOT_GAP)
    const slotX = baseX + slotOffset * Math.cos(rad + Math.PI / 2)
    const slotZ = baseZ + slotOffset * Math.sin(rad + Math.PI / 2)
    return { building: [slotX, 0.05, slotZ], land: [slotX, 0.05, slotZ + 1.5] }
  })
}

export function ownerRotationY(playerIndex, playerCount) {
  const angleDeg = PLAYER_ANGLES[playerCount]?.[playerIndex] || 0
  const angleRad = (angleDeg * Math.PI) / 180
  return Math.PI - angleRad
}

export function calculateCameraPosition(playerIndex, playerCount) {
  const angle = PLAYER_ANGLES[playerCount]?.[playerIndex] || 0
  const rad = (angle * Math.PI) / 180

  if (playerCount === 2) {
    if (playerIndex === 0) {
      return [0, CAMERA_HEIGHT, TABLE_DEPTH / 2 - CAMERA_BACK]
    }
    return [0, CAMERA_HEIGHT, -TABLE_DEPTH / 2 + CAMERA_BACK]
  }

  const camDistance = PLAYER_DISTANCE + 3
  return [Math.cos(rad) * camDistance, CAMERA_HEIGHT, Math.sin(rad) * camDistance]
}
