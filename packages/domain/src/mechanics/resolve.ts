import { DomainError } from '../errors';
import { instance, player } from '../util';
import type { Ctx } from '../util';
import type { MatchState, PlayerId } from '../types';
import { alivePlayerIds, opponentsOf, opponentZoneFor, teammatesOf } from '../zones';
import type { EffectSource } from './source';
import { countsAsTypes } from './modifiers';
import { computeEff } from '../stats';
import type { TargetAsk, TargetChoice, TargetFilter, TargetRef } from './types';
export type { TargetRef };

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
  ctx: Pick<Ctx, 'config' | 'catalog'>,
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
    if (!choiceMatchesAsk(draft, source, ask, choice, choices!)) {
      throw new DomainError('invalid_choice', `target ${i + 1} does not match ask ${ask.kind}`);
    }
    // Защищённое существо нельзя выбрать врагом (Пещера одиночества).
    if (choice.kind === 'creature') {
      const inst = instance(draft, choice.instanceId);
      if (draft.protections.some((pr) => pr.instanceId === choice.instanceId) && inst.controller !== source.player) {
        throw new DomainError('invalid_choice', 'target is protected');
      }
    }
    if (ask.filter && !askFilterPasses(draft, ctx, choice, ask.filter)) {
      throw new DomainError('invalid_choice', `target ${i + 1} violates the ask filter`);
    }
  });
}

/** Ask-level filter (docs/MECHANICS-V2.md §5): ready / landType on the chosen card. */
function askFilterPasses(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  choice: TargetChoice,
  filter: TargetFilter,
): boolean {
  if (choice.kind !== 'creature' && choice.kind !== 'card') return true;
  const inst = instance(draft, choice.instanceId);
  if (filter.ready && inst.flipped) return false;
  if (filter.flipped === true && !inst.flipped) return false;
  if (filter.undamaged === true && inst.damage > 0) return false;
  if (filter.landType && !landTypeMatches(draft, ctx, choice.instanceId, filter.landType)) return false;
  if (filter.zoneToken) {
    const owner = draft.players[inst.controller]!;
    if (inst.zone === null || owner.lands[inst.zone]!.iceTokens <= 0) return false;
  }
  // Тип и стоимость карты (выбор из сброса: «строение», «существо стоимостью 2 или менее»).
  if (filter.cardType || filter.maxCost !== undefined || filter.cardIds) {
    const card = ctx.catalog.getCard(inst.cardId);
    if (!card) return false;
    if (filter.cardType && card.type !== filter.cardType) return false;
    if (filter.maxCost !== undefined && card.cost > filter.maxCost) return false;
    if (filter.cardIds && !filter.cardIds.includes(card.id)) return false;
  }
  return true;
}

/** Card land type plus «считается …» overrides (Кроха слон, город). */
function landTypeMatches(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  instanceId: string,
  landType: string,
): boolean {
  const inst = instance(draft, instanceId);
  const card = ctx.catalog.getCard(inst.cardId);
  if (card && card.landType === landType) return true;
  return countsAsTypes(draft, ctx, instanceId).includes(landType);
}

