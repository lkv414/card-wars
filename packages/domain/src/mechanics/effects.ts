import type { Draft } from 'immer';
import { drawCards, discardTopDeck, opponentDiscardsRandom } from '../draw';
import { dealToCreature, dealToPlayer, healPlayer } from '../damage';
import { DomainError } from '../errors';
import { finishMatch } from '../finish';
import { killInstance } from '../damage';
import { pickRandom } from '../rng';
import { emit, instance, moveId, player } from '../util';
import type { Ctx } from '../util';
import type { MatchState } from '../types';
import { opponentsOf, teamOf } from '../zones';
import { enqueueTrigger } from './dispatch';
import { resolveStatAmount } from './modifiers';
import { resolveTarget, type ResolvedTarget } from './resolve';
import type { EffectSource } from './source';
import type { EffectSpec, TargetChoice, TargetFilter, TriggerPayload } from './types';

/**
 * Execute one declarative effect (docs/MECHANICS-V2.md §3). Aura specs never
 * reach the interpreter — they are scanned by modifiers.ts; the union grows
 * per milestone and unknown ops are rejected explicitly.
 */
export function runEffect(
  draft: Draft<MatchState>,
  ctx: Ctx,
  effect: EffectSpec,
  source: EffectSource,
  choices: TargetChoice[] | undefined,
  payload?: TriggerPayload,
): void {
  switch (effect.op) {
    case 'deal_damage': {
      const targets = resolveTarget(draft, ctx, effect.target, source, choices, payload);
      const amount = resolveStatAmount(draft, ctx, source, effect.amount, payload);
      for (const target of targets) {
        if (effect.filter && !targetMatchesFilter(draft, ctx, source, target, effect.filter)) continue;
        if (target.kind === 'creature' || target.kind === 'building') {
          dealToCreature(draft, ctx, target.instanceId, amount, source.instanceId, effect.pierce ?? false);
        } else if (target.kind === 'player') {
          dealToPlayer(draft, ctx, target.playerId, amount, source.instanceId);
        }
      }
      return;
    }
    case 'heal': {
      const targets = resolveTarget(draft, ctx, effect.target, source, choices, payload);
      const amount = resolveStatAmount(draft, ctx, source, effect.amount, payload);
      for (const target of targets) {
        if (target.kind === 'creature' || target.kind === 'building') {
          const inst = instance(draft, target.instanceId);
          const healed = Math.min(amount, inst.damage);
          inst.damage -= healed;
          if (healed > 0) emit(ctx, { type: 'creature_healed', instanceId: target.instanceId, amount: healed });
        } else if (target.kind === 'player') {
          healPlayer(draft, ctx, target.playerId, amount);
        }
      }
      return;
    }
    case 'draw_cards': {
      const count = resolveStatAmount(draft, ctx, source, effect.count);
      if (count <= 0) return;
      if (effect.target) {
        for (const target of resolveTarget(draft, ctx, effect.target, source, choices, payload)) {
          if (target.kind === 'player') drawCards(draft, ctx, target.playerId, count);
        }
        return;
      }
      drawCards(draft, ctx, source.player, count);
      return;
    }
    case 'discard_top_deck': {
      const count = resolveStatAmount(draft, ctx, source, effect.count);
      discardTopDeck(draft, ctx, source.player, count);
      return;
    }
    case 'opponent_discards': {
      const count = resolveStatAmount(draft, ctx, source, effect.count);
      if (count <= 0) return;
      for (const target of resolveTarget(draft, ctx, effect.target, source, choices, payload)) {
        if (target.kind === 'player') opponentDiscardsRandom(draft, ctx, target.playerId, count);
      }
      return;
    }
    case 'stat_buff': {
      if (effect.duration === 'aura') {
        throw new DomainError('aura_not_castable', 'aura effects are scanned, never executed');
      }
      const targets = resolveTarget(draft, ctx, effect.target, source, choices, payload);
      const amount = resolveStatAmount(draft, ctx, source, effect.amount);
      for (const target of targets) {
        if (target.kind !== 'creature' && target.kind !== 'building') continue;
        const inst = instance(draft, target.instanceId);
        if (effect.duration === 'this_turn') {
          draft.turnBuffs.push({
            instanceId: target.instanceId,
            stat: effect.stat,
            amount,
            grantedOnTurn: draft.turn,
          });
        } else if (effect.stat === 'attack') inst.bonusAttack += amount;
        else inst.bonusDefense += amount;
        emit(ctx, {
          type: 'bonus_changed',
          instanceId: target.instanceId,
          cardId: inst.cardId,
          bonusAttack: inst.bonusAttack,
          bonusDefense: inst.bonusDefense,
        });
      }
      return;
    }
    case 'destroy': {
      for (const target of resolveTarget(draft, ctx, effect.target, source, choices, payload)) {
        if (target.kind !== 'creature' && target.kind !== 'building') continue;
        const removed = killInstance(draft, ctx, target.instanceId);
        emit(ctx, { type: 'creature_destroyed', instanceId: target.instanceId, cardId: removed.cardId });
      }
      return;
    }
    case 'move_creature': {
      const movers = resolveTarget(draft, ctx, effect.target, source, choices, payload);
      const destinations = resolveTarget(draft, ctx, effect.destination, source, choices, payload);
      const dest = destinations[0];
      if (!dest || dest.kind !== 'land') {
        throw new DomainError('invalid_choice', 'move_creature needs a destination zone');
      }
      for (const mover of movers) {
        if (mover.kind !== 'creature') continue;
        moveCreatureToZone(draft, ctx, mover.instanceId, dest.playerId, dest.zone, effect.side);
      }
      return;
    }
    case 'freeze_land': {
      for (const target of resolveTarget(draft, ctx, effect.target, source, choices, payload)) {
        if (target.kind !== 'land') continue;
        const land = draft.players[target.playerId]!.lands[target.zone]!;
        if (land.frozen === effect.frozen) continue;
        land.frozen = effect.frozen;
        emit(ctx, { type: 'land_changed', player: target.playerId, zone: target.zone, change: effect.frozen ? 'frozen' : 'unfrozen' });
      }
      return;
    }
    case 'flip_land': {
      for (const target of resolveTarget(draft, ctx, effect.target, source, choices, payload)) {
        if (target.kind !== 'land') continue;
        const land = draft.players[target.playerId]!.lands[target.zone]!;
        if (land.flipped === effect.down) continue; // already in the wanted state
        land.flipped = effect.down;
        if (effect.until === 'next_own_turn') {
          draft.landFlipEffects.push({ owner: source.player, zone: target.zone, down: effect.down, grantedOnTurn: draft.turn });
        }
        emit(ctx, { type: 'land_changed', player: target.playerId, zone: target.zone, change: effect.down ? 'flipped' : 'unflipped' });
        enqueueTrigger(draft, ctx, 'on_flip', { player: target.playerId, zone: target.zone });
      }
      return;
    }
    case 'win_if_opponents_deck_empty': {
      if (draft.status === 'finished') return;
      const opponents = opponentsOf(draft, source.player);
      const allEmpty = opponents.length > 0 && opponents.every((pid) => draft.players[pid]!.deck.length === 0);
      if (allEmpty) {
        const team = teamOf(draft, source.player);
        finishMatch(draft, ctx, team ? [...team.playerIds] : [source.player], 'elimination');
      }
      return;
    }
    case 'gain_shield': {
      const targets = resolveTarget(draft, ctx, effect.target, source, choices, payload);
      for (const target of targets) {
        if (target.kind !== 'creature') continue;
        const inst = instance(draft, target.instanceId);
        inst.shield += effect.amount;
        emit(ctx, { type: 'shield_changed', instanceId: target.instanceId, cardId: inst.cardId, shield: inst.shield });
      }
      return;
    }
    case 'return_from_discard': {
      const count = resolveStatAmount(draft, ctx, source, effect.count, payload);
      returnCards(draft, ctx, source, effect, count);
      return;
    }
    case 'discard_from_hand': {
      const asks = effect.count;
      const picks = (choices ?? []).filter((c) => c.kind === 'card');
      const p = player(draft, source.player);
      for (const pick of picks.slice(0, asks)) {
        const inst = instance(draft, pick.instanceId);
        if (inst.location !== 'hand' || inst.controller !== source.player) {
          throw new DomainError('invalid_choice', 'discard_from_hand needs own hand cards');
        }
      }
      for (const pick of picks.slice(0, asks)) {
        const inst = instance(draft, pick.instanceId);
        inst.location = 'discard';
        moveId(p.hand, p.discard, inst.id);
        emit(ctx, { type: 'card_discarded', player: source.player, instanceId: inst.id, cardId: inst.cardId, from: 'hand' });
      }
      return;
    }
    case 'grant_ability': {
      // Aura-grant: read live by the floop gate; nothing to materialise.
      return;
    }
    case 'gain_actions':
      player(draft, source.player).actions += effect.amount;
      return;
    case 'grant_modifier':
      draft.turnModifiers.push({
        instanceId: source.instanceId ?? '',
        effect: effect.modifier,
        grantedOnTurn: draft.turn,
        duration: effect.duration ?? 'this_turn',
      });
      return;
  }
}

