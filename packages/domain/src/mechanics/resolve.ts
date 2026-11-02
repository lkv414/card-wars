import { DomainError } from '../errors';
import { instance, player } from '../util';
import type { Ctx } from '../util';
import type { MatchState, PlayerId } from '../types';
import { opponentsOf, opponentZoneFor } from '../zones';
import type { EffectSource } from './source';
import type { TargetAsk, TargetChoice, TargetRef } from './types';

/** Concrete target after resolution. */
export type ResolvedTarget =
  | { kind: 'creature'; instanceId: string }
  | { kind: 'building'; instanceId: string }
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'land'; playerId: PlayerId; zone: number };

function isOpponent(draft: MatchState, sourcePlayer: PlayerId, other: PlayerId): boolean {
  return opponentsOf(draft, sourcePlayer).includes(other);
}

/**
 * Validate the player's choices against the ability's declared asks, in order.
 * Atomic: throws before anything is applied (docs/MECHANICS-V2.md §5).
 */
export function validateChoices(
  draft: MatchState,
  source: EffectSource,
  asks: TargetAsk[] | undefined,
  choices: TargetChoice[] | undefined,
): void {
  const need = asks?.length ?? 0;
  const have = choices?.length ?? 0;
  if (need !== have) {
    throw new DomainError('target_required', `ability needs ${need} targets, got ${have}`);
  }
  if (!asks) return;
  asks.forEach((ask, i) => {
    const choice = choices![i]!;
    if (!choiceMatchesAsk(draft, source, ask, choice)) {
      throw new DomainError('invalid_choice', `target ${i + 1} does not match ask ${ask.kind}`);
    }
  });
}

function choiceMatchesAsk(
  draft: MatchState,
  source: EffectSource,
  ask: TargetAsk,
  choice: TargetChoice,
): boolean {
  switch (ask.kind) {
    case 'own_creature':
      return (
        choice.kind === 'creature' &&
        isFieldCreature(draft, choice.instanceId) &&
        instance(draft, choice.instanceId).controller === source.player
      );
    case 'opponent_creature':
      return (
        choice.kind === 'creature' &&
        isFieldCreature(draft, choice.instanceId) &&
        isOpponent(draft, source.player, instance(draft, choice.instanceId).controller)
      );
    case 'any_creature':
      return choice.kind === 'creature' && isFieldCreature(draft, choice.instanceId);
    case 'opponent_player':
      return choice.kind === 'player' && isOpponent(draft, source.player, choice.playerId);
    case 'landscape': {
      if (choice.kind !== 'landscape') return false;
      const p = draft.players[choice.player];
      return Boolean(p && choice.zone >= 0 && choice.zone < p.lands.length);
    }
    case 'own_hand_card': {
      if (choice.kind !== 'card') return false;
      const inst = instance(draft, choice.instanceId);
      return inst.location === 'hand' && inst.controller === source.player;
    }
  }
}

function isFieldCreature(draft: MatchState, instanceId: string): boolean {
  const inst = instance(draft, instanceId);
  return inst.location === 'field' && inst.slot === 'creature';
}

/**
 * Resolve effect target refs to concrete targets. `choice` refs index into the
 * validated choices; static refs are computed from the board. Static resolution
 * returns what exists right now — replacements and deaths apply naturally.
 */
export function resolveTargets(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  refs: TargetRef[],
  source: EffectSource,
  choices: TargetChoice[] | undefined,
): ResolvedTarget[] {
  const out: ResolvedTarget[] = [];
  for (const ref of refs) {
    out.push(...resolveTarget(draft, ctx, ref, source, choices));
  }
  return out;
}

/** Resolve a single ref; convenience wrapper for single-target effects. */
export function resolveTarget(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  ref: TargetRef,
  source: EffectSource,
  choices: TargetChoice[] | undefined,
): ResolvedTarget[] {
  const src = source.instanceId ? instance(draft, source.instanceId) : null;
  const srcZone = src?.zone ?? null;
  const choice = ref.kind === 'choice' ? choices?.[ref.index] : undefined;

  switch (ref.kind) {
    case 'choice': {
      if (ref.index < 0 || ref.index >= (choices?.length ?? 0)) {
        throw new DomainError('target_required', `missing choice #${ref.index}`);
      }
      switch (choice!.kind) {
        case 'creature':
          return [{ kind: 'creature', instanceId: choice!.instanceId }];
        case 'player':
          return [{ kind: 'player', playerId: choice!.playerId }];
        case 'landscape':
          return [{ kind: 'land', playerId: choice!.player, zone: choice!.zone }];
        case 'card':
          throw new DomainError('invalid_choice', 'hand card choice is not an effect target');
      }
      return [];
    }
    case 'this_creature':
      return src && src.location === 'field' && src.slot === 'creature'
        ? [{ kind: 'creature', instanceId: source.instanceId! }]
        : [];
    case 'this_lane_creature': {
      if (srcZone === null) return [];
      const id = player(draft, source.player).zones[srcZone]?.creature;
      return id ? [{ kind: 'creature', instanceId: id }] : [];
    }
    case 'this_lane_opponent_creature': {
      if (srcZone === null) return [];
      const target = opponentZoneFor(draft, source.player, srcZone);
      if (!target) return [];
      const id = player(draft, target.player).zones[target.zone]?.creature;
      return id ? [{ kind: 'creature', instanceId: id }] : [];
    }
    case 'adjacent_creatures': {
      if (srcZone === null) return [];
      const zones = player(draft, source.player).zones;
      const out: ResolvedTarget[] = [];
      for (const z of [srcZone - 1, srcZone + 1]) {
        if (z < 0 || z >= zones.length) continue;
        const id = zones[z]?.creature;
        if (id) out.push({ kind: 'creature', instanceId: id });
      }
      return out;
    }
    case 'each_creature_yours':
      return creaturesOf(draft, source.player);
    case 'each_creature_opponent':
      return opponentsOf(draft, source.player).flatMap((pid) => creaturesOf(draft, pid));
    case 'each_creature':
      return draft.order.flatMap((pid) => creaturesOf(draft, pid));
    case 'each_building_yours':
      return buildingsOf(draft, source.player);
    case 'self_player':
      return [{ kind: 'player', playerId: source.player }];
  }
}

function creaturesOf(draft: MatchState, playerId: PlayerId): ResolvedTarget[] {
  return player(draft, playerId)
    .zones.map((z) => z.creature)
    .filter((id): id is string => id !== null)
    .map((id) => ({ kind: 'creature' as const, instanceId: id }));
}

function buildingsOf(draft: MatchState, playerId: PlayerId): ResolvedTarget[] {
  return player(draft, playerId)
    .zones.map((z) => z.building)
    .filter((id): id is string => id !== null)
    .map((id) => ({ kind: 'building' as const, instanceId: id }));
}
