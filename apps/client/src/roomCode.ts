import { CONFIG } from '@card-wars/protocol';

/** Random room code of `lobbyCodeDigits` digits (docs/CONFIG.md). */
export function makeRoomCode(): string {
  const digits = CONFIG.lobbyCodeDigits;
  const max = 10 ** digits;
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return String(buffer[0]! % max).padStart(digits, '0');
}

export function isRoomCode(value: string): boolean {
  return new RegExp(`^\\d{${CONFIG.lobbyCodeDigits}}$`).test(value);
}
