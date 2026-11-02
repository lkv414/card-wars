import type { Draft } from 'immer';
import { killInstance } from './damage';
import { finishMatch } from './finish';
import { emit, inPlayInstanceIds, instance, player } from './util';
import type { Ctx } from './util';
import { computeEff } from './stats';
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
 * Resolve destruction to a fixpoint (on-death mechanics return with mechanics v2,
 * docs/TECH.md № 2; the loop stays for that future).
 */
export function processDeaths(draft: Draft<MatchState>, ctx: Ctx): void {
  for (let guard = 0; guard < 200; guard++) {
    const dead = findDestroyed(draft, ctx);
    if (dead.length === 0) return;
    for (const id of dead) {
      const inst = killInstance(draft, ctx, id);
      emit(ctx, { type: 'creature_destroyed', instanceId: id, cardId: inst.cardId });
    }
  }
}

/** Remove every member of a team from the game (docs/RULES.md «2 на 2»). */
export function eliminateTeam(
  draft: Draft<MatchState>,
  ctx: Ctx,
  teamId: string,
): void {
  const team = draft.teams?.[teamId];
  if (!team || team.eliminated) return;
  team.eliminated = true;
  for (const pid of team.playerIds) {
    if (!draft.players[pid]!.eliminated) eliminatePlayer(draft, ctx, pid);
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

/** Standard post-effect batch: deaths, then elimination/win check. */
export function afterEffects(draft: Draft<MatchState>, ctx: Ctx): void {
  processDeaths(draft, ctx);
  if (draft.status === 'finished') return;

  if (draft.teams) {
    for (const team of Object.values(draft.teams)) {
      if (!team.eliminated && team.lives <= 0) eliminateTeam(draft, ctx, team.id);
    }
    const aliveTeams = Object.values(draft.teams).filter((team) => !team.eliminated);
    if (aliveTeams.length <= 1) {
      finishMatch(
        draft,
        ctx,
        aliveTeams.flatMap((team) => [...team.playerIds]),
        'elimination',
      );
    }
    return;
  }

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