function choiceMatchesAsk(
  draft: MatchState,
  source: EffectSource,
  ask: TargetAsk,
  choice: TargetChoice,
  choices: TargetChoice[],
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
    case 'lane_creature': {
      if (choice.kind !== 'creature' || !isFieldCreature(draft, choice.instanceId)) return false;
      const inst = instance(draft, choice.instanceId);
      const lane = laneZone(draft, source, choices);
      return lane !== null && inst.zone === lane;
    }
    case 'lane_opponent_creature': {
      if (choice.kind !== 'creature' || !isFieldCreature(draft, choice.instanceId)) return false;
      const inst = instance(draft, choice.instanceId);
      const lane = laneZone(draft, source, choices);
      return lane !== null && inst.zone === lane && isOpponent(draft, source.player, inst.controller);
    }
    case 'opponent_player':
      return choice.kind === 'player' && isOpponent(draft, source.player, choice.playerId);
    case 'any_player':
      return choice.kind === 'player' && alivePlayerIds(draft).includes(choice.playerId);
    case 'landscape': {
      if (choice.kind !== 'landscape') return false;
      const p = draft.players[choice.player];
      return Boolean(p && choice.zone >= 0 && choice.zone < p.lands.length);
    }
    case 'own_landscape': {
      if (choice.kind !== 'landscape') return false;
      return choice.player === source.player;
    }
    case 'adjacent_any_creature': {
      if (choice.kind !== 'creature' || !isFieldCreature(draft, choice.instanceId)) return false;
      const inst = instance(draft, choice.instanceId);
      const src = source.instanceId ? instance(draft, source.instanceId) : null;
      if (!src || src.zone === null || inst.zone === null) return false;
      return Math.abs(inst.zone - src.zone) === 1;
    }
    case 'adjacent_creature': {
      if (choice.kind !== 'creature' || !isFieldCreature(draft, choice.instanceId)) return false;
      const inst = instance(draft, choice.instanceId);
      const src = source.instanceId ? instance(draft, source.instanceId) : null;
      if (!src || src.zone === null || inst.controller !== source.player) return false;
      if (inst.zone === null) return false;
      return Math.abs(inst.zone - src.zone) === 1;
    }
    case 'opponent_building': {
      if (choice.kind !== 'creature') return false;
      const inst = instance(draft, choice.instanceId);
      return inst.location === 'field' && inst.slot === 'building' && isOpponent(draft, source.player, inst.controller);
    }
    case 'own_building':
      return choice.kind === 'creature' && isOwnFieldCard(draft, choice.instanceId, source.player, 'building');
    case 'lane_building': {
      if (choice.kind !== 'creature') return false;
      const inst = instance(draft, choice.instanceId);
      const lane = laneZone(draft, source, choices);
      return (
        lane !== null &&
        inst.location === 'field' &&
        inst.slot === 'building' &&
        inst.zone === lane
      );
    }
    case 'revealed_card': {
      if (choice.kind !== 'card') return false;
      const window = draft.revealed[source.player] ?? [];
      return window.includes(choice.instanceId);
    }
    case 'own_hand_card': {
      if (choice.kind !== 'card') return false;
      const inst = instance(draft, choice.instanceId);
      return inst.location === 'hand' && inst.controller === source.player;
    }
    case 'own_discard_card': {
      if (choice.kind !== 'card') return false;
      const inst = instance(draft, choice.instanceId);
      return inst.location === 'discard' && inst.controller === source.player;
    }
    case 'any_discard_card': {
      if (choice.kind !== 'card') return false;
      const inst = instance(draft, choice.instanceId);
      return inst.location === 'discard';
    }
    case 'visible_card': {
      // Публичная карта: в игре или в любой стопке сброса (Громила).
      if (choice.kind !== 'card') return false;
      const inst = instance(draft, choice.instanceId);
      return inst.location === 'field' || inst.location === 'companion' || inst.location === 'discard';
    }
    case 'heal_or_damage':
      return choice.kind === 'mode';
    case 'amount':
      return (
        choice.kind === 'amount' &&
        Number.isInteger(choice.value) &&
        choice.value >= (ask.min ?? 0) &&
        choice.value <= (ask.max ?? 99)
      );
    case 'choose_option':
      return choice.kind === 'option' && (ask.options ?? []).includes(choice.option);
    case 'damage_distribution':
      return (
        choice.kind === 'amounts' &&
        Array.isArray(choice.values) &&
        choice.values.every((v) => Number.isInteger(v) && v >= 0)
      );
  }
}

/**
 * Lane reference for lane-asks: the source's zone; spells (in hand, zone null)
 * fall back to the first creature choice (Отрази угроза: «на этой линии»
 * относительно выбранного существа).
 */
function laneZone(draft: MatchState, source: EffectSource, choices: TargetChoice[]): number | null {
  const src = source.instanceId ? instance(draft, source.instanceId) : null;
  if (src?.zone != null) return src.zone;
  const firstLandscape = choices.find((c) => c.kind === 'landscape');
  if (firstLandscape) return firstLandscape.zone;
  const firstCreature = choices.find((c) => c.kind === 'creature');
  if (firstCreature) return instance(draft, firstCreature.instanceId).zone;
  return null;
}

