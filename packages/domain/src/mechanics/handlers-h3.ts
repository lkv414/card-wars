import type { Draft } from 'immer';
import { dealToCreature, dealToPlayer, killInstance } from '../damage';
import { DomainError } from '../errors';
import { emit, instance, player } from '../util';
import { computeEff } from '../stats';
import { opponentsOf, teammatesOf } from '../zones';
import { pickRandom } from '../rng';
import type { Ctx } from '../util';
import type { MatchState } from '../types';
import type { EffectSource, MechanicHandler } from './registry';
import { noteDiscard } from './effects';

/**
 * Move a field creature to an empty zone, keeping its controller (docs §H3).
 * Returns false when no destination exists.
 */
function moveToEmptyZone(
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  ownOnly: boolean,
): boolean {
  const id = source.instanceId;
  if (!id) return false;
  const inst = instance(draft, id);
  if (inst.location !== 'field' || inst.slot !== 'creature' || inst.zone === null) return false;
  const from = inst.zone;
  const candidates = ownOnly
    ? [source.player]
    : [source.player, ...opponentsOf(draft, source.player)];
  for (const pid of candidates) {
    const p = draft.players[pid]!;
    const zone = p.zones.findIndex((z) => !z.creature);
    if (zone < 0) continue;
    draft.players[inst.controller]!.zones[from]!.creature = null;
    p.zones[zone]!.creature = id;
    inst.zone = zone;
    inst.movedThisTurn = true;
    emit(ctx, { type: 'card_moved', player: pid, instanceId: id, fromZone: from, toZone: zone });
    return true;
  }
  return false;
}

/** «В начале своего хода перемести … на пустую землю; иначе …» (docs §H3). */
export const startTurnMoveOrDiscard: MechanicHandler = (draft, ctx, source, params) => {
  if (!source.instanceId) return;
  const wantOpponent = params?.fallback === 'opponent_land';
  if (moveToEmptyZone(draft, ctx, source, !wantOpponent)) return;
  killInstance(draft, ctx, source.instanceId);
};

/** «Когда … вступает в игру, перемести его на пустую землю» (поп-десанты). */
export const enterMoveToEmpty: MechanicHandler = (draft, ctx, source, params) => {
  if (!moveToEmptyZone(draft, ctx, source, true)) return;
  if (params?.flipLand === true && source.instanceId) {
    const inst = instance(draft, source.instanceId);
    if (inst.zone !== null) {
      const land = player(draft, source.player).lands[inst.zone]!;
      land.flipped = true;
      emit(ctx, { type: 'land_changed', player: source.player, zone: inst.zone, change: 'flipped' });
    }
  }
};

/** «Выбери существо и нанеси себе урон равный остатку DEF, затем уничтожь его». */
export const selfDamageThenDestroy: MechanicHandler = (draft, ctx, source, _params, choices) => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') return;
  const inst = instance(draft, pick.instanceId);
  const remaining = Math.max(0, computeEff(draft, ctx, pick.instanceId).defense - inst.damage);
  if (remaining > 0) dealToPlayer(draft, ctx, source.player, remaining, null);
  killInstance(draft, ctx, pick.instanceId);
};

/**
 * «Выбранный враг сбрасывает карту стоимостью N или более. Если нет — …»
 * (Марселина, docs §H12). The victim discards a RANDOM eligible card (the
 * printed text does not grant the victim a choice and a cross-player pending
 * would stall the spell); the fallback hits the player or their creatures.
 */
