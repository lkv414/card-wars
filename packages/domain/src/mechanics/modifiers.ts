import { instance, player } from '../util';
import type { Ctx } from '../util';
import { DomainError } from '../errors';
import type { CardData, MatchState, PlayerId } from '../types';
import { teamOf } from '../zones';
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
  /** Multiply the final stat (docs §H2, «АТК удваивается»). */
  multiplier?: number;
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
      // Conditions of the effect itself, per candidate (Мисс Пушинка, Кукурузный чемпион).
      if (!conditionsHold(draft, ctx, source, effect.conditions, target.instanceId)) continue;
      out.push({
        stat: effect.stat,
        amount: resolveStatAmount(draft, ctx, source, effect.amount),
        floorDefense: effect.floorDefense,
        floorAttack: effect.floorAttack,
        multiplier: effect.multiplier,
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
      case 'if_payload_building': {
        if (!payload?.instanceId) return false;
        const inst = draft.instances[payload.instanceId];
        if (!inst || inst.slot !== 'building') return false;
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
      case 'while_team_creature_on_token_land': {
        const owners = [source.player, ...teammatesOf(draft, source.player)];
        const holds = owners.some((pid) =>
          draft.players[pid]!.lands.some((l, z) => l.iceTokens > 0 && draft.players[pid]!.zones[z]!.creature));
        if (!holds) return false;
        break;
      }
      case 'while_adjacent_lanes_empty': {
        if (!source.instanceId) return false;
        const src = instance(draft, source.instanceId);
        if (src.zone === null) return false;
        const me = draft.players[source.player]!;
        for (const nz of [src.zone - 1, src.zone + 1]) {
          if (nz < 0 || nz >= me.zones.length) continue;
          if (me.zones[nz]!.creature || draft.players[opponentsOf(draft, source.player)[0] ?? '']?.zones[nz]?.creature) return false;
        }
        break;
      }
      case 'while_opponent_controls_own_creature': {
        const holds = Object.values(draft.instances).some(
          (i) => i.location === 'field' && i.controller !== i.owner,
        );
        if (!holds) return false;
        break;
      }
      case 'if_payload_zone_adjacent': {
        // Событие в соседней зоне того же контроллера (Песочный краб рубака).
        if (!source.instanceId || payload?.zone === undefined || payload.zone === null || !payload.instanceId) return false;
        const src = instance(draft, source.instanceId);
        if (src.zone === null) return false;
        if (Math.abs(payload.zone - src.zone) !== 1) return false;
        if (instance(draft, payload.instanceId).controller !== src.controller) return false;
        break;
      }
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
      case 'while_own_creature_on_land_type': {
        const found = p.zones.some((zone) => {
          const id = zone.creature;
          if (!id) return false;
          const inst = instance(draft, id);
          if (inst.zone === null) return false;
          return p.lands[inst.zone]!.type === cond.landType;
        });
        if (!found) return false;
        break;
      }
      case 'while_own_turn':
        if (!draft.activePlayers.includes(source.player)) return false;
        break;
      case 'while_own_card_in_play': {
        const inPlay = p.zones.some((zone) => {
          const id = zone.creature ?? zone.building;
          if (id === null || draft.instances[id]!.cardId !== cond.cardId) return false;
          if (cond.minDamage !== undefined && draft.instances[id]!.damage < cond.minDamage) return false;
          return true;
        });
        if (!inPlay) return false;
        break;
      }
      case 'if_payload_killer_self':
        if (!payload?.killerInstanceId || payload.killerInstanceId !== source.instanceId) return false;
        break;
      case 'if_payload_zone_matches_self': {
        const src = source.instanceId ? instance(draft, source.instanceId) : null;
        if (!src || src.zone === null || payload?.zone === undefined || payload.zone === null) return false;
        if (payload.zone !== src.zone) return false;
        break;
      }
      case 'while_played_land_type': {
        const hit = draft.turnPlayedCardIds.some((cid) => ctx.catalog.getCard(cid)?.landType === cond.landType);
        if (!hit) return false;
        break;
      }
      case 'if_payload_zone_land_type': {
        if (!payload?.player || payload.zone === undefined || payload.zone === null) return false;
        const land = draft.players[payload.player]!.lands[payload.zone];
        if (!land || land.type !== cond.landType) return false;
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
      case 'while_zone_has_flipped_creature': {
        const src = source.instanceId ? instance(draft, source.instanceId) : null;
        if (!src || src.zone === null) return false;
        const id = draft.players[source.player]!.zones[src.zone]!.creature;
        if (!id || !draft.instances[id]!.flipped) return false;
        break;
      }
      case 'while_lives_at_most': {
        const team = teamOf(draft, source.player);
      const lives = team ? team.lives : draft.players[source.player]!.lives;
      if (lives > cond.max) return false;
        break;
      }
      case 'while_opponent_creatures_at_most': {
        const count = opponentsOf(draft, source.player).reduce(
          (sum, pid) => sum + draft.players[pid]!.zones.filter((z) => z.creature).length, 0,
        );
        if (count > cond.max) return false;
        break;
      }
      case 'while_zone_has_creature': {
        const src = source.instanceId ? instance(draft, source.instanceId) : null;
        if (!src || src.zone === null) return false;
        if (!draft.players[source.player]!.zones[src.zone]!.creature) return false;
        break;
      }
      case 'while_zone_has_building': {
        const src = source.instanceId ? instance(draft, source.instanceId) : null;
        if (!src || src.zone === null) return false;
        if (!p.zones[src.zone]!.building) return false;
        break;
      }
      case 'while_zone_has_no_creature': {
        const src = source.instanceId ? instance(draft, source.instanceId) : null;
        if (!src || src.zone === null) return false;
        if (p.zones[src.zone]!.creature) return false;
        break;
      }
      case 'while_no_land_type_played': {
        if (draft.turnPlayedCardIds.some((cid) => ctx.catalog.getCard(cid)?.landType === cond.landType)) return false;
        break;
      }
      case 'if_payload_name_contains': {
        // The word was validated against the hero's wordSetup at choose_word.
        const word = draft.chosenWord[source.player] ?? '';
        if (!word || !payload?.cardId) return false;
        const name = ctx.catalog.getCard(payload.cardId)?.name ?? '';
        if (!name.toLowerCase().includes(word.toLowerCase())) return false;
        break;
      }
      case 'if_payload_instance_self': {
        if (!source.instanceId || payload?.instanceId !== source.instanceId) return false;
        break;
      }
      case 'while_target_moved_this_turn': {
        const id = targetInstanceId ?? source.instanceId;
        if (!id || !instance(draft, id).movedThisTurn) return false;
        break;
      }
      case 'while_lives_even': {
        const team = teamOf(draft, source.player);
        const lives = team ? team.lives : p.lives;
        if (lives % 2 !== 0) return false;
        break;
      }
      case 'while_damage_at_most': {
        const id = source.instanceId;
        if (!id || instance(draft, id).damage > cond.amount) return false;
        break;
      }
      case 'while_effective_def_at_most': {
        // «Осталось ≤ N DEF с учётом бонусов»: база + бонусы + turnBuffs, БЕЗ
        // аур — computeEff здесь дал бы бесконечную рекурсию (условие ауры
        // того же инстанса пересчитывало бы её же). scope 'target' смотрит на
        // цель, проверяемую per-target.
        const id = cond.scope === 'target' ? targetInstanceId : source.instanceId;
        if (!id) return false;
        const inst = instance(draft, id);
        const card = ctx.catalog.getCard(inst.cardId);
        const buffs = draft.turnBuffs
          .filter((b) => b.instanceId === id && b.stat === 'defense')
          .reduce((sum, b) => sum + b.amount, 0);
        const remaining = (card?.defense ?? 0) + inst.bonusDefense + buffs - inst.damage;
        if (remaining > cond.max) return false;
        break;
      }
      case 'while_lives_at_least': {
        const team = teamOf(draft, source.player);
        const lives = team ? team.lives : p.lives;
        if (lives < cond.min) return false;
        break;
      }
      case 'while_attached_at_least': {
        const inst = source.instanceId ? instance(draft, source.instanceId) : null;
        if ((inst?.attached?.length ?? 0) < cond.min) return false;
        break;
      }
      case 'while_card_name_contains': {
        const word = draft.chosenWord[source.player] ?? '';
        if (!word) return false;
        const needle = word.toLowerCase();
        if (!draft.turnPlayedCardIds.some((cid) => (ctx.catalog.getCard(cid)?.name ?? '').toLowerCase().includes(needle))) return false;
        break;
      }
      case 'while_played_card_type': {
        if (!draft.turnPlayedCardIds.some((cid) => ctx.catalog.getCard(cid)?.type === cond.type)) return false;
        break;
      }
      case 'while_no_spells_played': {
        if (draft.turnPlayedCardIds.some((cid) => ctx.catalog.getCard(cid)?.type === 'spell')) return false;
        break;
      }
      case 'while_opponents_hand_at_least': {
        const holds = opponentsOf(draft, source.player).some((pid) => draft.players[pid]!.hand.length >= cond.min);
        if (!holds) return false;
        break;
      }
      case 'if_option': {
        // Branch gate: evaluated in runSteps before the step's choices are
        // counted (docs §6). By the time a step runs, its branch is chosen.
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
    case 'per_opponent_distinct_lands': {
      const types = opponentsOf(draft, source.player).flatMap((pid) => draft.players[pid]!.lands.map((l) => l.type));
      return distinctLandTypes(types) * amount.amount;
    }
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
    case 'per_counter': {
      const value = counterValue(draft, amount.counter, amount.scope, source.player);
      return Math.floor(value / (amount.every ?? 1)) * amount.amount;
    }
    case 'target_hand_size': {
      const picked = choices?.find((c) => c.kind === 'player');
      return picked ? draft.players[picked.playerId]!.hand.length * amount.amount : 0;
    }
    case 'payload_cost':
      return (payload?.cost ?? 0) * amount.amount;
    case 'per_played_name': {
      const needle = (cardId: string): boolean => {
        const name = ctx.catalog.getCard(cardId)?.name ?? '';
        return amount.matchers.some((m) => name.toLowerCase().includes(m.toLowerCase()));
      };
      return draft.turnPlayedCardIds.filter(needle).length * amount.amount;
    }
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
    case 'chosen_amount': {
      const answer = choices?.[amount.index];
      if (!answer || answer.kind !== 'amount') {
        throw new DomainError('invalid_choice', `no amount answer at index ${amount.index}`);
      }
      return answer.value;
    }
    case 'target_damage': {
      const targets = resolveTarget(draft, ctx, amount.target, source, choices, undefined);
      let total = 0;
      for (const target of targets) {
        if (target.kind === 'creature' || target.kind === 'building') total += instance(draft, target.instanceId).damage;
      }
      return total;
    }
    case 'target_attack': {
      const targets = resolveTarget(draft, ctx, amount.target, source, choices, undefined);
      let total = 0;
      for (const target of targets) {
        if (target.kind !== 'creature' && target.kind !== 'building') continue;
        const inst = instance(draft, target.instanceId);
        const card = ctx.catalog.getCard(inst.cardId);
        let attack = (card?.attack ?? 0) + inst.bonusAttack;
        for (const buff of draft.turnBuffs) {
          if (buff.instanceId === target.instanceId && buff.stat === 'attack') {
            attack += buff.amount;
            attack *= buff.multiplier ?? 1;
          }
        }
        total += attack;
      }
      return total;
    }
    case 'attached_count': {
      const targets = resolveTarget(draft, ctx, amount.target, source, choices, undefined);
      let total = 0;
      for (const target of targets) {
        if (target.kind === 'creature' || target.kind === 'building') total += instance(draft, target.instanceId).attached?.length ?? 0;
      }
      return total;
    }
    case 'chosen_card_cost': {
      const answer = choices?.[amount.index];
      if (!answer || answer.kind !== 'card') {
        throw new DomainError('invalid_choice', `no card answer at index ${amount.index}`);
      }
      const inst = instance(draft, answer.instanceId);
      return ctx.catalog.getCard(inst.cardId)?.cost ?? 0;
    }
    case 'team_companion_cost': {
      let total = 0;
      for (const pid of [source.player, ...teammatesOf(draft, source.player)]) {
        const comp = draft.players[pid]!.companion;
        if (comp) total += ctx.catalog.getCard(draft.instances[comp]!.cardId)?.cost ?? 0;
      }
      return total;
    }
    case 'lives_ladder': {
      const lives = teamOf(draft, source.player)
        ? teamOf(draft, source.player)!.lives
        : player(draft, source.player).lives;
      return lives >= amount.threshold ? amount.high : amount.low;
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
  if (filter.flipped === true && !inst.flipped) return false;
  if (filter.undamaged === true && inst.damage > 0) return false;
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
  if (filter.zoneFlipped) {
    const owner = draft.players[inst.controller]!;
    if (inst.zone === null || !owner.lands[inst.zone]!.flipped) return false;
  }
  if (filter.zoneBuilding) {
    const owner = draft.players[inst.controller]!;
    if (inst.zone === null || !owner.zones[inst.zone]!.building) return false;
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
const MODIFIER_OPS = new Set(['suppress', 'no_retaliation', 'damage_immunity', 'damage_redirect', 'counts_as', 'attack_mod', 'defense_mod', 'dodge', 'land_flip_protection', 'restrict_play', 'allow_frozen_play', 'guard_player', 'damage_cap', 'damage_bonus']);

type RuleEffect = Extract<EffectSpec, { op: 'suppress' | 'no_retaliation' | 'damage_immunity' | 'damage_redirect' | 'counts_as' | 'attack_mod' | 'defense_mod' | 'dodge' | 'land_flip_protection' | 'restrict_play' | 'allow_frozen_play' | 'guard_player' | 'damage_cap' | 'damage_bonus' }>;

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

/** d6 minimum for creature attacks against the covered unit to whiff (Прозрачный ниндзя, docs §H14). */
export function dodgeMin(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  defenderId: string,
): number | undefined {
  let min: number | undefined;
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'dodge') continue;
    if (!coversInstance(draft, ctx, modSource, effect.target, defenderId, undefined)) continue;
    min = min === undefined ? effect.min : Math.min(min, effect.min);
  }
  return min;
}

/**
 * The land of `playerId`'s `zone` may not be flipped down by `byPlayer`
 * (Яблочный страж, docs §H15): a land_flip_protection creature stands there,
 * is the land owner's, and `byPlayer` is its opponent.
 */
export function landFlipProtected(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  playerId: PlayerId,
  zone: number,
  byPlayer: PlayerId,
): boolean {
  for (const { source, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'land_flip_protection') continue;
    if (!source.instanceId) continue;
    const inst = instance(draft, source.instanceId);
    if (inst.location !== 'field' || inst.zone !== zone) continue;
    if (inst.controller !== playerId) continue;
    if (inst.controller === byPlayer) continue; // свои эффекты не блокируются
    return true;
  }
  return false;
}

/** Frozen-land creature play permit (Ледяная база / monika_card_24, docs §H16). */
export function frozenPlayPermitted(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  playerId: PlayerId,
  zone: number,
): boolean {
  for (const { source, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'allow_frozen_play') continue;
    if (effect.scope === 'all') return true;
    if (!source.instanceId) continue;
    const inst = instance(draft, source.instanceId);
    if (inst.controller === playerId && inst.zone === zone) return true;
  }
  return false;
}

/** Player damage at/below the threshold goes to the covered guardian (Мило-страж, docs §H16). */
export function playerGuard(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  playerId: PlayerId,
  lives: number,
): string | undefined {
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'guard_player') continue;
    if (lives > effect.threshold) continue;
    const covered = resolveTarget(draft, ctx, effect.target, modSource, undefined).find(
      (t) => t.kind === 'creature',
    );
    if (covered && covered.kind === 'creature') {
      const inst = instance(draft, covered.instanceId);
      if (inst.controller === playerId) return covered.instanceId;
    }
  }
  return undefined;
}

/** Creature-hit damage cap for the covered unit (Подушка боли, docs §H16). */
export function damageCapFor(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  targetId: string,
  fromAttack: boolean,
): number | undefined {
  let cap: number | undefined;
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'damage_cap') continue;
    if (!coversInstance(draft, ctx, modSource, effect.target, targetId, undefined)) continue;
    if (fromAttack) cap = cap === undefined ? effect.max : Math.min(cap, effect.max);
  }
  return cap;
}

/** Extra spell damage against the covered unit (Подушка боли, docs §H16). */
export function spellDamageBonusFor(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  targetId: string,
  bySpell: boolean,
): number {
  let bonus = 0;
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'damage_bonus') continue;
    if (!bySpell || !coversInstance(draft, ctx, modSource, effect.target, targetId, undefined)) continue;
    bonus += effect.amount;
  }
  return bonus;
}

/** `playerId` may not play a card of this cost right now (Няш-мяш, docs §H15). */
export function playRestricted(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  playerId: PlayerId,
  cost: number,
): boolean {
  for (const { source, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'restrict_play' || effect.who !== 'opponents') continue;
    if (source.player === playerId) continue;
    if (cost <= effect.maxCost) return true;
  }
  return false;
}

/**
 * The covered creature cannot be TARGETED by an opponent's spells (`spells`)
 * or opponent creatures' abilities (`creatureAbilities`) — Облачная башня,
 * Мятная мороженка (docs §H11). Own sources never shield against their owner.
 */
export function targetingSuppressed(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  targetId: string,
  byPlayer: PlayerId,
  abilityKind: 'spell' | 'creature' | 'building' | 'hero',
): boolean {
  for (const { source: modSource, effect } of ruleEffects(draft, ctx)) {
    if (effect.op !== 'suppress' || modSource.player === byPlayer) continue;
    const blocksSpell = effect.spells === true && abilityKind === 'spell';
    const blocksCreature = effect.creatureAbilities === true && abilityKind === 'creature';
    if ((blocksSpell || blocksCreature) && coversInstance(draft, ctx, modSource, effect.target, targetId, undefined)) {
      return true;
    }
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
