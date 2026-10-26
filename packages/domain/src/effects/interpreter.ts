import type { Draft } from 'immer';
import { DomainError } from '../errors';
import { drawCards, discardTopDeck, opponentDiscardsRandom, returnFromDiscard } from '../draw';
import { finishMatch } from '../finish';
import { cardOf, emit, instance, player } from '../util';
import type { Ctx } from '../util';
import { dealToCreature, dealToPlayer, healPlayer, killInstance } from '../damage';
import { teamOf, opponentsOf } from '../zones';
import { checkConditions, grantPermanentBonus } from './stats';
import { resolveTargets } from './targets';
import type { EffectSource } from './targets';
import type { CommandChoices } from '../commands';
import type {
  AbilityData,
  EffectSpec,
  HeroData,
  MatchState,
  PlayerId,
  TriggerKind,
} from '../types';

/** Execute one effect spec against the current board. */
export function runEffect(
  draft: Draft<MatchState>,
  ctx: Ctx,
  effect: EffectSpec,
  source: EffectSource,
  choices: CommandChoices | undefined,
): void {
  switch (effect.op) {
    case 'deal_damage': {
      const refs = resolveTargets(draft, ctx, effect.target, source, choices);
      for (const ref of refs) {
        if (ref.kind === 'creature') {
          dealToCreature(draft, ctx, ref.instanceId, effect.amount, source.instanceId, effect.pierce ?? false);
        } else if (ref.kind === 'player') {
          dealToPlayer(draft, ctx, ref.playerId, effect.amount, source.instanceId);
        }
      }
      return;
    }
    case 'heal': {
      const refs = resolveTargets(draft, ctx, effect.target, source, choices);
      for (const ref of refs) {
        if (ref.kind === 'creature') {
          const inst = instance(draft, ref.instanceId);
          const healed = Math.min(effect.amount, inst.damage);
          inst.damage -= healed;
          if (healed > 0) emit(ctx, { type: 'creature_healed', instanceId: ref.instanceId, amount: healed });
        } else if (ref.kind === 'player') {
          healPlayer(draft, ctx, ref.playerId, effect.amount);
        }
      }
      return;
    }
    case 'draw_cards':
      drawCards(draft, ctx, source.player, effect.count);
      return;
    case 'discard_top':
      discardTopDeck(draft, ctx, source.player, effect.count);
      return;
    case 'opponent_discards': {
      const refs = resolveTargets(draft, ctx, effect.target, source, choices);
      for (const ref of refs) {
        if (ref.kind === 'player') opponentDiscardsRandom(draft, ctx, ref.playerId, effect.count);
      }
      return;
    }
    case 'return_from_discard':
      returnFromDiscard(draft, ctx, source.player, effect.filter, effect.random ?? false);
      return;
    case 'destroy': {
      const refs = resolveTargets(draft, ctx, effect.target, source, choices);
      for (const ref of refs) {
        if (ref.kind !== 'creature' && ref.kind !== 'player') continue;
        if (ref.kind === 'player') continue;
        const inst = instance(draft, ref.instanceId);
        if (inst.location !== 'field' && inst.location !== 'companion') continue;
        const removed = killInstance(draft, ctx, ref.instanceId);
        emit(ctx, { type: 'creature_destroyed', instanceId: ref.instanceId, cardId: removed.cardId });
      }
      return;
    }
    case 'stat_buff': {
      const refs = resolveTargets(draft, ctx, effect.target, source, choices);
      const p = player(draft, source.player);
      const amount =
        typeof effect.amount === 'number'
          ? effect.amount
          : Math.floor(p.discard.length / effect.amount.perDiscardEvery) * effect.amount.amount;
      for (const ref of refs) {
        if (ref.kind !== 'creature') continue;
        if ((effect.duration ?? 'permanent') === 'permanent') {
          grantPermanentBonus(draft, ctx, ref.instanceId, effect.stat, amount);
        } else {
          draft.tempBuffs.push({
            instanceId: ref.instanceId,
            stat: effect.stat,
            amount,
            grantedOnTurn: draft.turn,
          });
          const inst = instance(draft, ref.instanceId);
          emit(ctx, {
            type: 'bonus_changed',
            instanceId: ref.instanceId,
            cardId: inst.cardId,
            bonusAttack: inst.bonusAttack,
            bonusDefense: inst.bonusDefense,
          });
        }
      }
      return;
    }
    case 'gain_actions':
      player(draft, source.player).actions += effect.amount;
      return;
    case 'gain_shield': {
      const refs = resolveTargets(draft, ctx, effect.target, source, choices);
      for (const ref of refs) {
        if (ref.kind !== 'creature') continue;
        const inst = instance(draft, ref.instanceId);
        inst.shield += effect.amount;
        emit(ctx, { type: 'shield_changed', instanceId: ref.instanceId, cardId: inst.cardId, shield: inst.shield });
      }
      return;
    }
    case 'freeze_landscape': {
      const refs = resolveTargets(draft, ctx, effect.target, source, choices);
      for (const ref of refs) {
        if (ref.kind !== 'land') continue;
        const p = player(draft, ref.playerId);
        const land = p.lands[ref.zone]!;
        if (!land.frozen) {
          land.frozen = true;
          emit(ctx, { type: 'land_changed', player: ref.playerId, zone: ref.zone, change: 'frozen' });
        }
      }
      return;
    }
    case 'win_if_opponents_deck_empty': {
      if (draft.status === 'finished') return;
      const opponents = opponentsOf(draft, source.player);
      const allEmpty =
        opponents.length > 0 && opponents.every((pid) => draft.players[pid]!.deck.length === 0);
      if (allEmpty) {
        const team = teamOf(draft, source.player);
        finishMatch(draft, ctx, team ? [...team.playerIds] : [source.player], 'elimination');
      }
      return;
    }
  }
}

