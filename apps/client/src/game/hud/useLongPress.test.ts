import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createLongPressController, triggerHapticVibration } from './useLongPress';

describe('useLongPress & triggerHapticVibration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('safely calls triggerHapticVibration without throwing in node / non-navigator environment', () => {
    expect(() => triggerHapticVibration(30)).not.toThrow();
  });

  it('invokes navigator.vibrate when available', () => {
    const vibrateSpy = vi.fn();
    const originalNavigator = globalThis.navigator;

    Object.defineProperty(globalThis, 'navigator', {
      value: { vibrate: vibrateSpy },
      configurable: true,
      writable: true,
    });

    triggerHapticVibration(30);
    expect(vibrateSpy).toHaveBeenCalledWith([30]);

    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('triggers onLongPress after 450ms when pointer is held stationary', () => {
    let fired = false;
    const { onPointerDown } = createLongPressController(() => {
      fired = true;
    }, { thresholdMs: 450 });

    const fakeEvent = { clientX: 100, clientY: 100 } as PointerEvent;
    onPointerDown(fakeEvent);

    vi.advanceTimersByTime(400);
    expect(fired).toBe(false);

    vi.advanceTimersByTime(60);
    expect(fired).toBe(true);
  });

  it('cancels long-press when pointer moves beyond threshold', () => {
    let fired = false;
    const { onPointerDown, onPointerMove } = createLongPressController(() => {
      fired = true;
    }, { thresholdMs: 450, moveThresholdPx: 15 });

    onPointerDown({ clientX: 100, clientY: 100 } as PointerEvent);
    vi.advanceTimersByTime(200);

    // Moved 25px
    onPointerMove({ clientX: 125, clientY: 100 } as PointerEvent);
    vi.advanceTimersByTime(300);

    expect(fired).toBe(false);
  });

  it('cancels long-press on pointerup before threshold', () => {
    let fired = false;
    const { onPointerDown, onPointerUp } = createLongPressController(() => {
      fired = true;
    }, { thresholdMs: 450 });

    onPointerDown({ clientX: 100, clientY: 100 } as PointerEvent);
    vi.advanceTimersByTime(200);

    onPointerUp();
    vi.advanceTimersByTime(300);

    expect(fired).toBe(false);
  });
});
