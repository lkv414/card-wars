import type { Draft } from 'immer';
import { drawCards } from '../draw';
import type { Ctx } from '../util';
import { emit, player } from '../util';
import type { MatchState, PlayerId } from '../types';
import { teamOf } from '../zones';
import { drainTriggers, enqueueTrigger } from '../mechanics/dispatch';

/** The last non-eliminated player in seating order — the only one attacking in round 1 (docs/RULES.md). */
export function lastAliveInOrder(draft: Draft<MatchState>): string {
  for (let i = draft.order.length - 1; i >= 0; i--) {
    const pid = draft.order[i]!;
    if (!draft.players[pid]!.eliminated) return pid;
  }
  throw new Error('no alive players');
}

/** Untap + automatic draw phase + start-of-turn triggers + actions (docs/MECHANICS-V2.md §2Б). */
function startPlayerTurn(draft: Draft<MatchState>, ctx: Ctx, pid: PlayerId): void {
  const p = player(draft, pid);

  // Подготовка: own field cards and companion become ready again.
  for (const zone of p.zones) {
    if (zone.creature) draft.instances[zone.creature]!.flipped = false;
    if (zone.building) draft.instances[zone.building]!.flipped = false;
  }
  if (p.companion) draft.instances[p.companion]!.flipped = false;

  // Добор: free draws are automatic (docs/RULES.md, «Ход игрока»).
  draft.phase = 'draw';
  emit(ctx, { type: 'phase_changed', player: pid, phase: 'draw' });
  enqueueTrigger(draft, ctx, 'start_of_turn', { player: pid });
  drawCards(draft, ctx, pid, ctx.config.freeDrawsPerTurn);

  draft.phase = 'main';
  emit(ctx, { type: 'phase_changed', player: pid, phase: 'main' });
  p.actions = ctx.config.actionsPerTurn;
  drainTriggers(draft, ctx);
}

/**
 * Start a turn for the active set: one player in FFA, both allies in 2v2.
 * Each active player gets their own preparation, draw and action pool.
 */
export function startTurn(draft: Draft<MatchState>, ctx: Ctx): void {
  draft.turn += 1;
  for (const pid of draft.order) draft.players[pid]!.battleReady = false;
  for (const pid of draft.activePlayers) {
    emit(ctx, { type: 'turn_started', player: pid, turn: draft.turn, round: draft.round });
    startPlayerTurn(draft, ctx, pid);
  }
  draft.phase = 'main';
}

/** Burn leftovers, drop spell visuals, pass to the next team/player. */
export function endTurn(draft: Draft<MatchState>, ctx: Ctx): void {
  draft.castSpells = [];
  for (const pid of draft.activePlayers) player(draft, pid).actions = 0;

  const current = draft.activePlayers;
  const currentTeamId = draft.players[current[0]!]!.teamId;
  const lastSeat = Math.max(...current.map((pid) => draft.order.indexOf(pid)));
  let nextPid: PlayerId | null = null;
  let wrapped = false;

  for (let step = 1; step <= draft.order.length; step++) {
    const index = (lastSeat + step) % draft.order.length;
    const pid = draft.order[index]!;
    const p = draft.players[pid]!;
    if (p.eliminated) continue;
    if (currentTeamId !== null && p.teamId === currentTeamId) continue;
    nextPid = pid;
    wrapped = index <= lastSeat;
    break;
  }
  if (!nextPid) return; // no opponents left; the match is finished elsewhere

  if (wrapped) draft.round += 1;
  const nextTeam = teamOf(draft, nextPid);
  draft.activePlayers = nextTeam
    ? nextTeam.playerIds.filter((pid) => !draft.players[pid]!.eliminated)
    : [nextPid];
  draft.activePlayer = draft.activePlayers[0]!;
  startTurn(draft, ctx);
}
