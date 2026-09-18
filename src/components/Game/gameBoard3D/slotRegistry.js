/**
 * slotRegistry — реестр playable-slot мешей для placementRaycast.
 *
 * Зачем (PERFORMANCE_AUDIT_3D.md, 🔴 Критично):
 *   Раньше `placementRaycast.js` на каждый pointerup во время drag вызывал
 *   `scene.traverse()` по ~250 узлам + аллоцировал новый Raycaster/Vector2.
 *   Теперь SlotPad регистрирует свой mesh в этом реестре, а raycaster берёт
 *   список из `getPlayableSlotTargets()` за O(playable-slots).
 *
 * Используем WeakSet, чтобы GC мог собрать mesh'и, на которые больше никто
 * не ссылается, даже если cleanup не успел отработать (например, при HMR).
 */

const playableSlots = new WeakSet()
const targetsSnapshot = new Set()

export function registerPlayableSlot(object3D) {
  if (!object3D) return () => {}
  playableSlots.add(object3D)
  targetsSnapshot.add(object3D)
  let released = false
  return () => {
    if (released) return
    released = true
    playableSlots.delete(object3D)
    targetsSnapshot.delete(object3D)
  }
}

export function getPlayableSlotTargets() {
  // Фильтруем мёртвые ссылки (mesh удалён из сцены).
  for (const obj of targetsSnapshot) {
    if (obj.parent == null && obj.children == null) {
      targetsSnapshot.delete(obj)
    }
  }
  return Array.from(targetsSnapshot)
}

export function clearPlayableSlots() {
  targetsSnapshot.clear()
}