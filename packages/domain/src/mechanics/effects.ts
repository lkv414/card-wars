import type { Draft } from 'immer';
import { drawCards, discardTopDeck, opponentDiscardsRandom } from '../draw';
import { dealToCreature, dealToPlayer, healPlayer } from '../damage';
import { DomainError } from '../errors';
import { finishMatch } from '../finish';
import { killInstance } from '../damage';
import { pickRandom, rngInt } from '../rng';
import { emit, instance, moveId, player } from '../util';
import type { Ctx } from '../util';
import type { CardData, MatchState } from '../types';
import { opponentsOf, teamOf } from '../zones';
import { enqueueLeavePlay, enqueueTrigger } from './dispatch';
import { countsAsTypes, conditionsHold, resolveStatAmount } from './modifiers';
import { resolveTarget, type ResolvedTarget } from './resolve';
import type { EffectSource } from './source';
import type { EffectSpec, TargetChoice, TargetFilter, TargetRef, TriggerPayload } from './types';

/**
 * The card instance chosen for a card-play effect (play_from_hand /
 * play_from_discard): the explicit `target` ref (a `choice` index into the
 * collected answers) or, without a ref, the first card answer collected.
 */
function resolveCardChoice(
  target: TargetRef | undefined,
  choices: TargetChoice[] | undefined,
): { instanceId: string } | null {
  if (target) {
    if (target.kind !== 'choice') return null;
    const choice = choices?.[target.index];
    return choice && choice.kind === 'card' ? { instanceId: choice.instanceId } : null;
  }
  const pick = (choices ?? []).find((c): c is Extract<TargetChoice, { kind: 'card' }> => c.kind === 'card');
  return pick ?? null;
}

/** Shared free-play of a card (play_revealed / play_from_hand): spell → on_cast,
 *  companion → slot, creature/building → destination land. */
