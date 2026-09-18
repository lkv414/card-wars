/**
 * BoardOutlines — instanced обводки всех земель на 3D-доске.
 *
 * Что было (PERFORMANCE_AUDIT_3D.md, 🟠 V3):
 *   - 4 границы × 8 земель = 32 меша = 32 draw calls. Каждый <mesh> + свой
 *     <planeGeometry> (или shared BORDER_LONG/SHORT) — всё равно отдельный
 *     draw call.
 *
 * Что делаем:
 *   - Один InstancedMesh на 32 экземпляра (4 границы × 8 земель).
 *   - Инстанс-матрицы вычисляются один раз через `instanceMatrix` —
 *     matrixAutoUpdate=false + count статичен. 0 matrix-обновлений в кадре.
 *   - Effect: −31 draw call, −31 matrix-update/кадр.
 *
 * Координаты:
 *   - 4 границы на землю (тонкий inset по периметру): top/bottom длинные,
 *     left/right короткие. Геометрии — BORDER_LONG/BORDER_SHORT (модульные).
 *   - Позиции инстансов пересчитываются по позиции/повороту зон (zone.center +
 *     zone.rotationY); считаем их на уровне GameBoard3D (useBoardModel) и
 *     передаём массивом.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

import {
  BORDER_LONG,
  BORDER_MATERIAL,
  LAND_SURFACE_Y,
} from '../../../utils/sceneResources'
import {
  LANE_WIDTH,
  HALF_LANE_DEPTH,
} from '../../../utils/gameObjectPlacement'

const BORDER_Y = LAND_SURFACE_Y + 0.0008
const inset = 0.018
const BORDER_W = LANE_WIDTH - inset * 2
const BORDER_D = HALF_LANE_DEPTH - inset * 2

/**
 * 4 границы одной земли в локальной системе координат (центр группы).
 * Geometry всех инстансов — BORDER_LONG (горизонтальный); вертикальные
 * границы получаются масштабированием через instanceMatrix.scale.
 * isVertical = true → сжимаем по X и растягиваем по Y (см. setMatrixAt).
 */
const LOCAL_EDGES = [
  { x: 0, z: -BORDER_D / 2, isVertical: false },
  { x: 0, z: BORDER_D / 2, isVertical: false },
  { x: -BORDER_W / 2, z: 0, isVertical: true },
  { x: BORDER_W / 2, z: 0, isVertical: true },
]

const _dummy = new THREE.Object3D()

/**
 * @param {Array<{center:[number,number,number], rotationY:number}>} zones
 */
export function BoardOutlines({ zones }) {
  const meshRef = useRef(null)

  // Количество инстансов = 4 * zones.length. Если зон нет — ничего не рендерим.
  const count = zones.length * LOCAL_EDGES.length

  // Один InstancedMesh с одной геометрией (BORDER_LONG) — все 4 границы
  // одной земли получаются масштабированием через instanceMatrix.scale.
  const geometry = BORDER_LONG

  useEffect(() => {
    if (!meshRef.current || count === 0) return
    const mesh = meshRef.current
    mesh.count = count
    for (let zi = 0; zi < zones.length; zi++) {
      const zone = zones[zi]
      for (let ei = 0; ei < LOCAL_EDGES.length; ei++) {
        const edge = LOCAL_EDGES[ei]
        _dummy.position.set(
          zone.center[0] + edge.x,
          BORDER_Y,
          zone.center[2] + edge.z,
        )
        _dummy.rotation.set(-Math.PI / 2, zone.rotationY, 0)
        if (edge.isVertical) {
          // Вертикальная граница: сжимаем по X (толщина) и растягиваем по Y (длина).
          _dummy.scale.set(0.014 / (LANE_WIDTH - 0.036), BORDER_D / 0.014, 1)
        } else {
          _dummy.scale.set(1, 1, 1)
        }
        _dummy.updateMatrix()
        mesh.setMatrixAt(zi * LOCAL_EDGES.length + ei, _dummy.matrix)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [zones, count])

  if (count === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, BORDER_MATERIAL, count]}
      frustumCulled={false}
    />
  )
}

export default BoardOutlines