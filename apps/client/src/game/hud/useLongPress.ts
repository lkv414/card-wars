import { useCallback, useRef } from 'react';

export interface LongPressOptions {
  thresholdMs?: number; // 450ms per kiberbus audit
  moveThresholdPx?: number; // 15px max movement
  vibrateMs?: number; // 30ms haptic buzz per kiberbus audit
}

/**
 * Trigger mobile vibration safely.
 */
export function triggerHapticVibration(durationMs = 30): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([durationMs]);
    }
  } catch {
    // ignore
  }
}

/**
 * 450ms long-press gesture controller with vibration feedback for mobile card inspection.
 * (docs/AUDIT-KIBERBUS-UIUX.md §1, §8 Этап 5).
 */
export function createLongPressController(
  onLongPress: (e: PointerEvent | TouchEvent | MouseEvent | { clientX: number; clientY: number }) => void,
  options: LongPressOptions = {},
) {
  const { thresholdMs = 450, moveThresholdPx = 15, vibrateMs = 30 } = options;
  let timer: number | null = null;
  let startPos: { x: number; y: number } | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    startPos = null;
  };

  const start = (e: PointerEvent | TouchEvent | MouseEvent | { clientX: number; clientY: number }) => {
    clear();
    const clientX = 'clientX' in e ? e.clientX : (e as TouchEvent).touches?.[0]?.clientX ?? 0;
    const clientY = 'clientY' in e ? e.clientY : (e as TouchEvent).touches?.[0]?.clientY ?? 0;
    startPos = { x: clientX, y: clientY };

    timer = setTimeout(() => {
      triggerHapticVibration(vibrateMs);
      onLongPress(e);
      clear();
    }, thresholdMs) as unknown as number;
  };

  const move = (e: PointerEvent | TouchEvent | MouseEvent | { clientX: number; clientY: number }) => {
    if (!startPos) return;
    const clientX = 'clientX' in e ? e.clientX : (e as TouchEvent).touches?.[0]?.clientX ?? 0;
    const clientY = 'clientY' in e ? e.clientY : (e as TouchEvent).touches?.[0]?.clientY ?? 0;
    const dist = Math.hypot(clientX - startPos.x, clientY - startPos.y);
    if (dist > moveThresholdPx) {
      clear();
    }
  };

  return {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: clear,
    onPointerCancel: clear,
    clear,
  };
}

/**
 * 450ms long-press gesture hook with vibration feedback for mobile card inspection.
 */
export function useLongPress(
  onLongPress: (e: PointerEvent | TouchEvent | MouseEvent) => void,
  options: LongPressOptions = {},
) {
  const ctrlRef = useRef<ReturnType<typeof createLongPressController> | null>(null);
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;

  if (!ctrlRef.current) {
    ctrlRef.current = createLongPressController((e) => onLongPressRef.current(e as PointerEvent), options);
  }

  const clear = useCallback(() => ctrlRef.current?.clear(), []);
  const onPointerDown = useCallback((e: PointerEvent | TouchEvent | MouseEvent) => ctrlRef.current?.onPointerDown(e), []);
  const onPointerMove = useCallback((e: PointerEvent | TouchEvent | MouseEvent) => ctrlRef.current?.onPointerMove(e), []);
  const onPointerUp = useCallback(() => ctrlRef.current?.onPointerUp(), []);
  const onPointerCancel = useCallback(() => ctrlRef.current?.onPointerCancel(), []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    clear,
  };
}
