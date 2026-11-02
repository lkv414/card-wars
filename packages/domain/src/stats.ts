import { cardOf, instance } from './util';
import type { Ctx } from './util';
import type { MatchState } from './types';

/**
 * Effective attack/defense of a creature: base stats plus permanent bonuses
 * (docs/CARDS.md). Aura and ability machinery returns with the mechanics v2
 * system; this stays the single stat projection used by combat, deaths and views.
 */
export function computeEff(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  instanceId: string,
): { attack: number; defense: number } {
  const inst = instance(draft, instanceId);
  const card = cardOf(ctx, inst);
  return {
    attack: (card.attack ?? 0) + inst.bonusAttack,
    defense: (card.defense ?? 0) + inst.bonusDefense,
  };
}
