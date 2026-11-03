import { instance } from '../util';
import type { Ctx } from '../util';
import type { CardData, MatchState } from '../types';
import { opponentsOf, opponentZoneFor, teammatesOf } from '../zones';
import { resolveTarget, type ResolvedTarget, type TargetRef } from './resolve';
import type { EffectSource } from './source';
import type {
  AbilitySpec,
  ConditionSpec,
  EffectSpec,
  StatAmount,
  StatKey,
  TargetFilter,
  Trigger,
  TriggerPayload,
  CounterScope,
} from './types';

export interface AuraContribution {
  stat: StatKey;
  amount: number;
  /** Defense floor applied by this aura (Угнетающая пирамида: DEF не ниже 1). */
  floorDefense?: number;
  /** Attack floor applied by this aura (Аванпост попугаев: АТК не ниже 0). */
  floorAttack?: number;
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
    if (!effect || Array.isArray(effect) || effect.op !== 'stat_buff' || effect.duration !== 'aura') return;
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
        floorAttack: effect.floorAttack,
      });
    }
  });
  return out;
}

/**
 * Instances whose whole text is suppressed («без текста», suppress `all`):
 * actives, triggers and passive modifiers all stop (Пес, Школа). Recomputed
 * live on every forSource pass — coverage follows moves and flips.
 */
