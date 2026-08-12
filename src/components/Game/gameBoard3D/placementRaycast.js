import * as THREE from 'three'
import { getPlayableSlotTargets } from './slotRegistry.js'

/**
 * Луч из камеры через NDC-координаты указателя.
 * Возвращает первый подходящий слот (playable) или null.
 */
export function raycastPlayableSlot(scene, camera, pointerNdc) {
  if (!camera || !pointerNdc) return null

  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(pointerNdc.x, pointerNdc.y), camera)

  const targets = getPlayableSlotTargets()
  if (targets.length === 0 && scene) {
    scene.traverse((obj) => {
      if (obj.userData?.slotTarget && obj.userData?.playable) targets.push(obj)
    })
  }

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
