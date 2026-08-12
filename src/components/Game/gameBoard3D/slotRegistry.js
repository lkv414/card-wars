/** Registry of playable slot meshes — avoids scene.traverse every frame. */

const playableSlots = new Set()

export function registerPlayableSlot(object3D) {
  if (!object3D) return () => {}
  playableSlots.add(object3D)
  return () => playableSlots.delete(object3D)
}

export function getPlayableSlotTargets() {
  return [...playableSlots]
}

export function clearPlayableSlots() {
  playableSlots.clear()
}
