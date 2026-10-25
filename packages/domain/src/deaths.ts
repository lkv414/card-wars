import type { Draft } from 'immer';
import { killInstance } from './damage';
import { fireTriggerForInstance } from './effects/interpreter';
import { emit, inPlayInstanceIds, instance, player } from './util';
import type { Ctx } from './util';
import { computeEff } from './effects/stats';
import type { CardData, MatchState, PlayerId } from './types';

/** Creatures on the field with damage >= effective defense. */
function findDestroyed(draft: Draft<MatchState>, ctx: Ctx): string[] {
  const dead: string[] = [];
  for (const id of inPlayInstanceIds(draft)) {
    const inst = instance(draft, id);
    if (inst.location !== 'field') continue;
    const card: CardData | undefined = ctx.catalog.getCard(inst.cardId);
    if (!card || card.type !== 'creature') continue;
    const eff = computeEff(draft, ctx, id);
    if (inst.damage >= eff.defense) dead.push(id);
  }
  return dead;
}

/**
 * Resolve destruction to a fixpoint: destroying cards can change auras
 * (and on_death effects can deal more damage), so re-scan until stable.
 */
export function processDeaths(draft: Draft<MatchState>, ctx: Ctx): void {
  for (let guard = 0; guard < 200; guard++) {
    const dead = findDestroyed(draft, ctx);
    if (dead.length === 0) return;
    for (const id of dead) {
      const inst = killInstance(draft, ctx, id);
      emit(ctx, { type: 'creature_destroyed', instanceId: id, cardId: inst.cardId });
    }
    for (const id of dead) {
      fireTriggerForInstance(draft, ctx, 'on_death', id);
    }
  }
}

/** Remove a player's field cards and companion from the game (docs/RULES.md «Выбывание»). */
export function eliminatePlayer(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId): void {
  const p = player(draft, playerId);
  p.eliminated = true;
  for (const zone of p.zones) {
    for (const slot of ['creature', 'building'] as const) {
      const id = zone[slot];
      if (id) {
        instance(draft, id).location = 'removed';
        zone[slot] = null;
      }
    }
  }
  if (p.companion) {
    instance(draft, p.companion).location = 'removed';
    p.companion = null;
  }
  emit(ctx, { type: 'player_eliminated', player: playerId });
}

export function finishMatch(
  draft: Draft<MatchState>,
  ctx: Ctx,
  winners: PlayerId[],
  reason: 'elimination' | 'surrender',
): void {
  draft.status = 'finished';
  draft.winners = winners;
  draft.finishReason = reason;
  emit(ctx, { type: 'match_finished', winners, reason });
}

/** Standard post-effect batch: deaths, then elimination/win check. */
export function afterEffects(draft: Draft<MatchState>, ctx: Ctx): void {
  processDeaths(draft, ctx);
  if (draft.status === 'finished') return;
  const justEliminated: PlayerId[] = [];
  for (const pid of draft.order) {
    const p = draft.players[pid]!;
    if (!p.eliminated && p.lives <= 0) {
      eliminatePlayer(draft, ctx, pid);
      justEliminated.push(pid);
    }
  }
  if (justEliminated.length === 0) return;
  const alive = draft.order.filter((pid) => !draft.players[pid]!.eliminated);
  if (alive.length <= 1) {
    finishMatch(draft, ctx, alive, 'elimination');
  }
}