function isOwnFieldCard(draft: MatchState, instanceId: string, playerId: string, slot: 'creature' | 'building'): boolean {
  const inst = instance(draft, instanceId);
  return inst.location === 'field' && inst.slot === slot && inst.controller === playerId;
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
  payload?: import('./types').TriggerPayload,
): ResolvedTarget[] {
  // A card that just left play has zone null — on_leave_play triggers carry the
  // last zone in the payload (Крушитель земли, Зеленая змейка).
  const src = source.instanceId ? instance(draft, source.instanceId) : null;
  const srcZone = src?.zone ?? (source.instanceId ? payload?.zone ?? null : null);
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
    case 'this_lane_own_creature': {
      if (srcZone === null) return [];
      const id = player(draft, source.player).zones[srcZone]?.creature;
      return id ? [{ kind: 'creature', instanceId: id }] : [];
    }
    case 'each_creature_of_choice_player': {
      const picked = choices?.find((c) => c.kind === 'player');
      if (!picked) return [];
      const out: ResolvedTarget[] = [];
      for (const zone of draft.players[picked.playerId]!.zones) {
        if (zone.creature) out.push({ kind: 'creature', instanceId: zone.creature });
      }
      return out;
    }
    case 'each_opponent_land': {
      const out: ResolvedTarget[] = [];
      for (const pid of opponentsOf(draft, source.player)) {
        draft.players[pid]!.lands.forEach((_, zone) => out.push({ kind: 'land', playerId: pid, zone }));
      }
      return out;
    }
    case 'payload_zone_land': {
      if (!payload?.player || payload.zone === undefined || payload.zone === null) return [];
      return [{ kind: 'land', playerId: payload.player, zone: payload.zone }];
    }
    case 'payload_zone_own_creatures': {
      if (!payload?.player || payload.zone === undefined || payload.zone === null) return [];
      const id = draft.players[payload.player]!.zones[payload.zone]?.creature;
      return id ? [{ kind: 'creature', instanceId: id }] : [];
    }
    case 'payload_killer': {
      if (!payload?.killerInstanceId) return [];
      return [{ kind: 'creature', instanceId: payload.killerInstanceId }];
    }
    case 'payload_player': {
      if (!payload?.player) return [];
      return [{ kind: 'player', playerId: payload.player }];
    }
    case 'min_attack_own': {
      let best: string | null = null;
      let bestAtk = Infinity;
      for (const zone of draft.players[source.player]!.zones) {
        const id = zone.creature;
        if (!id) continue;
        const atk = computeEff(draft, ctx, id).attack;
        if (atk < bestAtk) {
          bestAtk = atk;
          best = id;
        }
      }
      return best ? [{ kind: 'creature', instanceId: best }] : [];
    }
    case 'adjacent_own_land': {
      if (srcZone === null) return [];
      const zones = player(draft, source.player).zones;
      const out: ResolvedTarget[] = [];
      for (const z of [srcZone - 1, srcZone + 1]) {
        if (z < 0 || z >= zones.length) continue;
        out.push({ kind: 'land', playerId: source.player, zone: z });
      }
      return out;
    }
    case 'this_lane_opponent_creature': {
      if (srcZone === null) return [];
      const target = opponentZoneFor(draft, source.player, srcZone);
      if (!target) return [];
      const id = player(draft, target.player).zones[target.zone]?.creature;
      return id ? [{ kind: 'creature', instanceId: id }] : [];
    }
    case 'this_lane_opponent_building': {
      if (srcZone === null) return [];
      const target = opponentZoneFor(draft, source.player, srcZone);
      if (!target) return [];
      const id = player(draft, target.player).zones[target.zone]?.building;
      return id ? [{ kind: 'building', instanceId: id }] : [];
    }
    case 'this_lane_opponent_land': {
      // Встречная земля линии источника (Крок-зачинщик).
      if (srcZone === null) return [];
      const target = opponentZoneFor(draft, source.player, srcZone);
      if (!target) return [];
      return [{ kind: 'land', playerId: target.player, zone: target.zone }];
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
    case 'this_lane_land': {
      if (srcZone === null) return [];
      return [{ kind: 'land', playerId: source.player, zone: srcZone }];
    }
    case 'this_lane_lands': {
      if (srcZone === null) return [];
      const out: ResolvedTarget[] = [{ kind: 'land', playerId: source.player, zone: srcZone }];
      const opposite = opponentZoneFor(draft, source.player, srcZone);
      if (opposite) out.push({ kind: 'land', playerId: opposite.player, zone: opposite.zone });
      return out;
    }
    case 'active_opponent_players': {
      const opponents = opponentsOf(draft, source.player);
      return draft.activePlayers
        .filter((pid) => opponents.includes(pid))
        .map((pid) => ({ kind: 'player' as const, playerId: pid }));
    }
    case 'each_creature_yours':
      return creaturesOf(draft, source.player);
    case 'each_creature_opponent':
      return opponentsOf(draft, source.player).flatMap((pid) => creaturesOf(draft, pid));
    case 'each_creature':
      return draft.order.flatMap((pid) => creaturesOf(draft, pid));
    case 'teammate_player':
      return teammatesOf(draft, source.player).map((playerId) => ({ kind: 'player' as const, playerId }));
    case 'opponent_team': {
      const teamId = draft.players[source.player]?.teamId;
      if (!teamId) return [];
      const enemy = draft.order.find(
        (pid) => pid !== source.player && draft.players[pid]?.teamId !== teamId && !draft.players[pid]!.eliminated,
      );
      return enemy ? [{ kind: 'player' as const, playerId: enemy }] : [];
    }
    case 'triggering_instance':
      return payload?.instanceId && draft.instances[payload.instanceId]
        ? [{ kind: 'creature' as const, instanceId: payload.instanceId }]
        : [];
    case 'payload_partner': {
      if (!payload?.player) return [];
      const partners = teammatesOf(draft, payload.player);
      return partners.map((playerId) => ({ kind: 'player' as const, playerId }));
    }
    case 'each_player':
      return draft.order.map((pid) => ({ kind: 'player' as const, playerId: pid }));
    case 'each_opponent_player':
      return opponentsOf(draft, source.player).map((pid) => ({ kind: 'player' as const, playerId: pid }));
    case 'each_building_yours':
      return buildingsOf(draft, source.player);
    case 'self_player':
      return [{ kind: 'player', playerId: source.player }];
    case 'each_own_creature_damaged':
      return creaturesOf(draft, source.player).filter(
        (t) => t.kind === 'creature' && draft.instances[t.instanceId]!.damage > 0,
      );
    case 'each_creature_moved_this_turn':
      return draft.order.flatMap((pid) => creaturesOf(draft, pid)).filter(
        (t) => t.kind === 'creature' && draft.instances[t.instanceId]!.movedThisTurn === true,
      );
    case 'each_own_creature_moved_this_turn':
      return creaturesOf(draft, source.player).filter(
        (t) => t.kind === 'creature' && draft.instances[t.instanceId]!.movedThisTurn === true,
      );
    case 'each_building':
      return draft.order.flatMap((pid) => buildingsOf(draft, pid));
    case 'each_land':
      return draft.order.flatMap((pid) =>
        draft.players[pid]!.lands.map((_land, zone) => ({ kind: 'land' as const, playerId: pid, zone })),
      );
    case 'attached_cards': {
      const host = source.instanceId ? draft.instances[source.instanceId] : null;
      return (host?.attached ?? []).map((id) => {
        // Real card type, not a hardcoded kind — attached cards may be creatures.
        const card = draft.instances[id] ? ctx.catalog.getCard(draft.instances[id]!.cardId) : undefined;
        return { kind: (card?.type === 'creature' ? 'creature' : 'building') as 'creature' | 'building', instanceId: id };
      });
    }
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
