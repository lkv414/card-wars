/**
 * sceneHelpers — shared scene utilities for the 3D game board.
 *
 * Centralizes object-kind enums, factory helpers, and random-position math so
 * 3D components stay declarative. Mirrors the testing_3d reference stack
 * (`src/utils/sceneHelpers.js`): OBJECT_TYPES, randomPosition, createSceneObject.
 *
 * Card-game specific helpers (zone card kind, slot-kind color) live next to
 * their domain so this file stays pure.
 */

import * as THREE from 'three'

/**
 * Available scene-object geometries for non-card props (decor, markers).
 * Cards themselves keep their own textured plane geometry.
 */
export const OBJECT_TYPES = Object.freeze({
  BOX: 'box',
  SPHERE: 'sphere',
  CONE: 'cone',
  TORUS: 'torus',
  CYLINDER: 'cylinder',
})

/**
 * Generate a random position inside a flat circular table footprint.
 * Keeps props from clipping into the camera view.
 */
export function randomPosition({
  radius = 5,
  minY = 0.1,
  maxY = 0.6,
  innerHole = 0,
} = {}) {
  const r = innerHole + Math.random() * Math.max(0, radius - innerHole)
  const theta = Math.random() * Math.PI * 2
  return [Math.cos(theta) * r, minY + Math.random() * (maxY - minY), Math.sin(theta) * r]
}

/**
 * Stable, content-agnostic ID for scene props.
 * crypto.randomUUID is available in modern browsers and Node 19+.
 */
export function createSceneId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Factory for a brand-new scene prop with sane defaults.
 * Position is randomized; callers can override every field.
 */
export function createSceneObject({
  type = OBJECT_TYPES.BOX,
  position,
  rotation = [0, 0, 0],
  scale = 1,
  color = '#90a4ae',
  metalness = 0.1,
  roughness = 0.6,
  ...rest
} = {}) {
  return {
    id: createSceneId(),
    type,
    position: position ?? randomPosition(),
    rotation,
    scale,
    color,
    metalness,
    roughness,
    ...rest,
  }
}

/** Convenience: clamp helpers for camera math. */
export const TAU = Math.PI * 2

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

/** Color helpers — share between slots / outlines without prop drilling hex. */
export function colorFromHex(hex) {
  return new THREE.Color(hex)
}

/**
 * Selection highlight color used by both <Outlines> and any fallback emissive.
 * Keep one source of truth so retunes happen in a single place.
 */
export const SELECTION_COLOR = '#fbbf24'