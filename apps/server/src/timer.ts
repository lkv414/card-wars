// Turn timer state machine (docs/RULES.md «Таймер хода», docs/TECH.md «Таймеры (alarms DO)»).
// Pure functions over a serializable state; the Room feeds it Date.now() and
// schedules alarms from the returned deadline. The domain only ever sees the
// resulting time_expired command.

export interface TurnTimerState {
  running: boolean;
  remainingMs: number;
  /** Wall-clock ms of the last advance; null while paused. */
  lastUpdateMs: number | null;
  /** Until this wall-clock ms, time counts hurrySpeedupFactor× faster. */
  speedupUntilMs: number | null;
}

export interface TimerConfig {
  turnTimerSeconds: number;
  hurrySpeedupFactor: number;
  hurrySpeedupWindowSeconds: number;
}

export function stoppedTimer(): TurnTimerState {
  return { running: false, remainingMs: 0, lastUpdateMs: null, speedupUntilMs: null };
}

/** Consume elapsed wall time at 1× or the speedup rate, segment by segment. */
export function advance(state: TurnTimerState, now: number): TurnTimerState {
  if (!state.running || state.lastUpdateMs === null || now <= state.lastUpdateMs) {
    return { ...state, lastUpdateMs: state.running ? (state.lastUpdateMs ?? now) : null };
  }
  let t = state.lastUpdateMs;
  let remaining = state.remainingMs;
  let guard = 0;
  while (t < now && guard++ < 100) {
    const speeding = state.speedupUntilMs !== null && t < state.speedupUntilMs;
    if (speeding) {
      const segEnd = Math.min(now, state.speedupUntilMs!);
      remaining -= (segEnd - t) * 2;
      t = segEnd;
    } else {
      remaining -= now - t;
      t = now;
    }
  }
  return { ...state, remainingMs: remaining, lastUpdateMs: now };
}

/** First «Поторопить» starts the countdown; every press restarts the speedup window. */
export function hurry(
  state: TurnTimerState,
  now: number,
  cfg: TimerConfig,
): { state: TurnTimerState; started: boolean } {
  let next = advance(state, now);
  const started = !next.running;
  if (!next.running) {
    next = { running: true, remainingMs: cfg.turnTimerSeconds * 1000, lastUpdateMs: now, speedupUntilMs: null };
  }
  next = { ...next, speedupUntilMs: now + cfg.hurrySpeedupWindowSeconds * 1000, lastUpdateMs: now };
  return { state: next, started };
}

export function pause(state: TurnTimerState, now: number): TurnTimerState {
  const advanced = advance(state, now);
  return { ...advanced, running: advanced.running, lastUpdateMs: null };
}

export function resume(state: TurnTimerState, now: number): TurnTimerState {
  if (!state.running || state.lastUpdateMs !== null) return state;
  return { ...state, lastUpdateMs: now };
}

export function remainingMs(state: TurnTimerState, now: number): number {
  return Math.max(0, advance(state, now).remainingMs);
}

/** Earliest wall-clock moment the timer can expire; null when not running. */
export function deadlineMs(state: TurnTimerState, now: number): number | null {
  if (!state.running) return null;
  // worst case: no further speedup → remaining at 1×
  return now + remainingMs(state, now);
}

export function expired(state: TurnTimerState, now: number): boolean {
  return state.running && remainingMs(state, now) <= 0;
}
