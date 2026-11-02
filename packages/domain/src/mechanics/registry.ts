import type { Draft } from 'immer';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import type { MatchState } from '../types';
import { chainDamage, moveDamage, swapLanes } from './handlers';
import type { EffectSource } from './source';
export type { EffectSource };
import type { TargetChoice } from './types';

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
) => void;

export const MECHANICS: Record<string, MechanicHandler> = {
  chain_damage: chainDamage,
  move_damage: moveDamage,
  swap_lanes: swapLanes,
};

export function runMechanic(
  draft: Draft<MatchState>,
  ctx: Ctx,
  name: string,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void {
  const handler = MECHANICS[name];
  if (!handler) throw new DomainError('mechanic_unknown', `unknown mechanic "${name}"`);
  handler(draft, ctx, source, params, choices);
}
