import { describe, expect, it } from 'vitest';
import {
  advance,
  deadlineMs,
  expired,
  hurry,
  pause,
  remainingMs,
  resume,
  stoppedTimer,
} from './timer';

const cfg = { turnTimerSeconds: 90, hurrySpeedupFactor: 2, hurrySpeedupWindowSeconds: 1 };

describe('таймер хода (стейт-машина адаптера)', () => {
  it('первое «Поторопить» запускает отсчёт на 90 секунд и само даёт окно ×2', () => {
    const { state, started } = hurry(stoppedTimer(), 1000, cfg);
    expect(started).toBe(true);
    expect(remainingMs(state, 1000)).toBe(90_000);
    // первая секунда идёт под ускорением первого нажатия
    expect(remainingMs(state, 2000)).toBe(88_000);
    expect(remainingMs(state, 3000)).toBe(87_000);
  });

  it('повторное нажатие не сбрасывает остаток, а ускоряет на 1 секунду', () => {
    let { state } = hurry(stoppedTimer(), 1000, cfg);
    state = advance(state, 10_000); // прошло 9 секунд (+1 в ускорении) → остаток 80_000
    expect(remainingMs(state, 10_000)).toBe(80_000);
    // спам в t=10_000: окно ускорения заново на 1 с, остаток не сброшен
    const again = hurry(state, 10_000, cfg);
    expect(again.started).toBe(false);
    expect(remainingMs(again.state, 10_000)).toBe(80_000);
    // за следующую секунду списывается вдвое больше
    expect(remainingMs(again.state, 11_000)).toBe(78_000);
    // после окна — обычная скорость
    expect(remainingMs(again.state, 12_000)).toBe(77_000);
  });

  it('спам держит ускорение: каждое нажатие перезапускает окно', () => {
    let { state } = hurry(stoppedTimer(), 0, cfg);
    for (let t = 0; t < 5000; t += 500) {
      state = hurry(state, t, cfg).state;
    }
    // 5 секунд по ×2 → минус 10 секунд от 90
    expect(remainingMs(state, 5000)).toBe(80_000);
  });

  it('истекает и показывает дедлайн для alarm', () => {
    let { state } = hurry(stoppedTimer(), 0, cfg);
    // уберём окно ускорения, чтобы проверить обычный ход времени
    state = { ...state, remainingMs: 500, speedupUntilMs: null };
    expect(expired(state, 400)).toBe(false);
    expect(expired(state, 600)).toBe(true);
    expect(deadlineMs(state, 0)).toBe(500);
  });

  it('пауза замораживает остаток, возврат продолжает', () => {
    let { state } = hurry(stoppedTimer(), 0, cfg);
    state = advance(state, 10_000); // окно 0–1 с ×2 + 9 с обычных → 90−2−9 = 79_000
    expect(remainingMs(state, 10_000)).toBe(79_000);
    const paused = pause(state, 10_000);
    expect(remainingMs(paused, 60_000)).toBe(79_000); // время стоит
    const resumed = resume(paused, 60_000);
    expect(remainingMs(resumed, 61_000)).toBe(78_000);
  });

  it('дедлайн учитывает текущее окно ускорения', () => {
    const { state } = hurry(stoppedTimer(), 0, cfg);
    // 90 с остатка, первая секунда ×2: к t=1000 остаётся 88 с → дедлайн 89 000.
    expect(deadlineMs(state, 0)).toBe(89_000);
    const later = advance(state, 2000);
    expect(deadlineMs(later, 2000)).toBe(89_000);
  });

  it('выключенный таймер не даёт дедлайна', () => {
    expect(deadlineMs(stoppedTimer(), 0)).toBeNull();
    expect(expired(stoppedTimer(), 1e9)).toBe(false);
  });
});