function mutedInstanceIds(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
): Set<string> {
  const out = new Set<string>();
  forSourceRaw(draft, ctx, (source, ability) => {
    if (ability.kind !== 'passive' || ability.trigger !== undefined) return;
    const effect = ability.effect;
    if (!effect || Array.isArray(effect) || effect.op !== 'suppress' || !effect.all) return;
    if (!conditionsHold(draft, ctx, source, ability.conditions, undefined)) return;
    const targets = resolveTarget(draft, ctx, effect.target, source, undefined);
    for (const target of targets) {
      if (target.kind === 'creature' || target.kind === 'building') out.add(target.instanceId);
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
  const muted = mutedInstanceIds(draft, ctx);
  forSourceRaw(draft, ctx, (source, ability, abilityIndex) => {
    // «Без текста»: the muted instance contributes nothing (auras, cost mods,
    // triggers, granted modifiers — docs/MECHANICS-V2.md §3, A6).
    if (source.instanceId && muted.has(source.instanceId)) return;
    fn(source, ability, abilityIndex);
  });
}

function forSourceRaw(
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
  // Modifiers granted mid-turn by abilities act as pseudo-abilities in scans.
  for (const granted of draft.turnModifiers) {
    const inst = draft.instances[granted.instanceId];
    if (!inst) continue;
    if (granted.duration === 'while_flipped' && !inst.flipped) continue;
    fn({ player: inst.controller, instanceId: granted.instanceId }, { kind: 'passive', effect: granted.effect, text: '' }, -1);
  }
}

/** Sum turn counters for a scope ('own', 'team', 'teammate', 'all'). */
export function counterValue(
  draft: MatchState,
  counter: string,
  scope: CounterScope | 'all',
  sourcePlayer: string,
): number {
  const players = scope === 'own'
    ? [sourcePlayer]
    : scope === 'team'
      ? [sourcePlayer, ...teammatesOf(draft, sourcePlayer)]
      : scope === 'teammate'
        ? teammatesOf(draft, sourcePlayer)
        : draft.order;
  return players.reduce((sum, pid) => sum + (draft.turnCounters[`${counter}:${pid}`] ?? 0), 0);
}

/** `if_*`/`while_*` conditions; board scopes read the context instance. */
export function conditionsHold(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  source: EffectSource,
  conditions: ConditionSpec[] | undefined,
  targetInstanceId: string | undefined,
  payload?: TriggerPayload,
): boolean {
  if (!conditions) return true;
  const p = draft.players[source.player]!;
  for (const cond of conditions) {

    switch (cond.kind) {
      case 'if_payload_replacing':
        if (!payload?.replaced) return false;
        break;
      case 'if_payload_land_type': {
        if (!payload?.cardId) return false;
        const entered = ctx.catalog.getCard(payload.cardId);
        if (!entered || entered.landType !== cond.landType) return false;
        break;
      }
      case 'if_payload_cost': {
        if (!payload?.cardId) return false;
        const cost = ctx.catalog.getCard(payload.cardId)?.cost;
        if (cost === undefined) return false;
        if (cond.min !== undefined && cost < cond.min) return false;
        if (cond.max !== undefined && cost > cond.max) return false;
        break;
      }
      case 'if_payload_player_self':
        if (!payload?.player || payload.player !== source.player) return false;
        break;
      case 'if_payload_other':
        if (payload?.instanceId && payload.instanceId === source.instanceId) return false;
        break;
      case 'if_payload_teammate':
        if (!payload?.player) return false;
        if (!teammatesOf(draft, source.player).includes(payload.player)) return false;
        break;
      case 'if_payload_ally': {
        if (!payload?.player) return false;
        if (!sameTeam(draft, source.player, payload.player)) return false;
        break;
      }
      case 'if_payload_team_target': {
        const targetId = payload?.targetPlayer
          ?? (payload?.targetInstanceId ? instance(draft, payload.targetInstanceId).controller : undefined);
        if (!targetId || !sameTeam(draft, source.player, targetId)) return false;
        break;
      }
      case 'if_payload_opponent_target': {
        const targetId = payload?.targetPlayer
          ?? (payload?.targetInstanceId ? instance(draft, payload.targetInstanceId).controller : undefined);
        if (!targetId) return false;
        const isEnemy = opponentsOf(draft, source.player).includes(targetId);
        if (!isEnemy) return false;
        break;
      }
      case 'if_payload_creature': {
        if (!payload?.instanceId) return false;
        const inst = draft.instances[payload.instanceId];
        if (!inst || inst.slot !== 'creature') return false;
        break;
      }
      case 'if_payload_enemy_creature': {
        if (!payload?.instanceId) return false;
        const inst = draft.instances[payload.instanceId];
        if (!inst || inst.slot !== 'creature') return false;
        if (!opponentsOf(draft, source.player).includes(inst.controller)) return false;
        break;
      }
      case 'if_payload_targets_creature':
        if (!payload?.targetInstanceId) return false;
        if (draft.instances[payload.targetInstanceId]?.slot !== 'creature') return false;
        break;
      case 'while_phase':
        if (draft.phase !== cond.phase) return false;
        break;
      case 'if_payload_to_player':
        if (!payload?.targetPlayer) return false;
        break;
      case 'if_payload_targeted_self':
        if (!payload?.targetInstanceId || payload.targetInstanceId !== source.instanceId) return false;
        break;
      case 'if_payload_player_opponent':
        if (!payload?.player || payload.player === source.player) return false;
        break;
      case 'while_counter_at_least': {
        const value = counterValue(draft, cond.counter, cond.scope ?? 'team', source.player);
        if (value < cond.min) return false;
        break;
      }
      case 'while_counter_at_most': {
        const value = counterValue(draft, cond.counter, cond.scope ?? 'team', source.player);
        if (value > cond.max) return false;
        break;
      }
      case 'if_discard_count':
      case 'while_discard_count':
        if (p.discard.length < cond.min) return false;
        break;
      case 'while_undamaged': {
        const id = cond.scope === 'self' ? source.instanceId : targetInstanceId;
        // Target-scoped conditions are checked per candidate later; without a
        // candidate (source-level scan) they do not fail the ability.
        if (!id) break;
        if (instance(draft, id).damage !== 0) return false;
        break;
      }
      case 'while_damage_exactly': {
        const id = cond.scope === 'self' ? source.instanceId : targetInstanceId;
        if (!id) break;
        if (instance(draft, id).damage !== cond.amount) return false;
        break;
      }
      case 'while_damage_at_least': {
        const id = cond.scope === 'self' ? source.instanceId : targetInstanceId;
        if (!id) break;
        if (instance(draft, id).damage < cond.amount) return false;
        break;
      }
      case 'while_lane_empty_opponent': {
        const src = source.instanceId ? instance(draft, source.instanceId) : null;
        if (!src || src.zone === null) return false;
        const opposite = opponentZoneFor(draft, source.player, src.zone);
        if (opposite && draft.players[opposite.player]!.zones[opposite.zone]?.creature) return false;
        break;
      }
      case 'while_own_turn':
        if (!draft.activePlayers.includes(source.player)) return false;
        break;
      case 'while_own_card_in_play': {
        const inPlay = p.zones.some((zone) => {
          const id = zone.creature ?? zone.building;
          return id !== null && draft.instances[id]!.cardId === cond.cardId;
        });
        if (!inPlay) return false;
        break;
      }
      case 'while_no_tokens_in_play': {
        const total = draft.order.reduce((sum, pid) => sum + draft.players[pid]!.lands.reduce((s, l) => s + l.iceTokens, 0), 0);
        if (total > 0) return false;
        break;
      }
      case 'while_opponents_turn': {
        // Активные игроки — противники источника (docs/MECHANICS-V2.md §7).
        const opponents = opponentsOf(draft, source.player);
        if (!draft.activePlayers.some((pid) => opponents.includes(pid))) return false;
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
        const scope = cond.scope ?? 'all';
        for (const pid of scope === 'own' ? [source.player] : draft.order) {
          for (const zone of draft.players[pid]!.zones) {
            if (zone.creature && zone.creature !== source.instanceId) return false;
          }
        }
        break;
      }
      case 'while_empty_lands': {
        // «Пустая земля» = нет никаких карт (существа и строения).
        const empty = p.zones.filter((z) => !z.creature && !z.building).length;
        if (empty < cond.min) return false;
        break;
      }
      case 'while_on_flipped_land': {
        const id = cond.scope === 'self' ? source.instanceId : targetInstanceId;
        if (!id) break; // target-scoped: checked per candidate
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
      case 'while_lane_ice_token': {
        const src = source.instanceId ? instance(draft, source.instanceId) : null;
        if (!src || src.zone === null) return false;
        let tokens = 0;
        for (const pid of draft.order) {
          const other = draft.players[pid]!;
          if (other.zones.length !== draft.players[source.player]!.zones.length) continue;
          for (const zone of [src.zone]) {
            // Своя земля линии; зеркальная — у каждого противника напротив.
            tokens += other.lands[zone]?.iceTokens ?? 0;
            if (pid !== source.player) continue;
            const mirror = other.zones.length - 1 - zone;
            for (const enemyId of opponentsOf(draft, source.player)) {
              tokens += draft.players[enemyId]!.lands[mirror]?.iceTokens ?? 0;
            }
          }
        }
        if (tokens < cond.min) return false;
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

function sameTeam(draft: MatchState, a: string, b: string): boolean {
  if (a === b) return true;
  const ta = draft.players[a]?.teamId;
  const tb = draft.players[b]?.teamId;
  return ta !== undefined && ta !== null && ta === tb;
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
  payload?: TriggerPayload,
  choices?: import('./types').TargetChoice[],
): number {
  if (typeof amount === 'number') return amount;
  if (amount.kind === 'payload_damage') return payload?.amount ?? 0;
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
      const choicePlayer = amount.where === 'choice'
        ? choices?.find((c) => c.kind === 'player')?.playerId
        : undefined;
      if (amount.where === 'choice' && !choicePlayer) return 0;
      for (const pid of amount.where === 'own' ? [source.player] : amount.where === 'choice' ? [choicePlayer!] : draft.order) {
        const other = draft.players[pid]!;
        other.lands.forEach((land, zone) => {
          if (amount.where === 'adjacent') {
            if (!src || src.zone === null) return;
            if (other.zones.length !== ownZoneCount) return;
            if (Math.abs(zone - src.zone) !== 1) return;
          }
          if (amount.landType && land.type !== amount.landType) return;
          if (amount.flipped && !land.flipped) return;
          if (amount.empty && (other.zones[zone]?.creature || other.zones[zone]?.building)) return;
          if (amount.token && land.iceTokens <= 0) return;
          count += 1;
        });
      }
      return count * amount.amount;
    }
    case 'per_counter':
      return counterValue(draft, amount.counter, amount.scope, source.player) * amount.amount;
    case 'per_token_players':
      return draft.order.filter((pid) => draft.players[pid]!.lands.some((l) => l.iceTokens > 0)).length * amount.amount;
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
  if (filter.landType && card.landType !== filter.landType && !countsAsTypes(draft, ctx, instanceId).includes(filter.landType)) return false;
  if (filter.sameCard) {
    const ownCardId = source.instanceId ? instance(draft, source.instanceId).cardId : undefined;
    if (card.id !== ownCardId) return false;
  }
  if (filter.cardIds && !filter.cardIds.includes(card.id)) return false;
  if (filter.zoneToken) {
    const owner = draft.players[inst.controller]!;
    if (inst.zone === null || owner.lands[inst.zone]!.iceTokens <= 0) return false;
  }
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
    const single = Array.isArray(ability.effect) ? ability.effect[0] : ability.effect;
    const effect: EffectSpec | undefined = single;
    if (!effect || effect.op !== 'cost_mod' || !conditionsHold(draft, ctx, source, ability.conditions, undefined)) continue;
    total += resolveStatAmount(draft, ctx, source, effect.amount);
  }
  // Расходуемые скидки следующего розыгрыша (Призрак Джинни, Непустой гроб).
  for (const discount of draft.discounts) {
    if (discount.player !== playerId || discount.cardType !== card.type) continue;
    if (discount.grantedOnTurn !== draft.turn) continue;
    total += discount.amount;
    break; // «следующее» — ровно одна скидка на розыгрыш
  }
  return total;
}

/** Consume the discount used by a successful play (docs/MECHANICS-V2.md §3, A10). */
export function consumeDiscount(
  draft: MatchState,
  playerId: string,
  cardType: 'spell' | 'creature' | 'building',
): void {
  const index = draft.discounts.findIndex(
    (d) => d.player === playerId && d.cardType === cardType && d.grantedOnTurn === draft.turn,
  );
  if (index >= 0) draft.discounts.splice(index, 1);
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
    const single = Array.isArray(ability.effect) ? ability.effect[0] : ability.effect;
    const effect: EffectSpec | undefined = single;
    if (!effect || effect.op !== 'land_count_mod' || !conditionsHold(draft, ctx, source, ability.conditions, undefined)) return;
    if (effect.landType && effect.landType !== landType) return;
    total += effect.amount;
  });
  return total;
}

export type { ResolvedTarget };

/** Modifier effects only (suppress / no_retaliation / damage_immunity / damage_redirect). */
const MODIFIER_OPS = new Set(['suppress', 'no_retaliation', 'damage_immunity', 'damage_redirect', 'counts_as', 'attack_mod', 'defense_mod']);

type RuleEffect = Extract<EffectSpec, { op: 'suppress' | 'no_retaliation' | 'damage_immunity' | 'damage_redirect' | 'counts_as' | 'attack_mod' | 'defense_mod' }>;

function ruleEffects(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
): Array<{ source: EffectSource; effect: RuleEffect }> {
  const out: Array<{ source: EffectSource; effect: RuleEffect }> = [];
  forSource(draft, ctx, (source, ability) => {
    if (ability.kind !== 'passive' || ability.trigger !== undefined) return;
    const effect = ability.effect;
    if (!effect || Array.isArray(effect) || !MODIFIER_OPS.has(effect.op)) return;
    if (!conditionsHold(draft, ctx, source, ability.conditions, undefined)) return;
    out.push({ source, effect: effect as RuleEffect });
  });
  return out;
}

function coversInstance(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  source: EffectSource,
  target: TargetRef,
  instanceId: string,
  filter?: TargetFilter,
): boolean {
  const targets = resolveTarget(draft, ctx, target, source, undefined);
  return targets.some(
    (t) =>
      (t.kind === 'creature' || t.kind === 'building') &&
      t.instanceId === instanceId &&
      // Coverage may be narrowed by a target filter (Морозильная камера: zoneToken).
      (!filter || targetMatchesFilter(draft, ctx, source, instanceId, filter)),
  );
}

/** Is this trigger suppressed for the source (Дворец Костей)? */
export function isTriggerSuppressed(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  source: EffectSource,
  trigger: Trigger,
): boolean {
  if (!source.instanceId) return false;
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'suppress' || (!effect.triggers?.includes(trigger) && !effect.all)) continue;
    if (coversInstance(draft, ctx, modSource, effect.target, source.instanceId, effect.filter)) return true;
  }
  return false;
}

/** Are this instance's active abilities suppressed (Чародейка Вайда)? */
export function areActivesSuppressed(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  instanceId: string,
): boolean {
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'suppress' || (!effect.actives && !effect.all)) continue;
    if (coversInstance(draft, ctx, modSource, effect.target, instanceId, undefined)) return true;
  }
  return false;
}