/** Move one field creature to an empty zone (own or any side) and fire on_line_change. */
function moveCreatureToZone(
  draft: Draft<MatchState>,
  ctx: Ctx,
  instanceId: string,
  destPlayerId: string,
  zone: number,
  side: 'own' | 'any',
): void {
  const inst = instance(draft, instanceId);
  if (inst.location !== 'field' || inst.slot !== 'creature' || inst.zone === null) return;
  // The creature keeps its controller; movement is within the owner's lanes
  // (side 'any' reserved for future cross-side effects).
  if (destPlayerId !== inst.controller) return;
  const owner = draft.players[destPlayerId]!;
  if (zone < 0 || zone >= owner.zones.length) return;
  if (zone === inst.zone) return;
  const target = owner.zones[zone]!;
  if (target.creature) return; // destination must be empty
  const fromZone = inst.zone;
  owner.zones[fromZone]!.creature = null;
  inst.zone = zone;
  owner.zones[zone]!.creature = instanceId;
  emit(ctx, { type: 'card_moved', player: destPlayerId, instanceId, fromZone, toZone: zone });
  bumpCounter(draft, 'line_change', destPlayerId);
  enqueueTrigger(draft, ctx, 'on_line_change', { instanceId, player: destPlayerId, zone });
}

/** Return cards from the discard pile (random or first match, filter by data). */
function returnCards(
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  effect: Extract<EffectSpec, { op: 'return_from_discard' }>,
  count: number,
): void {
  const p = player(draft, source.player);
  for (let i = 0; i < count; i++) {
    const candidates = p.discard.filter((id) => {
      const inst = instance(draft, id);
      const card = ctx.catalog.getCard(inst.cardId);
      if (!card) return false;
      if (effect.filter?.type && card.type !== effect.filter.type) return false;
      if (effect.filter?.landType && card.landType !== effect.filter.landType) return false;
      if (effect.filter?.cost !== undefined && card.cost !== effect.filter.cost) return false;
      return true;
    });
    const chosen = effect.random ? pickRandom(draft.rng, candidates) : candidates[0];
    if (!chosen) return;
    const inst = instance(draft, chosen);
    p.discard.splice(p.discard.indexOf(chosen), 1);
    if (effect.to === 'deck_top') {
      inst.location = 'deck';
      p.deck.unshift(chosen);
    } else {
      inst.location = 'hand';
      p.hand.push(chosen);
    }
    emit(ctx, { type: 'card_returned', player: source.player, instanceId: chosen, cardId: inst.cardId });
  }
}

