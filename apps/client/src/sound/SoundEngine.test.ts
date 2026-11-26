import { beforeEach, describe, expect, it } from 'vitest';
import { soundEngine } from './SoundEngine';

describe('SoundEngine', () => {
  beforeEach(() => {
    soundEngine.setMuted(false);
    soundEngine.setVolume(0.7);
    soundEngine.setShakeEnabled(true);
  });

  it('provides default sound settings and allows toggles', () => {
    expect(soundEngine.getSettings().volume).toBe(0.7);
    expect(soundEngine.getSettings().muted).toBe(false);
    expect(soundEngine.isShakeEnabled()).toBe(true);

    soundEngine.setMuted(true);
    expect(soundEngine.getSettings().muted).toBe(true);

    soundEngine.setVolume(0.35);
    expect(soundEngine.getSettings().volume).toBe(0.35);

    soundEngine.setShakeEnabled(false);
    expect(soundEngine.isShakeEnabled()).toBe(false);

    expect(soundEngine.isMusicEnabled()).toBe(false);
    soundEngine.startMusic();
    expect(soundEngine.isMusicEnabled()).toBe(true);
    soundEngine.stopMusic();
    expect(soundEngine.isMusicEnabled()).toBe(false);
    const toggled = soundEngine.toggleMusic();
    expect(toggled).toBe(true);
    expect(soundEngine.isMusicEnabled()).toBe(true);
    soundEngine.stopMusic();
  });

  it('provides random pitch detune variance within expected bounds', () => {
    for (let i = 0; i < 20; i++) {
      const detune = soundEngine.randomDetune(65);
      expect(detune).toBeGreaterThanOrEqual(-65);
      expect(detune).toBeLessThanOrEqual(65);
    }
  });

  it('safely calls play methods in headless / node environment without throwing', () => {
    expect(() => soundEngine.playCardHover()).not.toThrow();
    expect(() => soundEngine.playCardSelect()).not.toThrow();
    expect(() => soundEngine.playCardDiscard()).not.toThrow();
    expect(() => soundEngine.playTurnStart(true)).not.toThrow();
    expect(() => soundEngine.playTurnStart(false)).not.toThrow();
    expect(() => soundEngine.playCardPlay()).not.toThrow();
    expect(() => soundEngine.playCardDraw()).not.toThrow();
    expect(() => soundEngine.playFloop()).not.toThrow();
    expect(() => soundEngine.playAttackHit(3)).not.toThrow();
    expect(() => soundEngine.playHeroDamage(5)).not.toThrow();
    expect(() => soundEngine.playGong()).not.toThrow();
    expect(() => soundEngine.playFuseTick(true)).not.toThrow();
    expect(() => soundEngine.playFuseTick(false)).not.toThrow();
    expect(() => soundEngine.playFreeze()).not.toThrow();
    expect(() => soundEngine.playLandFreeze()).not.toThrow();
    expect(() => soundEngine.playHeal()).not.toThrow();
    expect(() => soundEngine.playButtonClick()).not.toThrow();
    expect(() => soundEngine.playEmoteChirp()).not.toThrow();
    expect(() => soundEngine.playEmote()).not.toThrow();
    expect(() => soundEngine.playVictoryFanfare()).not.toThrow();
    expect(() => soundEngine.playVictory()).not.toThrow();
    expect(() => soundEngine.playDefeatSound()).not.toThrow();
    expect(() => soundEngine.playDefeat()).not.toThrow();
    expect(() => soundEngine.playTomatoThrow()).not.toThrow();
    expect(() => soundEngine.playTomatoSplat()).not.toThrow();
    expect(() => soundEngine.playError()).not.toThrow();
    expect(() => soundEngine.playModalOpen()).not.toThrow();
    expect(() => soundEngine.playModalClose()).not.toThrow();
    expect(() => soundEngine.playDeckSave()).not.toThrow();
  });
});
