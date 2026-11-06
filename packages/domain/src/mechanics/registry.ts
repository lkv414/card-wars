import type { Draft } from 'immer';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import type { MatchState } from '../types';
import { chainDamage, copySpell, damageUntilDef, halfDefDamage, minMaxDefDamage, sacrificeCostDamage, destroyDrawCost, discardThenDamage, discardTopDamage, grantRandomDiscardActive, damagePerHand, laneOrFaceDamage, millSpellDiscard, moveDamage, returnCostActions, splashDamage, swapCreatures, swapLanes, tokenBonusDamage } from './handlers';
import { catLives, discardMinCostOrDamage, enterMoveToEmpty, selfDamageThenDestroy, startTurnMoveOrDiscard, stealAndPlayFromHand } from './handlers-h3';
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
  lane_or_face_damage: laneOrFaceDamage,
  swap_creatures: swapCreatures,
  damage_until_def: damageUntilDef,
  splash_damage: splashDamage,
  damage_per_hand: damagePerHand,
  half_def_damage: halfDefDamage,
  min_max_def_damage: minMaxDefDamage,
  sacrifice_cost_damage: sacrificeCostDamage,
  start_turn_move_or_discard: startTurnMoveOrDiscard,
  enter_move_to_empty: enterMoveToEmpty,
  self_damage_then_destroy: selfDamageThenDestroy,
  steal_and_play_from_hand: stealAndPlayFromHand,
  discard_min_cost_or_damage: discardMinCostOrDamage,
  cat_lives: catLives,
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
