import { instance } from '../util';
import type { Ctx } from '../util';
import type { CardData, MatchState } from '../types';
import { opponentsOf, opponentZoneFor } from '../zones';
import { resolveTarget, type ResolvedTarget } from './resolve';
import type { EffectSource } from './source';
import type {
  AbilitySpec,
  ConditionSpec,
  EffectSpec,
  StatAmount,
  StatKey,
  TargetFilter,
} from './types';

export interface AuraContribution {
  stat: StatKey;
  amount: number;
  /** Defense floor applied by this aura (Угнетающая пирамида: DEF не ниже 1). */
  floorDefense?: number;
}

/**
 * Aura scan (docs/MECHANICS-V2.md §2А): every in-play card + hero whose
 * modifier passive (no trigger, stat_buff aura) currently covers the queried
 * instance. Computed at the point of use — replacements, deaths and condition
 * changes apply immediately, nothing is persisted. Conditions on the aura
 * target (Мельница процветания) are checked per candidate.
 */
export function auraContributions(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  forInstanceId: string,
): AuraContribution[] {
  const out: AuraContribution[] = [];
  forSource(draft, ctx, (source, ability) => {
    if (ability.kind !== 'passive' || ability.trigger !== undefined) return;
    const effect = ability.effect;
    if (!effect || effect.op !== 'stat_buff' || effect.duration !== 'aura') return;
    if (!conditionsHold(draft, ctx, source, ability.conditions, undefined)) return;
    const targets = resolveTarget(draft, ctx, effect.target, source, undefined);
    for (const target of targets) {
      if (target.kind !== 'creature' || target.instanceId !== forInstanceId) continue;
      if (effect.filter && !targetMatchesFilter(draft, ctx, source, target.instanceId, effect.filter)) continue;
      if (!conditionsHold(draft, ctx, source, ability.conditions, target.instanceId)) continue;
      out.push({
        stat: effect.stat,
        amount: resolveStatAmount(draft, ctx, source, effect.amount),
        floorDefense: effect.floorDefense,
      });
    }
  });
  return out;
}

/** Run `fn` for every ability of every live source (field instances + heroes). */
export function forSource(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  fn: (source: EffectSource, ability: AbilitySpec, abilityIndex: number) => void,
): void {
  for (const pid of draft.order) {
    const p = draft.players[pid]!;
    for (const zone of p.zones) {
      for (const id of [zone.creature, zone.building]) {
        if (!id) continue;
        const inst = instance(draft, id);
        const card = ctx.catalog.getCard(inst.cardId);
        if (!card?.abilities) continue;
        const source: EffectSource = { player: pid, instanceId: id };
        card.abilities.forEach((ability, abilityIndex) => fn(source, ability, abilityIndex));
      }
    }
    if (p.companion) {
      const inst = instance(draft, p.companion);
      const card = ctx.catalog.getCard(inst.cardId);
      if (card?.abilities) {
        const source: EffectSource = { player: pid, instanceId: p.companion };
        card.abilities.forEach((ability, abilityIndex) => fn(source, ability, abilityIndex));
      }
    }
    const hero = ctx.catalog.getHero(p.heroId);
    if (hero?.ability) {
      fn({ player: pid, instanceId: null }, hero.ability, 0);
    }
  }
}

/** `if_*`/`while_*` conditions; board scopes read the context instance. */
export function conditionsHold(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  source: EffectSource,
  conditions: ConditionSpec[] | undefined,
  targetInstanceId: string | undefined,
): boolean {
  if (!conditions) return true;
  const p = draft.players[source.player]!;
  for (const cond of conditions) {
    switch (cond.kind) {
      case 'if_discard_count':
      case 'while_discard_count':
        if (p.discard.length < cond.min) return false;
        break;
      case 'while_undamaged': {
        const id = cond.scope === 'self' ? source.instanceId : targetInstanceId;
        if (!id || instance(draft, id).damage !== 0) return false;
        break;
      }
      case 'while_damage_exactly': {
        const id = cond.scope === 'self' ? source.instanceId : targetInstanceId;
        if (!id || instance(draft, id).damage !== cond.amount) return false;
        break;
      }
      case 'while_damage_at_least': {
        const id = cond.scope === 'self' ? source.instanceId : targetInstanceId;
        if (!id || instance(draft, id).damage < cond.amount) return false;
        break;
      }
      case 'while_lane_empty_opponent': {
        const src = source.instanceId ? instance(draft, source.instanceId) : null;
        if (!src || src.zone === null) return false;
        const opposite = opponentZoneFor(draft, source.player, src.zone);
        if (opposite && draft.players[opposite.player]!.zones[opposite.zone]?.creature) return false;
        break;
      }
      case 'while_on_land_type': {
        const src = source.instanceId ? instance(draft, source.instanceId) : null;
        if (!src || src.zone === null) return false;
        if (p.lands[src.zone]!.type !== cond.landType) return false;
        break;
      }
      case 'while_distinct_lands': {
        const distinct = distinctLandTypes(p.lands.map((l) => l.type));
        if (cond.min !== undefined && distinct < cond.min) return false;
        if (cond.max !== undefined && distinct > cond.max) return false;
        break;
      }
      case 'while_self_flipped': {
        const src = source.instanceId ? instance(draft, source.instanceId) : null;
        if (!src || !src.flipped) return false;
        break;
      }
      case 'while_opponents_hand_empty': {
        const anyCards = opponentsOf(draft, source.player).some(
          (pid) => draft.players[pid]!.hand.length > 0,
        );
        if (anyCards) return false;
        break;
      }
      case 'while_no_other_creatures': {
        for (const pid of draft.order) {
          for (const zone of draft.players[pid]!.zones) {
            if (zone.creature && zone.creature !== source.instanceId) return false;
          }
        }
        break;
      }
      case 'while_empty_lands': {
        const empty = p.zones.filter((z) => !z.creature).length;
        if (empty < cond.min) return false;
        break;
      }
      case 'while_on_flipped_land': {
        const id = cond.scope === 'self' ? source.instanceId : targetInstanceId;
        if (!id) return false;
        const inst = instance(draft, id);
        if (inst.zone === null) return false;
        if (!draft.players[inst.controller]!.lands[inst.zone]!.flipped) return false;
        break;
      }
      case 'while_land_count': {
        const count = p.lands.filter((l) => l.type === cond.landType).length;
        if (cond.min !== undefined && count < cond.min) return false;
        if (cond.max !== undefined && count > cond.max) return false;
        break;
      }
      case 'while_zone_has_building': {
        const src = source.instanceId ? instance(draft, source.instanceId) : null;
        if (!src || src.zone === null) return false;
        if (!p.zones[src.zone]!.building) return false;
        break;
      }
    }
  }
  return true;
}