export const discardMinCostOrDamage: MechanicHandler = (draft, ctx, source, params, choices) => {
  const minCost = Number(params?.minCost ?? 0);
  const amount = Number(params?.amount ?? 0);
  const to = params?.to === 'creatures' ? 'creatures' : 'player';
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'player') throw new DomainError('invalid_choice', 'discard_min_cost_or_damage needs a player');
  const victim = draft.players[pick.playerId]!;
  const eligible = victim.hand.filter((id) => (ctx.catalog.getCard(instance(draft, id).cardId)?.cost ?? 0) >= minCost);
  if (eligible.length > 0) {
    const stolen = pickRandom(draft.rng, eligible);
    if (!stolen) return;
    const inst = instance(draft, stolen);
    inst.location = 'discard';
    victim.hand = victim.hand.filter((x) => x !== stolen);
    victim.discard.push(stolen);
    emit(ctx, { type: 'card_discarded', player: pick.playerId, instanceId: stolen, cardId: inst.cardId, from: 'hand' });
    noteDiscard(draft, ctx, pick.playerId, { instanceId: stolen, cardId: inst.cardId, from: 'hand' });
    return;
  }
  if (to === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, amount, source.instanceId);
    return;
  }
  for (const pid of [pick.playerId, ...teammatesOf(draft, pick.playerId)]) {
    const p = draft.players[pid]!;
    for (const zone of p.zones) {
      if (!zone.creature) continue;
      dealToCreature(draft, ctx, zone.creature, amount, source.instanceId);
    }
  }
};

/**
 * Кошачьи жизни (Муррризрак, docs §H15): воскреснуть в свою зону с полными
 * жизнями. oncePerGame на способности гарантирует однократность.
 */
export const catLives: MechanicHandler = (draft, ctx, source, _params, _choices, payload) => {
  const id = source.instanceId;
  if (!id || payload?.zone === undefined || payload.zone === null) return;
  const inst = instance(draft, id);
  if (inst.location !== 'discard') return;
  const zone = draft.players[inst.controller]!.zones[payload.zone]!;
  if (zone.creature) return; // зона занята — воскрешение не проходит
  const owner = draft.players[inst.controller]!;
  owner.discard = owner.discard.filter((x) => x !== id);
  inst.location = 'field';
  inst.zone = payload.zone;
  inst.slot = 'creature';
  inst.damage = 0;
  inst.cannotReturnFromDiscard = true; // «после этого нельзя вернуть из сброса»
  zone.creature = id;
  emit(ctx, {
    type: 'card_played',
    player: inst.controller,
    instanceId: id,
    cardId: inst.cardId,
    zone: payload.zone,
    slot: 'creature',
    replacedInstanceId: null,
  });
};

/** «Укради случайную карту с руки противника и сыграй её бесплатно». */
export const stealAndPlayFromHand: MechanicHandler = (draft, ctx, source, _params, choices) => {
  const picked = choices?.[0];
  if (!picked || picked.kind !== 'player') return;
  const victim = draft.players[picked.playerId];
  if (!victim || victim.hand.length === 0) return;
  const stolen = pickRandom(draft.rng, victim.hand);
  if (!stolen) return;
  victim.hand = victim.hand.filter((id) => id !== stolen);
  const inst = instance(draft, stolen);
  const card = ctx.catalog.getCard(inst.cardId);
  inst.controller = source.player;
  const me = player(draft, source.player);
  if (card?.type === 'creature' || card?.type === 'building') {
    const slot = card.type === 'building' ? 'building' : 'creature';
    const zone = me.zones.findIndex((z) => !z[slot]);
    if (zone >= 0) {
      inst.location = 'field';
      inst.zone = zone;
      inst.slot = slot;
      inst.enteredThisTurn = true;
      me.zones[zone]![slot] = stolen;
      emit(ctx, {
        type: 'card_played', player: source.player, instanceId: stolen, cardId: inst.cardId,
        zone, slot, replacedInstanceId: null,
      });
      return;
    }
  }
  inst.location = 'discard';
  inst.zone = null;
  inst.slot = null;
  me.discard.push(stolen);
  emit(ctx, { type: 'card_discarded', player: source.player, instanceId: stolen, cardId: inst.cardId, from: 'hand' });
  noteDiscard(draft, ctx, source.player, { instanceId: stolen, cardId: inst.cardId, from: 'hand' });
};
