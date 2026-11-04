import type { Draft } from 'immer';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import type { MatchState } from '../types';
import { chainDamage, copySpell, destroyDrawCost, discardThenDamage, discardTopDamage, grantRandomDiscardActive, millSpellDiscard, moveDamage, returnCostActions, swapLanes, tokenBonusDamage } from './handlers';
import type { EffectSource } from './source';
export type { EffectSource };
import type { PlayerId, TargetChoice, TriggerPayload } from './types';

/**
 * Named mechanics (docs/MECHANICS-V2.md §3): reusable rule handlers bound from
 * content data. One entry per mechanic — never per card; card names must not
 * appear here. Populated from M6 onward.
 */
export type MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  /** Player answering the ability's pendingChoice when volunteered (2v2), else source.player. */
  beneficiary: PlayerId,
) => void;

export const MECHANICS: Record<string, MechanicHandler> = {
  chain_damage: chainDamage,
  move_damage: moveDamage,
  swap_lanes: swapLanes,
  copy_spell: copySpell,
  grant_random_discard_active: grantRandomDiscardActive,
  token_bonus_damage: tokenBonusDamage,
  discard_top_damage: discardTopDamage,
  return_cost_actions: returnCostActions,
  destroy_draw_cost: destroyDrawCost,
  discard_then_damage: discardThenDamage,
  mill_spell_discard: millSpellDiscard,
};

export function runMechanic(
  draft: Draft<MatchState>,
  ctx: Ctx,
  name: string,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void {
  const handler = MECHANICS[name];
  if (!handler) throw new DomainError('mechanic_unknown', `unknown mechanic "${name}"`);
  handler(draft, ctx, source, params, choices, payload, beneficiary);
}
