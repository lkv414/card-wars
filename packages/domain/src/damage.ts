import type { Draft } from 'immer';
import { DomainError } from './errors';
import type { Ctx } from './util';
import { clearZoneSlot, emit, instance, player } from './util';
import type { CardInstance, MatchState, PlayerId } from './types';
import { teamOf } from './zones';
import { damageCapFor, damageImmunity, damageRedirectTarget, spellDamageBonusFor } from './mechanics/modifiers';

/** Lives live on the team in 2v2; both allies mirror the shared value (docs/RULES.md). */
function currentLives(draft: Draft<MatchState>, playerId: PlayerId): number {
  const team = teamOf(draft, playerId);
  return team ? team.lives : player(draft, playerId).lives;
}

function setLives(draft: Draft<MatchState>, playerId: PlayerId, lives: number): void {
  const team = teamOf(draft, playerId);
  if (team) {
    team.lives = lives;
    for (const pid of team.playerIds) draft.players[pid]!.lives = lives;
  } else {
    player(draft, playerId).lives = lives;
  }
}

/** Heal a player/team up to their max; returns the amount actually restored. */
export function healPlayer(
  draft: Draft<MatchState>,
  ctx: Ctx,
  targetId: PlayerId,
  amount: number,
): number {
  if (amount <= 0) return 0;
  const team = teamOf(draft, targetId);
  const max = team ? team.maxLives : player(draft, targetId).maxLives;
  const current = team ? team.lives : player(draft, targetId).lives;
  const healed = Math.min(amount, max - current);
  if (healed <= 0) return 0;
  setLives(draft, targetId, current + healed);
  emit(ctx, { type: 'lives_changed', player: targetId, delta: healed, lives: current + healed });
  return healed;
}

/**
 * Damage to a creature: redirects and immunity scanned live (docs/MECHANICS-V2.md
 * §2А), then shield absorbs first (docs/RULES.md «Бой», «Щит»). Death is checked
 * later in batch. `fromAttack` gates attack-only immunities.
 */
export function dealToCreature(
  draft: Draft<MatchState>,
  ctx: Ctx,
  targetId: string,
  amount: number,
  sourceInstanceId: string | null,
  pierce = false,
  fromAttack = false,
  depth = 0,
): void {
  if (amount <= 0) return;
  if (depth < 3) {
    const redirect = damageRedirectTarget(draft, ctx, targetId);
    if (redirect && redirect !== targetId) {
      dealToCreature(draft, ctx, redirect, amount, sourceInstanceId, pierce, fromAttack, depth + 1);
      return;
    }
  }
  const inst = instance(draft, targetId);
  const immune = damageImmunity(draft, ctx, targetId, fromAttack);
  let effective = Math.max(0, amount - immune);
  // Модификаторы получаемого урона (Подушка боли, docs §H16): кап за удары
  // существ, прибавка от заклинаний.
  const bySpell = sourceInstanceId !== null &&
    ctx.catalog.getCard(draft.instances[sourceInstanceId]?.cardId ?? '')?.type === 'spell';
  if (bySpell) effective += spellDamageBonusFor(draft, ctx, targetId, true);
  const cap = damageCapFor(draft, ctx, targetId, fromAttack && !bySpell);
  if (cap !== undefined && effective > cap) effective = cap;
  const absorbed = pierce ? 0 : Math.min(inst.shield, effective);
  inst.shield -= absorbed;
  const rest = effective - absorbed;
  inst.damage += rest;
  draft.lastHits[targetId] = sourceInstanceId;
  emit(ctx, {
    type: 'damage_dealt',
    sourceInstanceId,
    targetInstanceId: targetId,
    targetPlayer: null,
    amount,
    absorbedByShield: absorbed,
    toTarget: rest,
  });
}

/** Damage to a player's lives (shared team lives in 2v2). Players have no shield. */
export function dealToPlayer(
  draft: Draft<MatchState>,
  ctx: Ctx,
  targetId: PlayerId,
  amount: number,
  sourceInstanceId: string | null,
): void {
  if (amount <= 0) return;
  player(draft, targetId);
  const lives = currentLives(draft, targetId) - amount;
  setLives(draft, targetId, lives);
  emit(ctx, {
    type: 'damage_dealt',
    sourceInstanceId,
    targetInstanceId: null,
    targetPlayer: targetId,
    amount,
    absorbedByShield: 0,
    toTarget: amount,
  });
  emit(ctx, { type: 'lives_changed', player: targetId, delta: -amount, lives });
}

/** Remove a card from its zone slot and put it into the discard pile. */
export function killInstance(draft: Draft<MatchState>, _ctx: Ctx, targetId: string): CardInstance {
  const inst = instance(draft, targetId);
  if (inst.location !== 'field' && inst.location !== 'companion') {
    throw new DomainError('card_not_in_play', `instance ${targetId} is not in play`);
  }
  if (inst.zone !== null && inst.slot) {
    const owner = draft.players[inst.controller]!;
    clearZoneSlot(owner.zones[inst.zone]!, inst.slot, targetId);
  }
  if (inst.location === 'companion') {
    draft.players[inst.controller]!.companion = null;
  }
  inst.location = 'discard';
  inst.zone = null;
  inst.slot = null;
  draft.players[inst.controller]!.discard.push(targetId);
  // Attached cards follow their host into the discard pile (docs §H2 attach_card).
  for (const attachedId of inst.attached ?? []) {
    const attached = draft.instances[attachedId];
    if (!attached || attached.location !== 'removed') continue;
    attached.location = 'discard';
    draft.players[attached.controller]!.discard.push(attachedId);
  }
  delete inst.attached;
  return inst;
}