function runAbility(
  draft: Draft<MatchState>,
  ctx: Ctx,
  ability: AbilityData,
  source: EffectSource,
  choices: CommandChoices | undefined,
): void {
  if (!ability.effect) return;
  if (!checkConditions(draft, ability.conditions, source.player)) return;
  try {
    runEffect(draft, ctx, ability.effect, source, choices);
  } catch (error) {
    // Automatic triggers (on_death, start_of_turn, auras) have no player to ask
    // for a target: skip such effects instead of aborting the whole transition.
    if (!choices && error instanceof DomainError && error.code === 'target_required') return;
    throw error;
  }
}

/** Fire a trigger for one specific in-play instance (on_enters_play, on_death, …). */
export function fireTriggerForInstance(
  draft: Draft<MatchState>,
  ctx: Ctx,
  trigger: TriggerKind,
  instanceId: string,
  choices?: CommandChoices,
): void {
  const inst = instance(draft, instanceId);
  const card = cardOf(ctx, inst);
  const source: EffectSource = { player: inst.controller, instanceId };
  for (const ability of card.abilities) {
    if (ability.kind !== 'passive' || ability.trigger !== trigger) continue;
    runAbility(draft, ctx, ability, source, choices);
  }
}

/** Fire a trigger for every in-play card of a player (start_of_turn). */
export function fireTriggerForPlayer(
  draft: Draft<MatchState>,
  ctx: Ctx,
  trigger: TriggerKind,
  playerId: PlayerId,
): void {
  const p = player(draft, playerId);
  const ids: string[] = [];
  for (const zone of p.zones) {
    if (zone.creature) ids.push(zone.creature);
    if (zone.building) ids.push(zone.building);
  }
  if (p.companion) ids.push(p.companion);
  for (const id of ids) fireTriggerForInstance(draft, ctx, trigger, id);
}

/** Hero passive (docs/CARDS.md «Герои»); runs at the trigger point of its ability. */
export function runHeroAbility(
  draft: Draft<MatchState>,
  ctx: Ctx,
  hero: HeroData,
  playerId: PlayerId,
): void {
  const ability = hero.ability;
  if (ability.effect && ability.kind === 'passive' && ability.trigger === 'start_of_turn') {
    runAbility(draft, ctx, ability, { player: playerId, instanceId: null }, undefined);
  }
}

/** Execute floop abilities of a card (kind === 'floop'); conditions checked per ability. */
export function runFloopAbilities(
  draft: Draft<MatchState>,
  ctx: Ctx,
  instanceId: string,
  choices: CommandChoices | undefined,
): void {
  const inst = instance(draft, instanceId);
  const card = cardOf(ctx, inst);
  const floops = card.abilities.filter((a) => a.kind === 'floop');
  if (floops.length === 0) {
    throw new DomainError('card_has_no_floop', `card ${card.id} has no floop ability`);
  }
  const source: EffectSource = { player: inst.controller, instanceId };
  for (const ability of floops) {
    runAbility(draft, ctx, ability, source, choices);
  }
}

/** Spells resolve all their abilities immediately on cast (docs/RULES.md «Розыгрыш карт»). */
export function runSpellAbilities(
  draft: Draft<MatchState>,
  ctx: Ctx,
  instanceId: string,
  choices: CommandChoices | undefined,
): void {
  const inst = instance(draft, instanceId);
  const card = cardOf(ctx, inst);
  const source: EffectSource = { player: inst.controller, instanceId };
  for (const ability of card.abilities) {
    runAbility(draft, ctx, ability, source, choices);
  }
}
