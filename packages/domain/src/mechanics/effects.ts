import type { Draft } from 'immer';
import { drawCards, discardTopDeck, opponentDiscardsRandom } from '../draw';
import { dealToCreature, dealToPlayer, healPlayer } from '../damage';
import { DomainError } from '../errors';
import { finishMatch } from '../finish';
import { emit, instance, player } from '../util';
import type { Ctx } from '../util';
import type { MatchState } from '../types';
import { opponentsOf, teamOf } from '../zones';
import { enqueueTrigger } from './dispatch';
import { resolveStatAmount } from './modifiers';
import { resolveTarget, type ResolvedTarget } from './resolve';
import type { EffectSource } from './source';
import type { EffectSpec, TargetChoice, TargetFilter } from './types';

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
): void {
  switch (effect.op) {
    case 'deal_damage': {
      const targets = resolveTarget(draft, ctx, effect.target, source, choices);
      const amount = resolveStatAmount(draft, ctx, source, effect.amount);
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
      const targets = resolveTarget(draft, ctx, effect.target, source, choices);
      const amount = resolveStatAmount(draft, ctx, source, effect.amount);
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
        for (const target of resolveTarget(draft, ctx, effect.target, source, choices)) {
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
      for (const target of resolveTarget(draft, ctx, effect.target, source, choices)) {
        if (target.kind === 'player') opponentDiscardsRandom(draft, ctx, target.playerId, count);
      }
      return;
    }
    case 'stat_buff': {
      if (effect.duration === 'aura') {
        throw new DomainError('aura_not_castable', 'aura effects are scanned, never executed');
      }
      const targets = resolveTarget(draft, ctx, effect.target, source, choices);
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
    case 'flip_land': {
      for (const target of resolveTarget(draft, ctx, effect.target, source, choices)) {
        if (target.kind !== 'land') continue;
        const land = draft.players[target.playerId]!.lands[target.zone]!;
        if (land.flipped !== effect.down) continue; // already in the wanted state
        land.flipped = effect.down;
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
      const targets = resolveTarget(draft, ctx, effect.target, source, choices);
      for (const target of targets) {
        if (target.kind !== 'creature') continue;
        const inst = instance(draft, target.instanceId);
        inst.shield += effect.amount;
        emit(ctx, { type: 'shield_changed', instanceId: target.instanceId, cardId: inst.cardId, shield: inst.shield });
      }
      return;
    }
    case 'gain_actions':
      player(draft, source.player).actions += effect.amount;
      return;
  }
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
