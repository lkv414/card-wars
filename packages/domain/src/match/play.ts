import type { Draft } from 'immer';
import { afterEffects } from '../deaths';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import { cardOf, emit, instance, moveId, player } from '../util';
import type { MatchState, PlayerId } from '../types';
import { isActive } from '../zones';

function requireActiveMain(draft: Draft<MatchState>, playerId: PlayerId): void {
  if (draft.status === 'finished') throw new DomainError('match_finished', 'match is finished');
  if (draft.status !== 'running') throw new DomainError('match_not_running', 'match is not running');
  if (!isActive(draft, playerId)) throw new DomainError('not_your_turn', `not ${playerId}'s turn`);
  if (draft.players[playerId]!.battleReady) {
    throw new DomainError('wrong_phase', 'player is ready for battle');
  }
  if (draft.phase !== 'main') throw new DomainError('wrong_phase', `phase is ${draft.phase}`);
}

/** Lands matching a card's land type (docs/RULES.md «Розыгрыш карт»). */
export function matchingLandCount(draft: Draft<MatchState>, playerId: PlayerId, landType: string): number {
  const p = player(draft, playerId);
  let count = 0;
  for (const land of p.lands) {
    if (land.flipped) continue; // face-down land counts as no type
    if (landType === 'rainbow' || land.type === 'rainbow' || land.type === landType) count++;
  }
  return count;
}

/**
 * Play a card: creature/building into a zone slot (with frozen-land handling and
 * replacement), or a spell into the discard with a turn-long visual
 * (docs/RULES.md «Розыгрыш карт»). Card abilities arrive with the mechanics v2
 * system (docs/TECH.md № 2).
 */
export function handlePlayCard(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  instanceId: string,
  zone: number | undefined,
  unfreezeWith: string | undefined,
): void {
  requireActiveMain(draft, playerId);
  const p = player(draft, playerId);
  const inst = instance(draft, instanceId);
  if (inst.location !== 'hand' || inst.controller !== playerId) {
    throw new DomainError('card_not_in_hand', `instance ${instanceId} is not in ${playerId}'s hand`);
  }
  const card = cardOf(ctx, inst);

  if (p.actions < card.cost) {
    throw new DomainError('insufficient_actions', `need ${card.cost} actions, have ${p.actions}`);
  }

  if (matchingLandCount(draft, playerId, card.landType) < ctx.config.landRequirementPerCard) {
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
    p.actions -= card.cost;
    inst.location = 'companion';
    inst.zone = null;
    inst.slot = null;
    inst.playedTurn = draft.turn;
    p.hand.splice(p.hand.indexOf(instanceId), 1);
    p.companion = instanceId;
    emit(ctx, {
      type: 'companion_played',
      player: playerId,
      instanceId,
      cardId: card.id,
      replacedInstanceId: replaced ?? null,
    });
    afterEffects(draft, ctx);
    return;
  }

  if (card.type === 'spell') {
    p.actions -= card.cost;
    inst.location = 'discard';
    moveId(p.hand, p.discard, instanceId);
    draft.castSpells.push(instanceId);
    emit(ctx, { type: 'spell_cast', player: playerId, instanceId, cardId: card.id });
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
  if (p.lands[zone]!.frozen) {
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
    emit(ctx, { type: 'land_changed', player: playerId, zone, change: 'unfrozen' });
  }

  // Replacement: the old card goes to the discard pile; its own bonuses are lost with it.
  const zoneState = p.zones[zone]!;
  const replaced = zoneState[slot];
  if (replaced) {
    const oldInst = instance(draft, replaced);
    oldInst.location = 'discard';
    oldInst.zone = null;
    oldInst.slot = null;
    p.discard.push(replaced);
    zoneState[slot] = null;
    emit(ctx, { type: 'card_discarded', player: playerId, instanceId: replaced, cardId: oldInst.cardId, from: 'field' });
  }

  p.actions -= card.cost;
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

  afterEffects(draft, ctx);
}
