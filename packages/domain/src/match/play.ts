import type { Draft } from 'immer';
import { afterEffects } from '../deaths';
import { killInstance } from '../damage';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import { cardOf, emit, instance, moveId, player } from '../util';
import type { MatchState, PlayerId } from '../types';
import { isActive } from '../zones';
import { enqueueLeavePlay, enqueueTrigger } from '../mechanics/dispatch';
import { bumpCounter, noteDiscard } from '../mechanics/effects';
import { conditionsHold, consumeDiscount, frozenPlayPermitted, landCountModifier, playRestricted, playedCardCostModifier } from '../mechanics/modifiers';
import { costPicks, costPicksCount, floopCostPicks, sacrificePicks } from '../mechanics/costs';
import { validateChoices } from '../mechanics/resolve';
import type { TargetChoice } from '../mechanics/types';

function requireActiveMain(draft: Draft<MatchState>, playerId: PlayerId): void {
  if (draft.status === 'finished') throw new DomainError('match_finished', 'match is finished');
  if (draft.status !== 'running') throw new DomainError('match_not_running', 'match is not running');
  if (!isActive(draft, playerId)) throw new DomainError('not_your_turn', `not ${playerId}'s turn`);
  if (draft.players[playerId]!.battleReady) {
    throw new DomainError('wrong_phase', 'player is ready for battle');
  }
  if (draft.phase !== 'main') throw new DomainError('wrong_phase', `phase is ${draft.phase}`);
}

/** Lands matching a card's land type, including «считается за землю» modifiers (docs/RULES.md «Розыгрыш карт»). */
export function matchingLandCount(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId, landType: string): number {
  const p = player(draft, playerId);
  let count = 0;
  for (const land of p.lands) {
    if (land.flipped) continue; // face-down land counts as no type
    if (landType === 'rainbow' || land.type === 'rainbow' || land.type === landType) count++;
  }
  return count + landCountModifier(draft, ctx, playerId, landType);
}

/**
 * Play a card: creature/building into a zone slot (with frozen-land handling and
 * replacement), or a spell with on_cast abilities (docs/RULES.md «Розыгрыш карт»,
 * docs/MECHANICS-V2.md §2Б). Targets arrive with the command.
 */
