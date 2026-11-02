import type { Draft } from 'immer';
import { dealToCreature } from '../damage';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import { emit, instance, player } from '../util';
import type { MatchState } from '../types';
import { resolveTarget } from './resolve';
import type { EffectSource, MechanicHandler } from './registry';
import type { TargetChoice } from './types';

/** Убей-молния: damage chain[0], chain[1], … across opponent creatures in order. */
export const chainDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  _choices: TargetChoice[] | undefined,
): void => {
  const chain = (params?.chain as number[] | undefined) ?? [];
  const targets = resolveTarget(draft, ctx, { kind: 'each_creature_opponent' }, source, undefined);
  chain.forEach((amount, i) => {
    const target = targets[i];
    if (!target || target.kind !== 'creature') return;
    dealToCreature(draft, ctx, target.instanceId, amount, source.instanceId);
  });
};

/** Отрази угрозу: move up to `max` damage from a chosen own creature to a lane opponent. */
export const moveDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const max = (params?.max as number | undefined) ?? 3;
  const from = choices?.[0];
  const to = choices?.[1];
  if (!from || from.kind !== 'creature' || !to || to.kind !== 'creature') {
    throw new DomainError('invalid_choice', 'move_damage needs two creature choices');
  }
  const src = instance(draft, from.instanceId);
  const moved = Math.min(max, src.damage);
  if (moved <= 0) return;
  src.damage -= moved;
  const dst = instance(draft, to.instanceId);
  dst.damage += moved;
  emit(ctx, {
    type: 'damage_dealt',
    sourceInstanceId: null,
    targetInstanceId: to.instanceId,
    targetPlayer: null,
    amount: moved,
    absorbedByShield: 0,
    toTarget: moved,
  });
};

/** Скелет гастролер: swap the zones of two own field creatures. */
export const swapLanes: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const a = choices?.[0];
  const b = choices?.[1];
  if (!a || a.kind !== 'creature' || !b || b.kind !== 'creature') {
    throw new DomainError('invalid_choice', 'swap_lanes needs two creature choices');
  }
  const instA = instance(draft, a.instanceId);
  const instB = instance(draft, b.instanceId);
  if (instA.controller !== source.player || instB.controller !== source.player) {
    throw new DomainError('invalid_choice', 'swap_lanes needs own creatures');
  }
  if (instA.zone === null || instB.zone === null) return;
  const zones = player(draft, source.player).zones;
  const zoneA = instA.zone;
  const zoneB = instB.zone;
  zones[zoneA]!.creature = b.instanceId;
  zones[zoneB]!.creature = a.instanceId;
  instA.zone = zoneB;
  instB.zone = zoneA;
  emit(ctx, { type: 'card_moved', player: source.player, instanceId: a.instanceId, fromZone: zoneA, toZone: zoneB });
  emit(ctx, { type: 'card_moved', player: source.player, instanceId: b.instanceId, fromZone: zoneB, toZone: zoneA });
};
