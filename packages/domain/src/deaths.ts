import type { Draft } from 'immer';
import { killInstance } from './damage';
import { finishMatch } from './finish';
import { emit, inPlayInstanceIds, instance, player } from './util';
import type { Ctx } from './util';
import { computeEff } from './stats';
import { drainTriggers, enqueueLeavePlay, enqueueTrigger } from './mechanics/dispatch';
import { bumpCounter } from './mechanics/effects';
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
      const prevZone = instance(draft, id).zone;
      const inst = killInstance(draft, ctx, id);
      emit(ctx, { type: 'creature_destroyed', instanceId: id, cardId: inst.cardId });
      bumpCounter(draft, 'creature_died', inst.controller);
      enqueueLeavePlay(draft, ctx, id, inst.cardId, inst.controller, prevZone);
      // on_death enqueued directly: the source is already in the discard, so
      // the live-source scan cannot see it (docs/MECHANICS-V2.md §2Б).
      const card = ctx.catalog.getCard(inst.cardId);
      const abilityIndex = card?.abilities?.findIndex(
        (a) => a.kind === 'passive' && a.trigger === 'on_death',
      ) ?? -1;
      const deathPayload = {
        instanceId: id,
        cardId: inst.cardId,
        player: inst.controller,
        killerInstanceId: draft.lastHits[id] ?? undefined,
        cost: ctx.catalog.getCard(inst.cardId)?.cost ?? 0,
        zone: prevZone,
      };
      if (card && abilityIndex >= 0) {
        ctx.frame.queue.push({
          player: inst.controller,
          instanceId: id,
          cardId: inst.cardId,
          abilityIndex,
          trigger: 'on_death',
          payload: deathPayload,
        });
      }
      // Реакции живых источников на чужую смерть (docs §H10): Обжор,
      // Берсеркорова — их условия (if_payload_*) гейтят срабатывание.
      enqueueTrigger(draft, ctx, 'on_death', deathPayload);
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
        dropAttached(draft, id);
        instance(draft, id).location = 'removed';
        zone[slot] = null;
      }
    }
  }
  if (p.companion) {
    dropAttached(draft, p.companion);
    instance(draft, p.companion).location = 'removed';
    p.companion = null;
  }
  emit(ctx, { type: 'player_eliminated', player: playerId });
}

/** Attached cards are already out of the game; detach the list from the host. */
function dropAttached(draft: Draft<MatchState>, hostId: string): void {
  delete draft.instances[hostId]?.attached;
}

/** Standard post-effect batch: deaths, elimination/win check, trigger drain. */
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
      drainTriggers(draft, ctx);
      return;
    }
    drainTriggers(draft, ctx);
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
  if (justEliminated.length === 0) {
    drainTriggers(draft, ctx);
    return;
  }
  const alive = draft.order.filter((pid) => !draft.players[pid]!.eliminated);
  if (alive.length <= 1) {
    finishMatch(draft, ctx, alive, 'elimination');
  }
  drainTriggers(draft, ctx);
}
