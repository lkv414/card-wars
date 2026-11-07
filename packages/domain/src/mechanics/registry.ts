import type { Draft } from 'immer';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import type { MatchState } from '../types';
import { chainDamage, copySpell, damageUntilDef, halfDefDamage, minMaxDefDamage, sacrificeCostDamage, destroyDrawCost, discardThenDamage, discardTopDamage, grantRandomDiscardActive, damagePerHand, laneOrFaceDamage, millSpellDiscard, moveDamage, returnCostActions, splashDamage, swapCreatures, swapLanes, tokenBonusDamage } from './handlers';
import { catLives, discardMinCostOrDamage, enterMoveToEmpty, selfDamageThenDestroy, startTurnMoveOrDiscard, stealAndPlayFromHand } from './handlers-h3';
import { alleyMove, armDamageEcho, armFreePlay, banishAttacker, damageOncePerLand, drawPerZoneEnters, laneStrikeAll, borrowCreature, compareRevealPlayers, damageThenFreezeLand, discardCost0OrRevealHand, discardToReturnSelf, digPlayCompanion, digPlayNamed, drawDiscardRainbowAction, drawToLanePlayers, drawTwoCostMatch, eachDrawCreatureOfType, enterMoveLaneCreature, freezeAndSpreadTokens, grantEarmark, healOnePerIceLand, moveSelfGainActionIfFrozen, peekReorder, readyPerType, resetAndRefill, sacrificeHalfDefDraw, selfRescueOnDeath, splashTargetAllies, destroyLaneAndSameName } from './handlers-h16';
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
  draw_discard_rainbow_action: drawDiscardRainbowAction,
  discard_to_return_self: discardToReturnSelf,
  ready_per_type: readyPerType,
  draw_to_lane_players: drawToLanePlayers,
  heal_one_per_ice_land: healOnePerIceLand,
  damage_then_freeze_land: damageThenFreezeLand,
  move_self_gain_action_if_frozen: moveSelfGainActionIfFrozen,
  enter_move_lane_creature: enterMoveLaneCreature,
  splash_target_allies: splashTargetAllies,
  sacrifice_half_def_draw: sacrificeHalfDefDraw,
  self_rescue_on_death: selfRescueOnDeath,
  each_draw_creature_of_type: eachDrawCreatureOfType,
  arm_free_play: armFreePlay,
  arm_damage_echo: armDamageEcho,
  lane_strike_all: laneStrikeAll,
  damage_once_per_land: damageOncePerLand,
  draw_per_zone_enters: drawPerZoneEnters,
  banish_attacker: banishAttacker,
  discard_cost0_or_reveal_hand: discardCost0OrRevealHand,
  compare_reveal_players: compareRevealPlayers,
  draw_two_cost_match: drawTwoCostMatch,
  peek_reorder: peekReorder,
  freeze_and_spread_tokens: freezeAndSpreadTokens,
  destroy_lane_and_same_name: destroyLaneAndSameName,
  reset_and_refill: resetAndRefill,
  alley_move: alleyMove,
  borrow_creature: borrowCreature,
  grant_earmark: grantEarmark,
  dig_play_named: digPlayNamed,
  dig_play_companion: digPlayCompanion,
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
