// Seeded PRNG port (docs/STRUCTURE.md: RNG through a port, seed lives in match state).
// mulberry32 — small, fast, good enough distribution for shuffles; fully deterministic.

export interface RngState {
  s: number;
}

export function createRngState(seed: number): RngState {
  return { s: seed >>> 0 };
}

export function rngNext(state: RngState): number {
  state.s = (state.s + 0x6d2b79f5) >>> 0;
  let t = state.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rngInt(state: RngState, maxExclusive: number): number {
  return Math.floor(rngNext(state) * maxExclusive);
}

/** Fisher-Yates on a copy; the input array is not modified. */
export function shuffle<T>(state: RngState, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rngInt(state, i + 1);
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function pickRandom<T>(state: RngState, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[rngInt(state, items.length)];
}