export function handlePlayCard(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  instanceId: string,
  zone: number | undefined,
  unfreezeWith: string | undefined,
  targets: TargetChoice[] | undefined,
): void {
  requireActiveMain(draft, playerId);
  const p = player(draft, playerId);
  const inst = instance(draft, instanceId);
  if (inst.location !== 'hand' || inst.controller !== playerId) {
    throw new DomainError('card_not_in_hand', `instance ${instanceId} is not in ${playerId}'s hand`);
  }
  const card = cardOf(ctx, inst);

  // Cost modifiers are scanned live (Остролист, Домик из разного дерева — docs/MECHANICS-V2.md §3).
  let effectiveCost = Math.max(0, card.cost + playedCardCostModifier(draft, ctx, playerId, card, instanceId));
  // Вооружённый бесплатный розыгрыш (docs §H16): jake_2v2_card_34 / grand_prix_card_6.
  const armIdx = draft.armedFreePlays.findIndex((a) => {
    if (a.player !== playerId || a.expiresTurn < draft.turn) return false;
    if (a.landType !== undefined && a.landType !== card.landType) return false;
    if (a.maxCost !== undefined && card.cost > a.maxCost) return false;
    if (a.name === undefined) return true;
    const armedName = ctx.catalog.getCard(a.name)?.name;
    return draft.order.some((pid) =>
      p.zones === draft.players[pid]!.zones || true
        ? [0, 1, 2, 3].some((z) => {
            const bid = draft.players[pid]!.zones[z]!.building;
            const cid = draft.players[pid]!.zones[z]!.creature;
            return [bid, cid].some(
              (id) => id && ctx.catalog.getCard(draft.instances[id]!.cardId)?.name === armedName,
            );
          })
        : false,
    );
  });
  if (armIdx >= 0) {
    draft.armedFreePlays.splice(armIdx, 1);
    effectiveCost = 0;
  }
  // Помеченное действие (lsp_card_17, docs §H16): существо именно в эту зону.
  if (card.type === 'creature' && (p.earmarkedActions ?? []).some((e) => e.zone === zone) && p.actions < effectiveCost) {
    p.earmarkedActions = (p.earmarkedActions ?? []).filter((e) => e.zone !== zone);
    p.actions += 1;
  }
  if (p.actions < effectiveCost) {
    throw new DomainError('insufficient_actions', `need ${effectiveCost} actions, have ${p.actions}`);
  }

  if (matchingLandCount(draft, ctx, playerId, card.landType) < ctx.config.landRequirementPerCard) {
    throw new DomainError(
      'land_requirement_not_met',
      `no land of type ${card.landType} under control`,
    );
  }

  if (card.type === 'companion') {
    // Companions exist only in 2v2 (docs/RULES.md «Розыгрыш карт»).
    if (draft.mode !== 'teams') {
      throw new DomainError('invalid_card_type', 'companion cards are not playable in this mode');
    }
    const replaced = p.companion;
    if (replaced) {
      const oldInst = instance(draft, replaced);
      oldInst.location = 'discard';
      oldInst.zone = null;
      oldInst.slot = null;
      p.discard.push(replaced);
      p.companion = null;
      emit(ctx, {
        type: 'card_discarded',
        player: playerId,
        instanceId: replaced,
        cardId: oldInst.cardId,
        from: 'companion',
      });
    }
    p.actions -= effectiveCost;
    inst.location = 'companion';
    inst.zone = null;
    inst.slot = null;
    inst.playedTurn = draft.turn;
    p.hand.splice(p.hand.indexOf(instanceId), 1);
    p.companion = instanceId;
    draft.turnPlayedCardIds.push(card.id);
    emit(ctx, {
      type: 'companion_played',
      player: playerId,
      instanceId,
      cardId: card.id,
      replacedInstanceId: replaced ?? null,
    });
    bumpCounter(draft, 'creature_entered', playerId);
    const zoneKey = `${playerId}:${zone}`;
    draft.zoneEntersThisTurn[zoneKey] = (draft.zoneEntersThisTurn[zoneKey] ?? 0) + 1;
    enqueueTrigger(draft, ctx, 'on_enters_play', { instanceId, cardId: card.id, player: playerId, replaced: Boolean(replaced) });
    afterEffects(draft, ctx);
    return;
  }

  if (card.type === 'spell') {
    // Запрет заклинаний (Дух ниндзя, docs/MECHANICS-V2.md §3 A10).
    if (draft.spellBansActive.some((b) => b.player === playerId && b.turn === draft.turn)) {
      throw new DomainError('spells_banned', 'spells cannot be played this turn');
    }
    // Spell's own on_cast abilities: validate non-interactive targets atomically.
    const casts = (card.abilities ?? []).filter((a) => a.trigger === 'on_cast');
    // Additional cost picks come BEFORE declared asks (docs/MECHANICS-V2.md §5).
    const costAbility = casts.find((a) => a.additionalCost);
    const costSpec = costAbility?.additionalCost;
    const costCount = costPicksCount(costSpec);
    const declared = targets ?? [];
    for (const ability of casts) {
      if (Array.isArray(ability.effect) || ability.optional) continue;
      validateChoices(draft, ctx, { player: playerId, instanceId }, ability.targets, declared.slice(costCount));
    }
    const handPicks = costPicks(declared, costSpec?.discardFromHand ?? 0, playerId, draft, ctx, costSpec);
    const floopPicks = floopCostPicks(declared, costSpec?.discardFromHand ?? 0, costSpec, draft, playerId);
    const killPicks = sacrificePicks(declared, costSpec?.discardFromHand ?? 0, costSpec, draft, ctx, playerId);
    p.actions -= effectiveCost;
    for (const pickId of handPicks) {
      const pickInst = instance(draft, pickId);
      pickInst.location = 'discard';
      moveId(p.hand, p.discard, pickId);
      emit(ctx, { type: 'card_discarded', player: playerId, instanceId: pickId, cardId: pickInst.cardId, from: 'hand' });
      noteDiscard(draft, ctx, playerId, { instanceId: pickId, cardId: pickInst.cardId, from: 'hand' });
    }
    for (const pickId of floopPicks) {
      instance(draft, pickId).flipped = true;
      emit(ctx, { type: 'floop_used', player: playerId, instanceId: pickId, cardId: instance(draft, pickId).cardId, paidActions: 0 });
    }
    for (const pickId of killPicks) {
      killInstance(draft, ctx, pickId);
    }
    consumeDiscount(draft, playerId, 'spell');
    emit(ctx, { type: 'spell_cast', player: playerId, instanceId, cardId: card.id });
    inst.location = 'discard';
    moveId(p.hand, p.discard, instanceId);
    draft.castSpells.push(instanceId);
    bumpCounter(draft, 'spell_cast', playerId);
    const spellTarget = targets?.find((t) => t.kind === 'creature');
    for (const ability of casts) {
      const abilityIndex = (card.abilities ?? []).indexOf(ability);
      const hasPrecollected = !Array.isArray(ability.effect) && !ability.optional;
      ctx.frame.queue.push({
        player: playerId,
        instanceId,
        cardId: card.id,
        abilityIndex: Math.max(0, abilityIndex),
        trigger: 'on_cast',
        choices: hasPrecollected ? targets : undefined,
        payload: {
          instanceId,
          cardId: card.id,
          player: playerId,
          targetInstanceId: spellTarget?.instanceId,
        },
      });
    }
    enqueueTrigger(draft, ctx, 'on_spell_cast', {
      instanceId,
      cardId: card.id,
      player: playerId,
      targetInstanceId: spellTarget?.instanceId,
      cost: card.cost, // printed cost (Связь: «заклинание стоимостью 0»)
    });
    afterEffects(draft, ctx);
    return;
  }

  // Creature or building: a concrete zone is required.
  if (zone === undefined) throw new DomainError('zone_out_of_range', 'zone is required');
  if (zone < 0 || zone >= p.zones.length) {
    throw new DomainError('zone_out_of_range', `zone ${zone} out of range`);
  }
  const slot = card.type === 'creature' ? 'creature' : 'building';

  // Frozen land: discard a card from hand to remove the freeze first (docs/RULES.md «Земли»).
  if (p.lands[zone]!.frozen && !frozenPlayPermitted(draft, ctx, playerId, zone)) {
    if (!unfreezeWith) {
      throw new DomainError('land_frozen', `zone ${zone} is frozen; unfreezeWith required`);
    }
    const unfreezeInst = instance(draft, unfreezeWith);
    if (unfreezeInst.location !== 'hand' || unfreezeInst.controller !== playerId || unfreezeWith === instanceId) {
      throw new DomainError('unfreeze_card_invalid', 'unfreezeWith must be another card in own hand');
    }
    unfreezeInst.location = 'discard';
    moveId(p.hand, p.discard, unfreezeWith);
    p.lands[zone]!.frozen = false;
    emit(ctx, { type: 'card_discarded', player: playerId, instanceId: unfreezeWith, cardId: unfreezeInst.cardId, from: 'hand' });
    noteDiscard(draft, ctx, playerId, { instanceId: unfreezeWith, cardId: unfreezeInst.cardId, from: 'hand' });
    emit(ctx, { type: 'land_changed', player: playerId, zone, change: 'unfrozen' });
  }

  // Play-gate (docs/MECHANICS-V2.md §3): a conditions-only passive restricts
  // where/how the card may be played — «вступает в игру только на земле с
  // ледяным жетоном» (Ледяной душегуб), «играй только если …» (Пламенная мышь,
  // Костяная палочка). Zone conditions read the chosen zone.
  for (const ability of card.abilities ?? []) {
    if (ability.kind !== 'passive' || ability.effect !== undefined || ability.mechanic !== undefined) continue;
    for (const cond of ability.conditions ?? []) {
      if (cond.kind === 'while_zone_ice_token') {
        if (p.lands[zone]!.iceTokens <= 0) {
          throw new DomainError('condition_not_met', 'this card enters play only on a land with an ice token');
        }
        continue;
      }
      if (!conditionsHold(draft, ctx, { player: playerId, instanceId: null }, [cond], undefined)) {
        throw new DomainError('condition_not_met', `play condition not met: ${cond.kind}`);
      }
    }
  }

  // Ограничения чужих полей (Няш-мяш, docs §H15): «противники не могут играть
  // карты стоимостью ≤ N».
  if (playRestricted(draft, ctx, playerId, card.cost ?? 0)) {
    throw new DomainError('condition_not_met', 'play is restricted by an opposing card');
  }

  // Replacement: the old card goes to the discard pile; its own bonuses are lost with it.
  const zoneState = p.zones[zone]!;
  const replaced = zoneState[slot];
  let replacedCardId: string | null = null;
  if (replaced) {
    const oldInst = instance(draft, replaced);
    replacedCardId = oldInst.cardId;
    oldInst.location = 'discard';
    oldInst.zone = null;
    oldInst.slot = null;
    p.discard.push(replaced);
    zoneState[slot] = null;
    emit(ctx, { type: 'card_discarded', player: playerId, instanceId: replaced, cardId: oldInst.cardId, from: 'field' });
  }

  p.actions -= effectiveCost;
  consumeDiscount(draft, playerId, card.type === 'creature' ? 'creature' : 'building');
  draft.turnPlayedCardIds.push(card.id);
  inst.location = 'field';
  inst.zone = zone;
  inst.slot = slot;
  inst.playedTurn = draft.turn;
  p.hand.splice(p.hand.indexOf(instanceId), 1);
  zoneState[slot] = instanceId;
  emit(ctx, {
    type: 'card_played',
    player: playerId,
    instanceId,
    cardId: card.id,
    zone,
    slot,
    replacedInstanceId: replaced ?? null,
  });

  bumpCounter(draft, 'creature_entered', playerId);
  const enterKey = `${playerId}:${zone}`;
  draft.zoneEntersThisTurn[enterKey] = (draft.zoneEntersThisTurn[enterKey] ?? 0) + 1;
  if (card.type === 'creature' && card.cost >= 2) bumpCounter(draft, 'creature_cost_2_plus_played', playerId);
  enqueueTrigger(draft, ctx, 'on_enters_play', { instanceId, cardId: card.id, player: playerId, zone, replaced: Boolean(replaced) });
  enqueueTrigger(draft, ctx, 'on_card_played', { instanceId, cardId: card.id, player: playerId, cost: effectiveCost, zone });
  if (replaced) {
    enqueueLeavePlay(draft, ctx, replaced, replacedCardId ?? '', playerId, zone);
  }
  afterEffects(draft, ctx);
}
