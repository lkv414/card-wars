/**
 * placementRaycast — луч из камеры через NDC для drop-плейсмента карт.
 *
 * Что было (PERFORMANCE_AUDIT_3D.md, 🔴 Критично):
 *   - На каждый pointerup во время drag делался `scene.traverse()` (~250 узлов)
 *     + аллокация Raycaster + Vector2.
 *   - Fallback с traverse был мёртвым кодом: registerPlayableSlot не вызывался
 *     нигде → targets всегда 0 → traverse каждый раз.
 *
 * Теперь:
 *   - Берём список из slotRegistry (WeakSet + явный Set, без traverse).
 *   - Один модульный Raycaster и Vector2 переиспользуются (аллокация только
 *     при первом вызове).
 */
import * as THREE from 'three'
import { getPlayableSlotTargets } from './slotRegistry.js'

const raycaster = new THREE.Raycaster()
const vector = new THREE.Vector2()

export function raycastPlayableSlot(camera, pointerNdc) {
  if (!camera || !pointerNdc) return null

  vector.set(pointerNdc.x, pointerNdc.y)
  raycaster.setFromCamera(vector, camera)

  const targets = getPlayableSlotTargets()
  if (targets.length === 0) return null

  const hits = raycaster.intersectObjects(targets, false)
  if (hits.length === 0) return null

  const data = hits[0].object.userData
  return {
    zoneIndex: data.zoneIndex,
    slotType: data.slotType,
  }
}

export function ndcFromClient(clientX, clientY, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  }
}