function playFreeCard(
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  playedId: string,
  card: CardData,
  destination: TargetRef | undefined,
): void {
  const p = player(draft, source.player);
  const inst = instance(draft, playedId);
  if (card.type === 'spell') {
        inst.location = 'discard';
        p.discard.push(playedId);
        emit(ctx, { type: 'spell_cast', player: source.player, instanceId: playedId, cardId: card.id });
        draft.castSpells.push(playedId);
        bumpCounter(draft, 'spell_cast', source.player);
        const casts = (card.abilities ?? []).filter((a) => a.kind === 'passive' && a.trigger === 'on_cast');
        for (const ability of casts) {
          const abilityIndex = (card.abilities ?? []).indexOf(ability);
          ctx.frame.queue.push({
            player: source.player,
            instanceId: playedId,
            cardId: card.id,
            abilityIndex: Math.max(0, abilityIndex),
            trigger: 'on_cast',
            payload: { instanceId: playedId, cardId: card.id, player: source.player },
          });
        }
        return;
      }
      if (card.type === 'companion') {
        const replaced = p.companion;
        if (replaced) {
          const oldInst = instance(draft, replaced);
          oldInst.location = 'discard';
          oldInst.zone = null;
          oldInst.slot = null;
          p.discard.push(replaced);
          p.companion = null;
          emit(ctx, { type: 'card_discarded', player: source.player, instanceId: replaced, cardId: oldInst.cardId, from: 'companion' });
        }
        inst.location = 'companion';
        inst.zone = null;
        inst.slot = null;
        inst.playedTurn = draft.turn;
        p.companion = playedId;
        emit(ctx, { type: 'companion_played', player: source.player, instanceId: playedId, cardId: card.id, replacedInstanceId: replaced ?? null });
        bumpCounter(draft, 'creature_entered', source.player);
        enqueueTrigger(draft, ctx, 'on_enters_play', { instanceId: playedId, cardId: card.id, player: source.player, replaced: Boolean(replaced) });
        return;
      }
      // Creature or building: destination required.
      const dest = destination
        ? resolveTarget(draft, ctx, destination, source, choices, payload).find((d) => d.kind === 'land')
        : (choices ?? []).map((c) => (c.kind === 'landscape' ? { kind: 'land' as const, playerId: c.player, zone: c.zone } : null)).find((d) => d !== null);
      if (!dest || dest.kind !== 'land') {
        throw new DomainError('target_required', 'play_revealed needs a destination land');
      }
      const owner = draft.players[dest.playerId]!;
      if (dest.zone < 0 || dest.zone >= owner.zones.length) {
        throw new DomainError('invalid_choice', 'destination zone out of range');
      }
      const slot: 'creature' | 'building' = card.type === 'building' ? 'building' : 'creature';
      if (owner.zones[dest.zone]![slot]) {
        throw new DomainError('invalid_choice', `destination zone ${dest.zone} is occupied`);
      }
      inst.location = 'field';
      inst.zone = dest.zone;
      inst.slot = slot;
      inst.playedTurn = draft.turn;
      owner.zones[dest.zone]![slot] = playedId;
      emit(ctx, { type: 'card_played', player: source.player, instanceId: playedId, cardId: card.id, zone: dest.zone, slot, replacedInstanceId: null });
      bumpCounter(draft, 'creature_entered', source.player);
      if (card.type === 'creature' && card.cost >= 2) bumpCounter(draft, 'creature_cost_2_plus_played', source.player);
      enqueueTrigger(draft, ctx, 'on_enters_play', { instanceId: playedId, cardId: card.id, player: source.player, zone: dest.zone });
      return;
}

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
  // Условия самого эффекта: не выполнены — шаг пропускается (Древний школяр:
  // «Верни случайную Радужную карту… Если на этой линии строение, получи
  // 1 действие» — возврат карты безусловен, действие только при строении).
  if (effect.conditions && !conditionsHold(draft, ctx, source, effect.conditions, undefined, payload)) {
    return;
  }
  switch (effect.op) {
    case 'deal_damage': {
      const targets = resolveTarget(draft, ctx, effect.target, source, choices, payload);
      const amount = resolveStatAmount(draft, ctx, source, effect.amount, payload, choices);
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
      const amount = resolveStatAmount(draft, ctx, source, effect.amount, payload, choices);
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
      const count = resolveStatAmount(draft, ctx, source, effect.count, undefined, choices);
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
      const count = resolveStatAmount(draft, ctx, source, effect.count, undefined, choices);
      discardTopDeck(draft, ctx, source.player, count);
      return;
    }
    case 'opponent_discards': {
      const count = resolveStatAmount(draft, ctx, source, effect.count, undefined, choices);
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
      const amount = resolveStatAmount(draft, ctx, source, effect.amount, undefined, choices);
      for (const target of targets) {
        if (target.kind !== 'creature' && target.kind !== 'building') continue;
        // Per-target conditions of the effect (Мисс Пушинка: «пока 7 урона»).
        if (!conditionsHold(draft, ctx, source, effect.conditions, target.instanceId, payload)) continue;
        const inst = instance(draft, target.instanceId);
        if (effect.duration === 'this_turn') {
          draft.turnBuffs.push({
            instanceId: target.instanceId,
            stat: effect.stat,
            amount,
            grantedOnTurn: draft.turn,
            floorAttack: effect.floorAttack,
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
        if (effect.frozen) enqueueTrigger(draft, ctx, 'on_freeze', { player: target.playerId, zone: target.zone });
      }
      return;
    }
    case 'grant_protection': {
      for (const target of resolveTarget(draft, ctx, effect.target, source, choices, payload)) {
        if (target.kind !== 'creature') continue;
        if (!draft.protections.some((pr) => pr.instanceId === target.instanceId)) {
          draft.protections.push({ instanceId: target.instanceId });
        }
      }
      return;
    }
    case 'unflip': {
      for (const target of resolveTarget(draft, ctx, effect.target, source, choices, payload)) {
        if (target.kind !== 'creature') continue;
        const inst = instance(draft, target.instanceId);
        if (!inst.flipped) continue;
        inst.flipped = false;
        emit(ctx, { type: 'floop_used', player: inst.controller, instanceId: target.instanceId, cardId: inst.cardId, paidActions: 0 });
      }
      return;
    }
    case 'grant_discount': {
      draft.discounts.push({
        player: source.player,
        cardType: effect.cardType,
        amount: effect.amount,
        grantedOnTurn: draft.turn,
      });
      return;
    }
    case 'ban_spells_next_turn': {
      // Дух ниндзя: the damaged player (payload.targetPlayer) is armed; the ban
      // activates at their turn start.
      const victim = payload?.targetPlayer;
      if (!victim) return;
      if (!draft.spellBansArmed.includes(victim)) draft.spellBansArmed.push(victim);
      return;
    }
    case 'remove_token': {
      for (const target of resolveTarget(draft, ctx, effect.target, source, choices, payload)) {
        if (target.kind !== 'land') continue;
        const land = draft.players[target.playerId]!.lands[target.zone]!;
        if (land.iceTokens <= 0) {
          throw new DomainError('no_ice_token', `land ${target.zone} of ${target.playerId} has no ice token`);
        }
        land.iceTokens -= 1;
        emit(ctx, { type: 'token_changed', player: target.playerId, zone: target.zone, iceTokens: land.iceTokens });
      }
      return;
    }
    case 'transfer_token': {
      const from = resolveTarget(draft, ctx, effect.target, source, choices, payload).find((t) => t.kind === 'land');
      const to = resolveTarget(draft, ctx, effect.destination, source, choices, payload).find((t) => t.kind === 'land');
      if (!from || !to) return;
      if (from.playerId === to.playerId && from.zone === to.zone) {
        throw new DomainError('invalid_choice', 'transfer_token needs two different lands');
      }
      const fromLand = draft.players[from.playerId]!.lands[from.zone]!;
      if (fromLand.iceTokens <= 0) {
        throw new DomainError('no_ice_token', `land ${from.zone} of ${from.playerId} has no ice token`);
      }
      fromLand.iceTokens -= 1;
      const toLand = draft.players[to.playerId]!.lands[to.zone]!;
      toLand.iceTokens += 1;
      emit(ctx, { type: 'token_changed', player: from.playerId, zone: from.zone, iceTokens: fromLand.iceTokens });
      emit(ctx, { type: 'token_changed', player: to.playerId, zone: to.zone, iceTokens: toLand.iceTokens });
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
      const count = resolveStatAmount(draft, ctx, source, effect.count, payload, choices);
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
        bumpCounter(draft, 'cards_discarded', source.player);
      }
      return;
    }
    case 'return_to_owner': {
      for (const target of resolveTarget(draft, ctx, effect.target, source, choices, payload)) {
        if (target.kind !== 'creature' && target.kind !== 'building') continue;
        const inst = instance(draft, target.instanceId);
        if (inst.location !== 'field' && inst.location !== 'companion') continue;
        const prevZone = inst.zone;
        if (inst.zone !== null && inst.slot) {
          const zoneOwner = draft.players[inst.controller]!;
          if (zoneOwner.zones[inst.zone]![inst.slot] === target.instanceId) zoneOwner.zones[inst.zone]![inst.slot] = null;
        }
        if (inst.location === 'companion') draft.players[inst.controller]!.companion = null;
        inst.location = 'hand';
        inst.zone = null;
        inst.slot = null;
        inst.flipped = false;
        draft.players[inst.controller]!.hand.push(target.instanceId);
        emit(ctx, { type: 'card_returned', player: inst.controller, instanceId: target.instanceId, cardId: inst.cardId });
        enqueueLeavePlay(draft, ctx, target.instanceId, inst.cardId, inst.controller, prevZone);
      }
      return;
    }
    case 'reveal_deck_top': {
      const p = player(draft, source.player);
      const count = Math.min(effect.count, p.deck.length);
      const window: string[] = [];
      for (let i = 0; i < count; i++) window.push(p.deck[i]!);
      draft.revealed[source.player] = window;
      emit(ctx, { type: 'cards_revealed', player: source.player, cardIds: window });
      return;
    }
    case 'reveal_until': {
      const p = player(draft, source.player);
      const window = draft.revealed[source.player] ?? [];
      const match = effect.match;
      const isMatch = (cardId: string): boolean => {
        if (!match) return true;
        const card = ctx.catalog.getCard(cardId);
        if (!card) return false;
        if (match.type && card.type !== match.type) return false;
        if (match.landType && card.landType !== match.landType) return false;
        if (match.cardIds && !match.cardIds.includes(card.id)) return false;
        return true;
      };
      let cursor = window.length;
      let found = window.some((id) => isMatch(draft.instances[id]!.cardId));
      while (!found && cursor < effect.max && cursor < p.deck.length) {
        const id = p.deck[cursor]!;
        window.push(id);
        cursor += 1;
        found = isMatch(draft.instances[id]!.cardId);
      }
      draft.revealed[source.player] = window;
      if (window.length > 0) {
        emit(ctx, { type: 'cards_revealed', player: source.player, cardIds: window });
      }
      return;
    }
    case 'play_from_hand': {
      const pick = resolveCardChoice(effect.target, choices);
      if (!pick) throw new DomainError('invalid_choice', 'play_from_hand needs a hand card');
      const handInst = instance(draft, pick.instanceId);
      const handCard = ctx.catalog.getCard(handInst.cardId);
      if (!handCard || handInst.location !== 'hand' || handInst.controller !== source.player) {
        throw new DomainError('invalid_choice', 'play_from_hand needs your hand card');
      }
      if (effect.maxCost !== undefined && handCard.cost > effect.maxCost) {
        throw new DomainError('invalid_choice', `card costs more than ${effect.maxCost}`);
      }
      if (effect.match?.type && handCard.type !== effect.match.type) {
        throw new DomainError('invalid_choice', `card is not a ${effect.match.type}`);
      }
      playFreeCard(draft, ctx, source, choices, payload, pick.instanceId, handCard, effect.destination);
      return;
    }
    case 'play_from_discard': {
      // Карта выбрана из сброса (own_discard_card / any_discard_card) и играется
      // бесплатно: существо/строение → в землю, заклинание → on_cast.
      const pick = resolveCardChoice(effect.target, choices);
      if (!pick) throw new DomainError('invalid_choice', 'play_from_discard needs a discard card');
      const inst = instance(draft, pick.instanceId);
      const card = ctx.catalog.getCard(inst.cardId);
      if (!card || inst.location !== 'discard') {
        throw new DomainError('invalid_choice', 'play_from_discard needs a card from a discard pile');
      }
      // Свой сброс или любой (Последний шанс — «твоего сброса или сброса противника»).
      const owner = draft.players[inst.controller]!;
      if (effect.from !== 'any' && inst.controller !== source.player) {
        throw new DomainError('invalid_choice', 'play_from_discard needs your own discard card');
      }
      if (effect.match?.type && card.type !== effect.match.type) {
        throw new DomainError('invalid_choice', `card is not a ${effect.match.type}`);
      }
      if (effect.match?.maxCost !== undefined && card.cost > effect.match.maxCost) {
        throw new DomainError('invalid_choice', `card costs more than ${effect.match.maxCost}`);
      }
      if (effect.match?.cardIds && !effect.match.cardIds.includes(card.id)) {
        throw new DomainError('invalid_choice', 'card does not match');
      }
      // Из сброса — в игру: карта покидает стопку сброса.
      owner.discard.splice(owner.discard.indexOf(pick.instanceId), 1);
      // Карта из чужого сброса переходит под контроль владельца способности.
      inst.controller = source.player;
      inst.location = 'removed';
      playFreeCard(draft, ctx, source, choices, payload, pick.instanceId, card, effect.destination);
      return;
    }
    case 'play_revealed': {
      const p = player(draft, source.player);
      const window = draft.revealed[source.player] ?? [];
      const playedId = window[window.length - 1];
      const rest = window.slice(0, -1);
      // The rest of the window shuffles back into the deck (RNG, «перемешай»).
      draft.revealed[source.player] = [];
      delete draft.revealed[source.player];
      const deckRest = rest.filter((id) => p.deck.includes(id));
      for (const id of deckRest) {
        const idx = p.deck.indexOf(id);
        if (idx >= 0) p.deck.splice(idx, 1);
      }
      for (const id of deckRest) {
        p.deck.splice(rngInt(draft.rng, p.deck.length + 1), 0, id);
      }
      if (!playedId) return; // nothing matched — window shuffled back
      const inst = instance(draft, playedId);
      const card = ctx.catalog.getCard(inst.cardId);
      if (!card) return;
      const deckIdx = p.deck.indexOf(playedId);
      if (deckIdx >= 0) p.deck.splice(deckIdx, 1);
      playFreeCard(draft, ctx, source, choices, payload, playedId, card, effect.destination);
      return;
    }
    case 'resolve_revealed': {
      const window = draft.revealed[source.player] ?? [];
      // The revealed_card ask validates the pick on resolve_choice; the choice index
      // declared in this effect is how the lazy pipeline knows it is awaited.
      const pick = (choices ?? []).find((c): c is Extract<TargetChoice, { kind: 'card' }> => c.kind === 'card');
      if (!pick || !window.includes(pick.instanceId)) {
        throw new DomainError('invalid_choice', 'resolve_revealed needs a card of the revealed window');
      }
      const p = player(draft, source.player);
      const id = pick.instanceId;
      // Remove the picked card from the window and the deck.
      draft.revealed[source.player] = window.filter((x) => x !== id);
      const deckIndex = p.deck.indexOf(id);
      if (deckIndex >= 0) p.deck.splice(deckIndex, 1);
      const inst = instance(draft, id);
      if (effect.to === 'hand') {
        inst.location = 'hand';
        p.hand.push(id);
      } else if (effect.to === 'deck_top') {
        p.deck.splice(p.deck.indexOf(id), 1);
        p.deck.unshift(id);
      } else {
        p.deck.push(id); // bottom of deck
      }
      // Rest of the window: discarded (default) or kept in the deck (reorder).
      for (const restId of draft.revealed[source.player] ?? []) {
        if (effect.to === 'deck_top' && effect.rest === 'deck') continue;
        const restInst = instance(draft, restId);
        const restIndex = p.deck.indexOf(restId);
        if (restIndex >= 0) p.deck.splice(restIndex, 1);
        restInst.location = 'discard';
        p.discard.push(restId);
        emit(ctx, { type: 'card_discarded', player: source.player, instanceId: restId, cardId: restInst.cardId, from: 'deck' });
      }
      delete draft.revealed[source.player];
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
  if (match && filter.flipped === true && !inst.flipped) match = false;
  if (match && filter.undamaged === true && inst.damage > 0) match = false;
  if (match && filter.landType && (!card || card.landType !== filter.landType)) {
    // «считается …» overrides (Кроха слон — радужным)
    match = countsAsTypes(draft, ctx, target.instanceId).includes(filter.landType);
  }
  if (match && filter.zoneLandType) {
    const owner = draft.players[inst.controller]!;
    const zoneLand = inst.zone !== null ? owner.lands[inst.zone]!.type : null;
    if (zoneLand !== filter.zoneLandType) match = false;
  }
  if (match && filter.zoneBuilding) {
    const owner = draft.players[inst.controller]!;
    if (inst.zone === null || !owner.lands[inst.zone] || !owner.zones[inst.zone]!.building) match = false;
  }
  if (match && filter.zoneFlipped) {
    const owner = draft.players[inst.controller]!;
    if (inst.zone === null || !owner.lands[inst.zone]!.flipped) match = false;
  }
  if (match && filter.zoneToken) {
    const owner = draft.players[inst.controller]!;
    if (inst.zone === null || owner.lands[inst.zone]!.iceTokens <= 0) match = false;
  }
  if (match && filter.sameCard) {
    const ownCardId = source.instanceId ? instance(draft, source.instanceId).cardId : undefined;
    if (!card || card.id !== ownCardId) match = false;
  }
  return filter.negate ? !match : match;
}