/** Increment a per-turn event counter (key `kind:player`). */
export function bumpCounter(draft: Draft<MatchState>, kind: string, playerId: string): void {
  const key = `${kind}:${playerId}`;
  draft.turnCounters[key] = (draft.turnCounters[key] ?? 0) + 1;
}

/** Board filter for damage targets: card or zone-land based, invertible. */
function targetMatchesFilter(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  source: EffectSource,
  target: ResolvedTarget,
  filter: TargetFilter,
): boolean {
  if (target.kind !== 'creature' && target.kind !== 'building') return !filter.negate;
  const inst = instance(draft, target.instanceId);
  const card = ctx.catalog.getCard(inst.cardId);
  let match = true;
  if (filter.ready && inst.flipped) match = false;
  if (match && filter.landType && (!card || card.landType !== filter.landType)) match = false;
  if (match && filter.zoneLandType) {
    const owner = draft.players[inst.controller]!;
    const zoneLand = inst.zone !== null ? owner.lands[inst.zone]!.type : null;
    if (zoneLand !== filter.zoneLandType) match = false;
  }
  if (match && filter.sameCard) {
    const ownCardId = source.instanceId ? instance(draft, source.instanceId).cardId : undefined;
    if (!card || card.id !== ownCardId) match = false;
  }
  return filter.negate ? !match : match;
}
