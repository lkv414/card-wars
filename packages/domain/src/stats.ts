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
  for (const buff of draft.turnBuffs) {
    if (buff.instanceId !== instanceId) continue;
    if (buff.stat === 'attack') attack += buff.amount;
    else defense += buff.amount;
  }
  let defenseFloor: number | undefined;
  for (const contribution of auraContributions(draft, ctx, instanceId)) {
    if (contribution.stat === 'attack') attack += contribution.amount;
    else defense += contribution.amount;
    if (contribution.floorDefense !== undefined) {
      defenseFloor = Math.max(defenseFloor ?? 0, contribution.floorDefense);
    }
  }
  if (defenseFloor !== undefined) defense = Math.max(defense, defenseFloor);
  return { attack, defense };
}
