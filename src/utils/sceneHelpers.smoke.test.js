/**
 * Smoke tests for sceneHelpers — exercised by `npm run test:smoke` (vitest).
 *
 * Follows the project's react-testing skill conventions:
 *   - AAA pattern (Arrange / Act / Assert)
 *   - Descriptive test names (no "works" / "test search")
 *   - Test public API only — no implementation-detail assertions
 */

import { describe, it, expect } from 'vitest'
import {
  OBJECT_TYPES,
  randomPosition,
  createSceneId,
  createSceneObject,
  clamp,
  TAU,
  SELECTION_COLOR,
} from './sceneHelpers.js'

describe('sceneHelpers.OBJECT_TYPES', () => {
  it('exposes a frozen enum of supported geometries', () => {
    // Arrange
    const expected = ['BOX', 'SPHERE', 'CONE', 'TORUS', 'CYLINDER']

    // Assert
    expect(Object.keys(OBJECT_TYPES).sort()).toEqual(expected.sort())
    expect(Object.isFrozen(OBJECT_TYPES)).toBe(true)
  })

  it('uses lowercase string values consumable by 3D switch', () => {
    for (const value of Object.values(OBJECT_TYPES)) {
      expect(typeof value).toBe('string')
      expect(value).toBe(value.toLowerCase())
    }
  })
})

describe('sceneHelpers.randomPosition', () => {
  it('returns a tuple inside the requested radius for default options', () => {
    // Arrange
    const radius = 5

    // Act
    const [x, y, z] = randomPosition({ radius })

    // Assert — point lies inside the cylinder footprint
    const r = Math.hypot(x, z)
    expect(r).toBeLessThanOrEqual(radius)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0.1)
    expect(y).toBeLessThanOrEqual(0.6)
  })

  it('respects innerHole so props never clip into the table center', () => {
    // Arrange
    const innerHole = 3
    const radius = 6
    const samples = 60

    // Act + Assert — every sample is at least innerHole from origin
    for (let i = 0; i < samples; i++) {
      const [x, , z] = randomPosition({ radius, innerHole })
      expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(innerHole - 1e-6)
    }
  })

  it('returns finite coordinates when radius is smaller than innerHole', () => {
    // Arrange
    const innerHole = 5
    const radius = 3 // radius <= innerHole — defensive case

    // Act
    const [x, , z] = randomPosition({ radius, innerHole })

    // Assert — never NaN, never crashes
    expect(Number.isFinite(x)).toBe(true)
    expect(Number.isFinite(z)).toBe(true)
  })
})

describe('sceneHelpers.createSceneId', () => {
  it('returns a non-empty string identifier', () => {
    const id = createSceneId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('produces unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 32 }, () => createSceneId()))
    expect(ids.size).toBe(32)
  })
})

describe('sceneHelpers.createSceneObject', () => {
  it('returns an object with stable defaults when no args are provided', () => {
    // Act
    const obj = createSceneObject()

    // Assert
    expect(obj.type).toBe(OBJECT_TYPES.BOX)
    expect(Array.isArray(obj.position)).toBe(true)
    expect(obj.position).toHaveLength(3)
    expect(typeof obj.scale).toBe('number')
    expect(obj.id).toBeTruthy()
  })

  it('lets the caller override any field', () => {
    // Act
    const obj = createSceneObject({
      type: OBJECT_TYPES.SPHERE,
      position: [1, 2, 3],
      color: '#ff0000',
      metalness: 0.8,
    })

    // Assert
    expect(obj.type).toBe(OBJECT_TYPES.SPHERE)
    expect(obj.position).toEqual([1, 2, 3])
    expect(obj.color).toBe('#ff0000')
    expect(obj.metalness).toBe(0.8)
  })

  it('attaches a fresh id for every call', () => {
    const a = createSceneObject()
    const b = createSceneObject()
    expect(a.id).not.toBe(b.id)
  })
})

describe('sceneHelpers.clamp', () => {
  it('returns the value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to the lower bound', () => {
    expect(clamp(-3, 0, 10)).toBe(0)
  })

  it('clamps to the upper bound', () => {
    expect(clamp(99, 0, 10)).toBe(10)
  })
})

describe('sceneHelpers.TAU', () => {
  it('equals 2π', () => {
    expect(TAU).toBeCloseTo(Math.PI * 2)
  })
})

describe('sceneHelpers.SELECTION_COLOR', () => {
  it('is the shared outline color used across the 3D scene', () => {
    // Single source of truth — keep Outlines in lockstep across components.
    expect(SELECTION_COLOR).toBe('#fbbf24')
  })
})
