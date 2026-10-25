import type { Draft } from 'immer';
import { DomainError } from '../errors';
import { cardOf, emit, instance, player } from '../util';
import type { Ctx } from '../util';
import type { MatchState, StatAmount, StatKey } from '../types';
import { resolveTargets, type EffectSource, type TargetRef } from './targets';
import type { AbilityData } from '../types';

function checkConditions(
  draft: Draft<MatchState>,
  conditions: AbilityData['conditions'],
  ownerPlayerId: string,
): boolean {
  if (!conditions) return true;
  const p = player(draft, ownerPlayerId);
  for (const cond of conditions) {
    if (cond.kind === 'if_discard_count' && p.discard.length < cond.min) return false;
  }
  return true;
}

function resolveStatAmount(
  draft: Draft<MatchState>,
  amount: StatAmount,
  ownerPlayerId: string,
): number {
  if (typeof amount === 'number') return amount;
  const discardCount = player(draft, ownerPlayerId).discard.length;
  return Math.floor(discardCount / amount.perDiscardEvery) * amount.amount;
}

/**
 * Effective attack/defense of a creature: base + permanent bonuses + this-turn
 * buffs + live aura contributions from persistent abilities (recomputed on every
 * query, so replacements and deaths apply naturally).
 */
export function computeEff(
  draft: Draft<MatchState>,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  instanceId: string,
): { attack: number; defense: number } {
  const inst = instance(draft, instanceId);
  const card = cardOf(ctx, inst);
  let attack = card.attack ?? 0;
  let defense = card.defense ?? 0;
  attack += inst.bonusAttack;
  defense += inst.bonusDefense;
  for (const buff of draft.tempBuffs) {
    if (buff.instanceId !== instanceId) continue;
    if (buff.stat === 'attack') attack += buff.amount;
    else defense += buff.amount;
  }
  for (const contribution of auraContributions(draft, ctx, instanceId)) {
    if (contribution.stat === 'attack') attack += contribution.amount;
    else defense += contribution.amount;
  }
  return { attack, defense };
}

/**
 * Aura scan: every in-play card's persistent stat_buff ability whose static
 * target set includes the queried instance. Chosen targets cannot be resolved
 * statically and are skipped (documented v1 limitation).
 */
function auraContributions(
  draft: Draft<MatchState>,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  forInstanceId: string,
): Array<{ stat: StatKey; amount: number }> {
  const out: Array<{ stat: StatKey; amount: number }> = [];
  for (const srcId of Object.keys(draft.instances)) {
    const srcInst = draft.instances[srcId]!;
    if (srcInst.location !== 'field' && srcInst.location !== 'companion') continue;
    const card = ctx.catalog.getCard(srcInst.cardId);
    if (!card) continue;
    for (const ability of card.abilities) {
      if (ability.kind !== 'passive' || ability.trigger !== 'persistent' || !ability.effect) continue;
      const effect = ability.effect;
      if (effect.op !== 'stat_buff') continue;
      if (!checkConditions(draft, ability.conditions, srcInst.controller)) continue;
      let refs: TargetRef[];
      try {
        refs = resolveTargets(draft, ctx, effect.target, { player: srcInst.controller, instanceId: srcId }, undefined);
      } catch (error) {
        if (error instanceof DomainError && error.code === 'target_required') continue;
        throw error;
      }
      const hits = refs.some((ref) => ref.kind === 'creature' && ref.instanceId === forInstanceId);
      if (hits) {
        out.push({
          stat: effect.stat,
          amount: resolveStatAmount(draft, effect.amount, srcInst.controller),
        });
      }
    }
  }
  return out;
}

/** Public wrapper: does the persistent ability currently apply (used by tests). */
export function persistentAbilityApplies(
  draft: Draft<MatchState>,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  sourceInstanceId: string,
  ability: AbilityData,
): boolean {
  const srcInst = instance(draft, sourceInstanceId);
  if (!checkConditions(draft, ability.conditions, srcInst.controller)) return false;
  return true;
}

/** Apply a permanent stat bonus and emit bonus_changed. */
export function grantPermanentBonus(
  draft: Draft<MatchState>,
  ctx: Ctx,
  instanceId: string,
  stat: StatKey,
  amount: number,
): void {
  const inst = instance(draft, instanceId);
  if (stat === 'attack') inst.bonusAttack += amount;
  else inst.bonusDefense += amount;
  emit(ctx, {
    type: 'bonus_changed',
    instanceId,
    cardId: inst.cardId,
    bonusAttack: inst.bonusAttack,
    bonusDefense: inst.bonusDefense,
  });
}

export { checkConditions, resolveStatAmount };
export type { EffectSource };
