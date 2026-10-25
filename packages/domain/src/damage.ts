import type { Draft } from 'immer';
import { DomainError } from './errors';
import type { Ctx } from './util';
import { emit, instance, player } from './util';
import type { CardInstance, MatchState, PlayerId } from './types';

/** Damage to a creature: shield absorbs first (docs/RULES.md «Бой», «Щит»). Death is checked later in batch. */
export function dealToCreature(
  draft: Draft<MatchState>,
  ctx: Ctx,
  targetId: string,
  amount: number,
  sourceInstanceId: string | null,
  pierce = false,
): void {
  if (amount <= 0) return;
  const inst = instance(draft, targetId);
  const absorbed = pierce ? 0 : Math.min(inst.shield, amount);
  inst.shield -= absorbed;
  const rest = amount - absorbed;
  inst.damage += rest;
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

/** Damage to a player's lives. Players have no shield. */
export function dealToPlayer(
  draft: Draft<MatchState>,
  ctx: Ctx,
  targetId: PlayerId,
  amount: number,
  sourceInstanceId: string | null,
): void {
  if (amount <= 0) return;
  const p = player(draft, targetId);
  p.lives -= amount;
  emit(ctx, {
    type: 'damage_dealt',
    sourceInstanceId,
    targetInstanceId: null,
    targetPlayer: targetId,
    amount,
    absorbedByShield: 0,
    toTarget: amount,
  });
  emit(ctx, { type: 'lives_changed', player: targetId, delta: -amount, lives: p.lives });
}

/** Remove a card from its zone slot and put it into the discard pile. */
export function killInstance(draft: Draft<MatchState>, ctx: Ctx, targetId: string): CardInstance {
  const inst = instance(draft, targetId);
  if (inst.location !== 'field' && inst.location !== 'companion') {
    throw new DomainError('card_not_in_play', `instance ${targetId} is not in play`);
  }
  if (inst.zone !== null && inst.slot) {
    const owner = draft.players[inst.controller]!;
    const zone = owner.zones[inst.zone]!;
    if (zone[inst.slot] === targetId) zone[inst.slot] = null;
  }
  if (inst.location === 'companion') {
    draft.players[inst.controller]!.companion = null;
  }
  inst.location = 'discard';
  inst.zone = null;
  inst.slot = null;
  draft.players[inst.controller]!.discard.push(targetId);
  return inst;
}