function distinctLandTypes(types: string[]): number {
  return new Set(types).size;
}

/** Resolve a stat amount: flat, per-discard, per-damage, per-lands, per-target. */
export function resolveStatAmount(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  source: EffectSource,
  amount: StatAmount,
): number {
  if (typeof amount === 'number') return amount;
  const p = draft.players[source.player]!;
  switch (amount.kind) {
    case 'per_discard':
      return Math.floor(p.discard.length / amount.every) * amount.amount;
    case 'per_damage': {
      if (!source.instanceId) return 0;
      return instance(draft, source.instanceId).damage * amount.amount;
    }
    case 'per_distinct_lands':
      return distinctLandTypes(p.lands.map((l) => l.type)) * amount.amount;
    case 'per_lands': {
      let count = 0;
      const src = source.instanceId ? instance(draft, source.instanceId) : null;
      const ownZoneCount = src ? draft.players[source.player]!.zones.length : 0;
      for (const pid of amount.where === 'own' ? [source.player] : draft.order) {
        const other = draft.players[pid]!;
        other.lands.forEach((land, zone) => {
          if (amount.where === 'adjacent') {
            if (!src || src.zone === null) return;
            if (other.zones.length !== ownZoneCount) return;
            if (Math.abs(zone - src.zone) !== 1) return;
          }
          if (amount.landType && land.type !== amount.landType) return;
          if (amount.flipped && !land.flipped) return;
          if (amount.empty && other.zones[zone]?.creature) return;
          count += 1;
        });
      }
      return count * amount.amount;
    }
    case 'per_target': {
      const targets = resolveTarget(draft, ctx, amount.target, source, undefined);
      let count = 0;
      for (const target of targets) {
        if (target.kind !== 'creature' && target.kind !== 'building') continue;
        if (amount.excludeSelf && target.instanceId === source.instanceId) continue;
        if (amount.filter && !targetMatchesFilter(draft, ctx, source, target.instanceId, amount.filter)) continue;
        count += 1;
      }
      return count * amount.amount;
    }
  }
}

function targetMatchesFilter(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  source: EffectSource,
  instanceId: string,
  filter: TargetFilter,
): boolean {
  const inst = instance(draft, instanceId);
  if (filter.ready && inst.flipped) return false;
  const card: CardData | undefined = ctx.catalog.getCard(inst.cardId);
  if (!card) return false;
  if (filter.landType && card.landType !== filter.landType) return false;
  if (filter.sameCard) {
    const ownCardId = source.instanceId ? instance(draft, source.instanceId).cardId : undefined;
    if (card.id !== ownCardId) return false;
  }
  if (filter.cardIds && !filter.cardIds.includes(card.id)) return false;
  return true;
}

/**
 * Cost modifier for playing `card` (docs/MECHANICS-V2.md §3 cost_mod). A
 * self-referencing discount (Остролист, Домик) is printed on the card being
 * played, so its own hand instance is the source — board copies of the same
 * card do not stack.
 */
export function playedCardCostModifier(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  playerId: string,
  card: CardData,
  handInstanceId: string,
): number {
  let total = 0;
  const source: EffectSource = { player: playerId, instanceId: handInstanceId };
  for (const ability of card.abilities ?? []) {
    if (ability.kind !== 'passive' || ability.trigger !== undefined) continue;
    const effect: EffectSpec | undefined = ability.effect;
    if (!effect || effect.op !== 'cost_mod' || !conditionsHold(draft, ctx, source, ability.conditions, undefined)) continue;
    total += resolveStatAmount(draft, ctx, source, effect.amount);
  }
  return total;
}

/** Sum of «считается за дополнительную землю» contributions for a land type. */
export function landCountModifier(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  playerId: string,
  landType: string,
): number {
  let total = 0;
  forSource(draft, ctx, (source, ability) => {
    if (source.player !== playerId || ability.kind !== 'passive' || ability.trigger !== undefined) return;
    const effect: EffectSpec | undefined = ability.effect;
    if (!effect || effect.op !== 'land_count_mod' || !conditionsHold(draft, ctx, source, ability.conditions, undefined)) return;
    if (effect.landType && effect.landType !== landType) return;
    total += effect.amount;
  });
  return total;
}

export type { ResolvedTarget };