/** Is this attacker banned from attacking (Морозильная камера)? */
export function attacksSuppressed(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  attackerId: string,
): boolean {
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'suppress' || (!effect.attacks && !effect.all)) continue;
    if (coversInstance(draft, ctx, modSource, effect.target, attackerId, undefined)) return true;
  }
  return false;
}

/** Sum of damage immunity for the victim (Пушистая лиса). */
export function damageImmunity(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  victimId: string,
  fromAttack: boolean,
): number {
  let total = 0;
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'damage_immunity') continue;
    if (effect.from === 'attacks' && !fromAttack) continue;
    if (coversInstance(draft, ctx, modSource, effect.target, victimId, undefined)) total += effect.amount;
  }
  return total;
}

/** Redirect target for the victim, if any (Ведриния-style, granted or printed). */
export function damageRedirectTarget(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  victimId: string,
): string | null {
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'damage_redirect') continue;
    if (effect.excludeSelf && modSource.instanceId === victimId) continue;
    if (coversInstance(draft, ctx, modSource, effect.from, victimId)) return modSource.instanceId;
  }
  return null;
}


/**
 * Land types the instance additionally counts as (Кроха слон — радужным;
 * Очаровательный город — существа линии радужными). Live scan, §2А.
 */
export function countsAsTypes(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  instanceId: string,
): string[] {
  const out: string[] = [];
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'counts_as') continue;
    if (coversInstance(draft, ctx, modSource, effect.target, instanceId, undefined)) {
      out.push(effect.landType);
    }
  }
  return out;
}

