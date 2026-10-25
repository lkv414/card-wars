import type { Draft } from 'immer';
import { DomainError } from '../errors';
import { instance, opponentOf, player } from '../util';
import type { Ctx } from '../util';
import type { CommandChoices } from '../commands';
import type { MatchState, PlayerId, TargetSpec } from '../types';

export type TargetRef =
  | { kind: 'creature'; instanceId: string }
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'land'; playerId: PlayerId; zone: number };

export interface EffectSource {
  player: PlayerId;
  instanceId: string | null;
}

function creaturesOf(draft: Draft<MatchState>, playerId: PlayerId): string[] {
  return player(draft, playerId).zones
    .map((z) => z.creature)
    .filter((id): id is string => id !== null);
}

/** Resolve a target spec to concrete refs; throws target_required when a needed choice is missing. */
export function resolveTargets(
  draft: Draft<MatchState>,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  spec: TargetSpec,
  source: EffectSource,
  choices: CommandChoices | undefined,
): TargetRef[] {
  const src = source.instanceId ? instance(draft, source.instanceId) : null;
  const srcZone = src?.zone ?? null;
  const opponent = opponentOf(draft, source.player);

  switch (spec.kind) {
    case 'this_creature':
      return source.instanceId && src?.location === 'field'
        ? [{ kind: 'creature', instanceId: source.instanceId }]
        : [];
    case 'this_lane_creature': {
      if (srcZone === null) return [];
      const id = player(draft, source.player).zones[srcZone]?.creature;
      return id ? [{ kind: 'creature', instanceId: id }] : [];
    }
    case 'this_lane_opponent_creature': {
      if (srcZone === null) return [];
      const mirrored = mirrorZoneIndex(srcZone, player(draft, source.player).zones.length);
      const id = player(draft, opponent).zones[mirrored]?.creature;
      return id ? [{ kind: 'creature', instanceId: id }] : [];
    }
    case 'adjacent_creature': {
      if (srcZone === null) return [];
      const zones = player(draft, source.player).zones;
      const out: TargetRef[] = [];
      for (const z of [srcZone - 1, srcZone + 1]) {
        if (z < 0 || z >= zones.length) continue;
        const id = zones[z]?.creature;
        if (id) out.push({ kind: 'creature', instanceId: id });
      }
      return out;
    }
    case 'each_creature_yours':
      return creaturesOf(draft, source.player).map((id) => ({ kind: 'creature' as const, instanceId: id }));
    case 'each_creature_opponent':
      return creaturesOf(draft, opponent).map((id) => ({ kind: 'creature' as const, instanceId: id }));
    case 'each_creature':
      return draft.order
        .flatMap((pid) => creaturesOf(draft, pid))
        .map((id) => ({ kind: 'creature' as const, instanceId: id }));
    case 'chosen_creature': {
      const id = choices?.creature;
      if (!id) throw new DomainError('target_required', 'chosen_creature requires choices.creature');
      const inst = instance(draft, id);
      if (inst.location !== 'field' || slotIsNotCreature(inst)) {
        throw new DomainError('invalid_choice', `instance ${id} is not a field creature`);
      }
      return [{ kind: 'creature', instanceId: id }];
    }
    case 'chosen_opponent_creature': {
      const id = choices?.creature;
      if (!id) {
        throw new DomainError('target_required', 'chosen_opponent_creature requires choices.creature');
      }
      const inst = instance(draft, id);
      if (inst.location !== 'field' || inst.controller === source.player || slotIsNotCreature(inst)) {
        throw new DomainError('invalid_choice', `instance ${id} is not an opponent field creature`);
      }
      return [{ kind: 'creature', instanceId: id }];
    }
    case 'chosen_opponent': {
      const pid = choices?.opponent;
      if (!pid) throw new DomainError('target_required', 'chosen_opponent requires choices.opponent');
      if (pid === source.player || !draft.players[pid]) {
        throw new DomainError('invalid_choice', `player ${pid} is not an opponent`);
      }
      return [{ kind: 'player', playerId: pid }];
    }
    case 'chosen_landscape': {
      const land = choices?.landscape;
      if (!land) throw new DomainError('target_required', 'chosen_landscape requires choices.landscape');
      const p = draft.players[land.player];
      if (!p || land.zone < 0 || land.zone >= p.lands.length) {
        throw new DomainError('invalid_choice', 'landscape choice out of range');
      }
      return [{ kind: 'land', playerId: land.player, zone: land.zone }];
    }
    case 'self':
      return [{ kind: 'player', playerId: source.player }];
  }
}

function slotIsNotCreature(inst: { slot: string | null }): boolean {
  return inst.slot !== 'creature';
}

/** Mirror pairing (docs/RULES.md «Зоны»): zone i faces zone n-1-i of the opponent. */
export function mirrorZoneIndex(zone: number, zoneCount: number): number {
  return zoneCount - 1 - zone;
}
