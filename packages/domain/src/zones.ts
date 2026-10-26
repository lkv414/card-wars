import type { MatchState, PlayerId, TeamState } from './types';

/** Mirror pairing (docs/RULES.md «Зоны»): zone i faces zone n-1-i of the opponent. */
export function mirrorZoneIndex(zone: number, zoneCount: number): number {
  return zoneCount - 1 - zone;
}

export function isActive(state: MatchState, playerId: PlayerId): boolean {
  return state.activePlayers.includes(playerId);
}

export function teamOf(state: MatchState, playerId: PlayerId): TeamState | null {
  const teamId = state.players[playerId]?.teamId;
  if (!teamId || !state.teams) return null;
  return state.teams[teamId] ?? null;
}

export function alivePlayerIds(state: MatchState): PlayerId[] {
  return state.order.filter((pid) => !state.players[pid]!.eliminated);
}

/** Alive players not on the same team (all others in FFA). */
export function opponentsOf(state: MatchState, playerId: PlayerId): PlayerId[] {
  const teamId = state.players[playerId]?.teamId ?? null;
  return alivePlayerIds(state).filter(
    (pid) => pid !== playerId && (teamId === null || state.players[pid]!.teamId !== teamId),
  );
}

/** Alive teammates excluding the player (empty in FFA). */
export function teammatesOf(state: MatchState, playerId: PlayerId): PlayerId[] {
  const teamId = state.players[playerId]?.teamId ?? null;
  if (!teamId) return [];
  return alivePlayerIds(state).filter(
    (pid) => pid !== playerId && state.players[pid]!.teamId === teamId,
  );
}

/**
 * Nearest alive opponent in the given direction around the seating order
 * (docs/RULES.md «Подготовка партии»). -1 = left (previous), +1 = right (next).
 * Teammates are skipped: in 2v2 allies never fight each other.
 */
export function neighborOf(
  state: MatchState,
  playerId: PlayerId,
  direction: -1 | 1,
): PlayerId | null {
  const alive = alivePlayerIds(state);
  const start = alive.indexOf(playerId);
  if (start < 0) return null;
  const selfTeam = state.players[playerId]!.teamId;
  for (let step = 1; step < alive.length; step++) {
    const index = (start + direction * step + alive.length * 2) % alive.length;
    const candidate = alive[index]!;
    if (candidate === playerId) continue;
    if (selfTeam !== null && state.players[candidate]!.teamId === selfTeam) continue;
    return candidate;
  }
  return null;
}

export interface ZoneRef {
  player: PlayerId;
  zone: number;
}

/**
 * Which zone (of which opponent) an attacking zone faces.
 * - FFA and 2v2 «соседи»: zones 1–2 face the left alive neighbour, 3–4 the right one,
 *   mirrored inside the defender's row (my zone N faces their zone 5−N, 1-based).
 * - 2v2 «стенка»: the team row is 8 zones; zone N faces zone 9−N of the enemy row.
 */
export function opponentZoneFor(
  state: MatchState,
  attackerId: PlayerId,
  zone: number,
): ZoneRef | null {
  const attacker = state.players[attackerId];
  if (!attacker || attacker.eliminated) return null;
  const zoneCount = attacker.zones.length;
  const team = teamOf(state, attackerId);

  if (state.mode === 'teams' && state.teamVariant === 'wall') {
    if (!team || !state.teams) return null;
    const enemyTeam = Object.values(state.teams).find((t) => t.id !== team.id && !t.eliminated);
    if (!enemyTeam) return null;
    const half = team.playerIds.indexOf(attackerId);
    if (half < 0) return null;
    const rowLength = zoneCount * team.playerIds.length;
    const global = half * zoneCount + zone;
    const mirrored = rowLength - 1 - global;
    const defenderId = enemyTeam.playerIds[Math.floor(mirrored / zoneCount)];
    if (!defenderId || state.players[defenderId]!.eliminated) return null;
    return { player: defenderId, zone: mirrored % zoneCount };
  }

  if (typeof zone !== 'number' || zone < 0 || zone >= zoneCount) return null;
  const leftHalf = zone < Math.floor(zoneCount / 2);
  const defenderId = neighborOf(state, attackerId, leftHalf ? -1 : 1);
  if (!defenderId) return null;
  return { player: defenderId, zone: mirrorZoneIndex(zone, zoneCount) };
}
