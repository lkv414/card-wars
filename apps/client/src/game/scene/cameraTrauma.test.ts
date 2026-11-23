import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCameraTrauma,
  getCameraTrauma,
  resetCameraTrauma,
  stepCameraTrauma,
} from './cameraTrauma';
import { soundEngine } from '../../sound/SoundEngine';

describe('cameraTrauma', () => {
  beforeEach(() => {
    resetCameraTrauma();
    soundEngine.setShakeEnabled(true);
  });

  it('adds trauma clamped to 1.0 and decays over time', () => {
    expect(getCameraTrauma()).toBe(0);

    addCameraTrauma(0.5);
    expect(getCameraTrauma()).toBe(0.5);

    addCameraTrauma(0.8);
    expect(getCameraTrauma()).toBe(1.0); // clamped at 1.0

    const offset = stepCameraTrauma(0.2, 1.0);
    expect(offset.x).not.toBe(0);
    expect(getCameraTrauma()).toBeLessThan(1.0);

    // Step 1 full second: should fully decay to 0
    stepCameraTrauma(1.0, 2.0);
    expect(getCameraTrauma()).toBe(0);
  });

  it('produces zero offset when shake is disabled in settings', () => {
    soundEngine.setShakeEnabled(false);
    addCameraTrauma(1.0);
    expect(getCameraTrauma()).toBe(0);

    const offset = stepCameraTrauma(0.016, 1.0);
    expect(offset).toEqual({ x: 0, y: 0, z: 0, roll: 0 });
  });
});
