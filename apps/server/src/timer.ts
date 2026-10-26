// Turn timer state machine (docs/RULES.md «Таймер хода», docs/TECH.md «Таймеры (alarms DO)»).
// Pure functions over a serializable state; the Room feeds it Date.now() and
// schedules alarms from the returned deadline. The domain only ever sees the
// resulting time_expired command.

export interface TurnTimerState {
  running: boolean;
  remainingMs: number;
  /** Wall-clock ms of the last advance; null while paused. */
  lastUpdateMs: number | null;
  /** Until this wall-clock ms, time counts `speedupFactor`× faster. */
  speedupUntilMs: number | null;
  /** Configured hurry factor captured when the timer starts (docs/CONFIG.md). */
  speedupFactor: number;
}

export interface TimerConfig {
  turnTimerSeconds: number;
  hurrySpeedupFactor: number;
  hurrySpeedupWindowSeconds: number;
}

export function stoppedTimer(): TurnTimerState {
  return { running: false, remainingMs: 0, lastUpdateMs: null, speedupUntilMs: null, speedupFactor: 1 };
}

/** Consume elapsed wall time at 1× or the speedup rate, segment by segment. */
export function advance(state: TurnTimerState, now: number): TurnTimerState {
  if (!state.running || state.lastUpdateMs === null || now <= state.lastUpdateMs) {
    return { ...state, lastUpdateMs: state.running ? (state.lastUpdateMs ?? now) : null };
  }
  const factor = state.speedupFactor ?? 1;
  let t = state.lastUpdateMs;
  let remaining = state.remainingMs;
  let guard = 0;
  while (t < now && guard++ < 100) {
    const speeding = state.speedupUntilMs !== null && t < state.speedupUntilMs;
    if (speeding) {
      const segEnd = Math.min(now, state.speedupUntilMs!);
      remaining -= (segEnd - t) * factor;
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
    next = {
      running: true,
      remainingMs: cfg.turnTimerSeconds * 1000,
      lastUpdateMs: now,
      speedupUntilMs: null,
      speedupFactor: cfg.hurrySpeedupFactor,
    };
  }
  next = {
    ...next,
    speedupUntilMs: now + cfg.hurrySpeedupWindowSeconds * 1000,
    lastUpdateMs: now,
    speedupFactor: cfg.hurrySpeedupFactor,
  };
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

/** Earliest wall-clock moment the timer expires given the current speedup window. */
export function deadlineMs(state: TurnTimerState, now: number): number | null {
  if (!state.running) return null;
  const current = advance(state, now);
  let remaining = current.remainingMs;
  if (remaining <= 0) return now;
  let t = now;
  const factor = current.speedupFactor ?? 1;
  if (factor > 1 && current.speedupUntilMs !== null && current.speedupUntilMs > now) {
    const fastConsume = (current.speedupUntilMs - now) * factor;
    if (fastConsume >= remaining) return t + Math.ceil(remaining / factor);
    remaining -= fastConsume;
    t = current.speedupUntilMs;
  }
  return t + remaining;
}

export function expired(state: TurnTimerState, now: number): boolean {
  return state.running && remainingMs(state, now) <= 0;
}