/** Does the attacking creature provoke no retaliation (Призрачные бро)? */
export function hasNoRetaliation(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  attackerId: string,
): boolean {
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'no_retaliation') continue;
    if (coversInstance(draft, ctx, modSource, effect.target, attackerId, undefined)) return true;
  }
  return false;
}


/** Active abilities granted to this card by live grant_ability auras (Финн). */
export function collectGrantedActives(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  instanceId: string,
): AbilitySpec[] {
  const out: AbilitySpec[] = [];
  forSource(draft, ctx, (source, ability) => {
    if (ability.kind !== 'passive' || ability.trigger !== undefined) return;
    const effect = ability.effect;
    if (!effect || Array.isArray(effect) || effect.op !== 'grant_ability') return;
    if (!conditionsHold(draft, ctx, source, ability.conditions, undefined)) return;
    if (effect.ability.kind !== 'active') return;
    const targets = resolveTarget(draft, ctx, effect.target, source, undefined);
    for (const target of targets) {
      if (target.kind !== 'creature' && target.kind !== 'building') continue;
      if (target.instanceId !== instanceId) continue;
      // Per-target conditions (Финн: «не получившие урон»).
      if (!conditionsHold(draft, ctx, source, ability.conditions, target.instanceId)) continue;
      out.push(effect.ability);
    }
  });
  return out;
}


/** Combat modifiers of the DEFENDING creature (A8: «+N АТК пока защищается»). */
export function defenseMods(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  defenderId: string,
  attackerZoneLand: string | null,
): Array<Extract<RuleEffect, { op: 'defense_mod' }>> {
  const out: Array<Extract<RuleEffect, { op: 'defense_mod' }>> = [];
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'defense_mod') continue;
    if (effect.landType && effect.landType !== attackerZoneLand) continue;
    if (coversInstance(draft, ctx, modSource, effect.target, defenderId, undefined)) out.push(effect);
  }
  return out;
}

/** Combat modifiers of the attacking creature (A3: тройной урон, бонус, в лицо). */
export function attackMods(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  attackerId: string,
): Array<Extract<RuleEffect, { op: 'attack_mod' }>> {
  const out: Array<Extract<RuleEffect, { op: 'attack_mod' }>> = [];
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'attack_mod') continue;
    if (coversInstance(draft, ctx, modSource, effect.target, attackerId, undefined)) out.push(effect);
  }
  return out;
}
