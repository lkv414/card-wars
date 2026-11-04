import { DomainError } from '../errors';
import type { Ctx } from '../util';
import { instance } from '../util';
import type { Draft } from 'immer';
import type { AdditionalCost } from './types';
import type { MatchState, PlayerId } from '../types';
import type { TargetChoice } from './types';

/** Number of player picks the additional cost requires (before declared targets). */
export function costPicksCount(cost: AdditionalCost | undefined): number {
  if (!cost) return 0;
  return (cost.discardFromHand ?? 0) + (cost.destroyOwnCreature ?? 0) + (cost.destroyOwnBuilding ?? 0) + (cost.floopOwnCreature ?? 0) + (cost.discardFromHandName ? 1 : 0);
}

/** Validate and collect the discard part of the additional cost. */
export function costPicks(
  targets: TargetChoice[],
  pickCount: number,
  playerId: PlayerId,
  draft: MatchState,
  ctx?: Pick<Ctx, 'catalog'>,
  cost?: AdditionalCost,
): string[] {
  const picks: string[] = [];
  const nameFilter = cost?.discardFromHandName;
  for (const pick of targets.slice(0, pickCount)) {
    if (pick.kind !== 'card') {
      throw new DomainError('invalid_choice', 'additional cost needs a card from your hand');
    }
    const inst = instance(draft, pick.instanceId);
    if (inst.location !== 'hand' || inst.controller !== playerId) {
      throw new DomainError('invalid_choice', 'additional cost needs a card from your hand');
    }
    if (nameFilter && ctx) {
      const name = ctx.catalog.getCard(inst.cardId)?.name ?? '';
      if (!name.toLowerCase().includes(nameFilter.toLowerCase())) {
        throw new DomainError('invalid_choice', `additional cost needs a card with «${nameFilter}» in the name`);
      }
    }
    picks.push(pick.instanceId);
  }
  return picks;
}

/** Validate the «примени существо» picks: own READY field creatures. */
export function floopCostPicks(
  targets: TargetChoice[],
  discardCount: number,
  cost: AdditionalCost | undefined,
  draft: MatchState,
  playerId: PlayerId,
): string[] {
  const count = cost?.floopOwnCreature ?? 0;
  if (count === 0) return [];
  const start = discardCount + (cost?.destroyOwnCreature ?? 0) + (cost?.destroyOwnBuilding ?? 0);
  const picks: string[] = [];
  for (const pick of targets.slice(start, start + count)) {
    if (pick.kind !== 'creature') {
      throw new DomainError('invalid_choice', 'floop cost needs an own ready creature');
    }
    const inst = instance(draft, pick.instanceId);
    if (inst.location !== 'field' || inst.controller !== playerId || inst.slot !== 'creature' || inst.flipped) {
      throw new DomainError('invalid_choice', 'floop cost needs an own ready creature');
    }
    picks.push(pick.instanceId);
  }
  return picks;
}

/**
 * Validate and apply the sacrifice part of the additional cost: own creatures
 * first, then own buildings ( Док Смерть, Стрелец Дэника). Returns killed ids.
 */
export function sacrificePicks(
  targets: TargetChoice[],
  discardCount: number,
  cost: AdditionalCost | undefined,
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
): string[] {
  if (!cost) return [];
  const creatureCount = cost.destroyOwnCreature ?? 0;
  const buildingCount = cost.destroyOwnBuilding ?? 0;
  const total = creatureCount + buildingCount;
  if (total === 0) return [];

  const killed: string[] = [];
  const pool = targets.slice(discardCount, discardCount + total);
  pool.forEach((pick, i) => {
    if (pick.kind !== 'creature') {
      throw new DomainError('invalid_choice', 'sacrifice cost needs an own field card');
    }
    const inst = instance(draft, pick.instanceId);
    const wantBuilding = i >= creatureCount;
    const isBuilding = inst.slot === 'building';
    if (inst.location !== 'field' || inst.controller !== playerId || isBuilding !== wantBuilding) {
      throw new DomainError('invalid_choice', 'sacrifice cost needs an own field card of the right slot');
    }
    killed.push(pick.instanceId);
  });
  return killed;
}
