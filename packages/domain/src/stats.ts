import { cardOf, instance } from './util';
import type { Ctx } from './util';
import type { MatchState } from './types';
import { auraContributions } from './mechanics/modifiers';

/**
 * Effective attack/defense of a creature: base stats, permanent bonuses and
 * live aura contributions (docs/MECHANICS-V2.md §2А). Recomputed on every
 * query, so replacements, deaths and condition changes apply immediately.
 * Defense floors from auras (Угнетающая пирамида) clamp the final defense.
 * This is the single stat projection used by combat, deaths and views.
 */
export function computeEff(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  instanceId: string,
): { attack: number; defense: number } {
  const inst = instance(draft, instanceId);
  const card = cardOf(ctx, inst);
  let attack = (card.attack ?? 0) + inst.bonusAttack;
  let defense = (card.defense ?? 0) + inst.bonusDefense;
  let attackFloor: number | undefined;
  for (const buff of draft.turnBuffs) {
    if (buff.instanceId !== instanceId) continue;
    if (buff.stat === 'attack') {
      attack += buff.amount;
      if (buff.floorAttack !== undefined) attackFloor = Math.max(attackFloor ?? -Infinity, buff.floorAttack);
    } else defense += buff.amount;
  }
  let defenseFloor: number | undefined;
  let attackMultiplier = 1;
  let defenseMultiplier = 1;
  for (const contribution of auraContributions(draft, ctx, instanceId)) {
    if (contribution.stat === 'attack') {
      attack += contribution.amount;
      if (contribution.floorAttack !== undefined) attackFloor = Math.max(attackFloor ?? -Infinity, contribution.floorAttack);
      attackMultiplier *= contribution.multiplier ?? 1;
    } else {
      defense += contribution.amount;
      defenseMultiplier *= contribution.multiplier ?? 1;
    }
    if (contribution.floorDefense !== undefined) {
      defenseFloor = Math.max(defenseFloor ?? 0, contribution.floorDefense);
    }
  }
  attack *= attackMultiplier;
  defense *= defenseMultiplier;
  if (attackFloor !== undefined) attack = Math.max(attack, attackFloor);
  if (defenseFloor !== undefined) defense = Math.max(defense, defenseFloor);
  return { attack, defense };
}
