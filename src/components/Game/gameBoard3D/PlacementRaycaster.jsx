import { useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CREATURE_SLOT_COLOR, BUILDING_SLOT_COLOR } from '../../../constants/landColors'
import { raycastPlayableSlot } from './placementRaycast'
import { getPlayableSlotTargets } from './slotRegistry'

/**
 * Постоянный луч из камеры через указатель экрана.
 */
export function PlacementRaycaster({
  active = false,
  pointerRef,
  onTargetChange,
}) {
  const { camera, scene } = useThree()
  const lineRef = useRef(null)
  const markerRef = useRef(null)
  const lastTargetKey = useRef(null)

  const lineGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3))
    return geom
  }, [])

  useFrame(() => {
    const line = lineRef.current
    const marker = markerRef.current
    if (!line || !marker) return

    if (!active || !pointerRef?.current) {
      line.visible = false
      marker.visible = false
      if (lastTargetKey.current !== null) {
        lastTargetKey.current = null
        onTargetChange?.(null)
      }
      return
    }

    const target = raycastPlayableSlot(scene, camera, pointerRef.current)

    if (target) {
      const key = `${target.zoneIndex}:${target.slotType}`
      if (key !== lastTargetKey.current) {
        lastTargetKey.current = key
        onTargetChange?.(target)
      }

      const color = target.slotType === 'building' ? BUILDING_SLOT_COLOR : CREATURE_SLOT_COLOR
      line.material.color.set(color)
      marker.material.color.set(color)
      marker.material.emissive.set(color)

      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(pointerRef.current.x, pointerRef.current.y), camera)
      const targets = getPlayableSlotTargets()
      const hits = raycaster.intersectObjects(targets, false)
      const end = hits[0]?.point

      if (end) {
        const origin = raycaster.ray.origin
        const positions = line.geometry.attributes.position
        positions.setXYZ(0, origin.x, origin.y, origin.z)
        positions.setXYZ(1, end.x, end.y, end.z)
        positions.needsUpdate = true
        line.visible = true
        marker.position.set(end.x, Math.max(end.y, 0.12), end.z)
        marker.visible = true
      }
      return
    }

    line.visible = false
    marker.visible = false
    if (lastTargetKey.current !== null) {
      lastTargetKey.current = null
      onTargetChange?.(null)
    }
  })

  return (
    <group>
      <line ref={lineRef} geometry={lineGeometry} visible={false}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.85} />
      </line>
      <mesh ref={markerRef} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.14, 0.22, 24]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={0.6}
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}
