/**
 * sceneResources — модульные шаренные ресурсы 3D-сцены.
 *
 * Что было (PERFORMANCE_AUDIT_3D.md, K3 + V2):
 *   - Каждый `<planeGeometry args=[...]>` в JSX → новая BufferGeometry. 180+ мешей = 180+ геометрий.
 *   - `<meshStandardMaterial>` в каждом `<mesh>` индикатора = новый материал на каждый рендер.
 *   - `rotation={[-Math.PI/2, 0, 0]}` / `position={[a,b,c]}` создают новый массив на каждый
 *     рендер → memo на GameLand/GameObject всегда промахивается.
 *
 * Что делаем:
 *   - Все однотипные геометрии создаются ОДИН раз на модуль, шарим по ссылке.
 *   - Базовые материалы (slot pad, border, indicator) тоже модульные.
 *   - Стабильные массивы/константы — на модуль (CARD_ROT, INDICATOR_POSITIONS и т.п.).
 *   - `Matrix4` для статичных слоёв (стол, сетка, обводки) считаются один раз → мы сможем
 *     поставить `matrixAutoUpdate = false` без пересчёта каждый кадр.
 *
 * Эффект: −~180 BufferGeometry, −GC-давление, −~10–20ms на hydration 3D-дерева.
 */
import * as THREE from 'three'

import {
  CARD_BASE_WIDTH,
  CARD_BASE_DEPTH,
  LANE_WIDTH,
  HALF_LANE_DEPTH,
  PLAY_FIELD_WIDTH,
  PLAY_FIELD_DEPTH,
} from './gameObjectPlacement.js'
import { LAND_BORDER_COLOR } from '../constants/landColors'

// ─────────────────────────────────────────────────────────────
// Геометрии — один экземпляр на модуль
// ─────────────────────────────────────────────────────────────

export const CARD_PLANE = new THREE.PlaneGeometry(CARD_BASE_WIDTH, CARD_BASE_DEPTH)
export const LAND_PLANE = new THREE.PlaneGeometry(LANE_WIDTH, HALF_LANE_DEPTH)
export const INDICATOR_PLANE = new THREE.PlaneGeometry(0.25, 0.2)
export const FLIP_PLANE = new THREE.PlaneGeometry(0.2, 0.2)

/** XZ-плоскость поля — статична, используется PlayFieldGrid/TableDecor. */
export const FIELD_PLANE = new THREE.PlaneGeometry(PLAY_FIELD_WIDTH + 0.08, PLAY_FIELD_DEPTH + 0.08)

/**
 * Базовые квадратные геометрии для обводки земли (тонкие полоски). Один раз на модуль.
 * Сами повороты и смещения задаются через instanceMatrix на уровне instancedMesh,
 * либо через position/rotation при ручном создании мешей (для обратной совместимости).
 */
export const BORDER_LONG = new THREE.PlaneGeometry(LANE_WIDTH - 0.036, 0.014)
export const BORDER_SHORT = new THREE.PlaneGeometry(0.014, HALF_LANE_DEPTH - 0.036)

// ─────────────────────────────────────────────────────────────
// Стабильные массивы — на модуль, чтобы memo не промахивался
// ─────────────────────────────────────────────────────────────

/** Карты на поле лежат плоско (face-up). */
export const CARD_ROT_FLAT = Object.freeze([-Math.PI / 2, 0, 0])

/** Координаты индикаторов (cost / land / atk / hp / flip) на лицевой стороне карты. */
export const INDICATOR_POSITIONS = Object.freeze({
  cost: Object.freeze([-CARD_BASE_WIDTH / 2 + 0.15, CARD_BASE_DEPTH / 2 - 0.12, 0.01]),
  landType: Object.freeze([-CARD_BASE_WIDTH / 2 + 0.15, CARD_BASE_DEPTH / 2 - 0.25, 0.01]),
  attack: Object.freeze([-CARD_BASE_WIDTH / 2 + 0.15, -CARD_BASE_DEPTH / 2 + 0.12, 0.01]),
  defense: Object.freeze([CARD_BASE_WIDTH / 2 - 0.15, -CARD_BASE_DEPTH / 2 + 0.12, 0.01]),
  flip: Object.freeze([CARD_BASE_WIDTH / 2 - 0.1, CARD_BASE_DEPTH / 2 - 0.12, 0.01]),
})

/** Y-уровень для лицевой стороны карты, лежащей на столе. */
export const CARD_LAYER_Y = 0.004

/** Y-уровень поверхности земли. */
export const LAND_SURFACE_Y = 0.002

/** Палитра индикаторов. */
export const INDICATOR_COLORS = Object.freeze({
  cost: '#FF9800',
  attack: '#F44336',
  defense: '#4CAF50',
  flip: '#FFC107',
})

/** Цвет атаки-таргета (используется в GameLand). */
export const ATTACK_TARGET_COLOR = '#ff5252'

// ─────────────────────────────────────────────────────────────
// Базовые материалы (shared, immutable)
// ─────────────────────────────────────────────────────────────

export const BORDER_MATERIAL = new THREE.MeshBasicMaterial({
  color: LAND_BORDER_COLOR,
  transparent: true,
  opacity: 0.9,
})

export const GRID_LINE_MATERIAL = new THREE.MeshBasicMaterial({
  color: '#2e5a28',
  transparent: true,
  opacity: 0.45,
})

export const FIELD_BORDER_MATERIAL = new THREE.MeshBasicMaterial({
  color: LAND_BORDER_COLOR,
  transparent: true,
  opacity: 0.35,
})

// ─────────────────────────────────────────────────────────────
// Подслоты (creature/building) — мемоизированные координаты
// ─────────────────────────────────────────────────────────────

const SLOT_DEPTH = HALF_LANE_DEPTH / 2

export const LAND_SLOT_LAYOUT = Object.freeze({
  creature: Object.freeze({
    x: 0,
    z: -SLOT_DEPTH / 2,
    width: LANE_WIDTH,
    depth: SLOT_DEPTH,
  }),
  building: Object.freeze({
    x: 0,
    z: SLOT_DEPTH / 2,
    width: LANE_WIDTH,
    depth: SLOT_DEPTH,
  }),
})

/**
 * Утилита: после использования ресурсов в эффектах/cleanup можно дёрнуть.
 * В текущей архитектуре R3F сам освобождает BufferGeometry/Material при unmount
 * соответствующих mesh'ей — модульные шаренные экземпляры специально НЕ
 * dispose'ятся здесь (их могло бы освободить несколько узлов). Если в будущем
 * добавим полное размонтирование Canvas — см. GameCanvas cleanup.
 */
export function disposeSharedSceneResources() {
  ;[
    CARD_PLANE,
    LAND_PLANE,
    INDICATOR_PLANE,
    FLIP_PLANE,
    FIELD_PLANE,
    BORDER_LONG,
    BORDER_SHORT,
  ].forEach((g) => g.dispose?.())
  ;[
    BORDER_MATERIAL,
    GRID_LINE_MATERIAL,
    FIELD_BORDER_MATERIAL,
  ].forEach((m) => m.dispose?.())
}