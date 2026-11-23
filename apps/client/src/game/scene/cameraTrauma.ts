import { soundEngine } from '../../sound/SoundEngine';

/**
 * Camera Trauma / Screen Shake Physics (Stage 2)
 *
 * Implements game-feel camera trauma with non-linear quadratic decay:
 * Shake = Trauma^2 * maxShake
 *
 * This makes small hits produce a subtle tremble, while heavy hits (or critical hero strikes)
 * cause a powerful, comic-book style jolt that dissipates smoothly.
 */

let trauma = 0.0;
const MAX_OFFSET_X = 24; // Three.js world units
const MAX_OFFSET_Y = 18;
const MAX_OFFSET_Z = 12;
const MAX_ROLL = 0.035; // radians
const DECAY_PER_SECOND = 1.9;

export function addCameraTrauma(amount: number): void {
  if (!soundEngine.isShakeEnabled()) return;
  trauma = Math.min(1.0, trauma + Math.max(0, amount));
}

export function resetCameraTrauma(): void {
  trauma = 0.0;
}

export function getCameraTrauma(): number {
  return trauma;
}

export interface CameraShakeOffset {
  x: number;
  y: number;
  z: number;
  roll: number;
}

/**
 * Updates trauma decay and calculates current pseudo-random shake displacement.
 */
export function stepCameraTrauma(deltaSec: number, timeSec: number): CameraShakeOffset {
  if (trauma <= 0.001 || !soundEngine.isShakeEnabled()) {
    trauma = 0.0;
    return { x: 0, y: 0, z: 0, roll: 0 };
  }

  // Linear decay with delta time
  trauma = Math.max(0, trauma - DECAY_PER_SECOND * deltaSec);
  const shake = trauma * trauma;

  // Multi-frequency harmonic sinusoids for organic organic comic impact feel
  const x = MAX_OFFSET_X * shake * (Math.sin(timeSec * 41.7) * 0.7 + Math.sin(timeSec * 83.1) * 0.3);
  const y = MAX_OFFSET_Y * shake * (Math.cos(timeSec * 37.3) * 0.7 + Math.cos(timeSec * 71.5) * 0.3);
  const z = MAX_OFFSET_Z * shake * (Math.sin(timeSec * 29.1) * 0.8 + Math.cos(timeSec * 59.4) * 0.2);
  const roll = MAX_ROLL * shake * Math.sin(timeSec * 33.3);

  return { x, y, z, roll };
}
