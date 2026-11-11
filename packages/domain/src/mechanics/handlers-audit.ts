function sourceZone(draft: Draft<MatchState>, source: EffectSource): number | null {
  return source.instanceId ? (draft.instances[source.instanceId]?.zone ?? null) : null;
}

import type { Draft } from 'immer';
import { dealToCreature, dealToPlayer, killInstance } from '../damage';
import { DomainError } from '../errors';
import { drawCards } from '../draw';
import { clearZoneSlot, emit, instance, player } from '../util';
import { opponentsOf, opponentZoneFor } from '../zones';
import type { Ctx } from '../util';
import type { MatchState, PlayerId } from '../types';
import type { EffectSource, MechanicHandler } from './registry';
import type { TargetChoice, TriggerPayload } from './types';
import { enqueueTrigger, enqueueLeavePlay } from './dispatch';
import { bumpCounter } from './effects';

function bounceToHand(draft: Draft<MatchState>, ctx: Ctx, instId: string): void {
  const inst = instance(draft, instId);
  if (inst.location !== 'field' && inst.location !== 'companion') return;
  const prevZone = inst.zone;
  if (inst.zone !== null && inst.slot) {
    const zoneOwner = draft.players[inst.controller]!;
    clearZoneSlot(zoneOwner.zones[inst.zone]!, inst.slot, instId);
  }
  if (inst.location === 'companion') draft.players[inst.controller]!.companion = null;
  inst.location = 'hand';
  inst.zone = null;
  inst.slot = null;
  inst.flipped = false;
  draft.players[inst.controller]!.hand.push(instId);
  emit(ctx, { type: 'card_returned', player: inst.controller, instanceId: instId, cardId: inst.cardId });
  bumpCounter(draft, 'returned_to_hand', inst.controller);
  enqueueTrigger(draft, ctx, 'on_return_to_hand', { instanceId: instId, cardId: inst.cardId, player: inst.controller, zone: prevZone });
  enqueueLeavePlay(draft, ctx, instId, inst.cardId, inst.controller, prevZone);
}

function healUnit(draft: Draft<MatchState>, ctx: Ctx, instId: string, amount: number): void {
  const inst = instance(draft, instId);
  const healed = Math.min(amount, inst.damage);
  if (healed > 0) {
    inst.damage -= healed;
    emit(ctx, { type: 'creature_healed', instanceId: instId, amount: healed });
  }
}

function freezeLand(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId, zone: number): void {
  const land = draft.players[playerId]?.lands[zone];
  if (!land || land.frozen) return;
  land.frozen = true;
  emit(ctx, { type: 'land_changed', player: playerId, zone, change: 'frozen' });
  enqueueTrigger(draft, ctx, 'on_freeze', { player: playerId, zone });
}

/** Заморозить обе земли на линии (Пурга, Сэндвич с мороженым) */
export const freezeLaneBothLands: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  let targetZone: number | null = null;
  const pick = choices?.[0];
  const sZone = sourceZone(draft, source);
  if (pick && pick.kind === 'landscape') {
    targetZone = pick.zone;
  } else if (sZone !== null) {
    targetZone = sZone;
  }
  if (targetZone === null) {
    throw new DomainError('invalid_choice', 'freeze_lane_both_lands needs a landscape choice or source lane');
  }
  for (const pid of draft.order) {
    freezeLand(draft, ctx, pid, targetZone);
  }
};

/** Вулкан (Вулкан lsp_card_39) */
export const volcanoDestroyAndErupt: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') {
    throw new DomainError('invalid_choice', 'volcano needs a building choice');
  }
  const inst = instance(draft, pick.instanceId);
  if (inst.slot !== 'building' || inst.zone === null) {
    throw new DomainError('invalid_choice', 'volcano target must be a building on field');
  }
  const laneZone = inst.zone;
  const removed = killInstance(draft, ctx, pick.instanceId);
  emit(ctx, { type: 'creature_destroyed', instanceId: pick.instanceId, cardId: removed.cardId });

  const oppZone = opponentZoneFor(draft, source.player, laneZone);
  const oppCreature = oppZone ? draft.players[oppZone.player]?.zones[oppZone.zone]?.creature : null;
  if (oppCreature) {
    dealToCreature(draft, ctx, oppCreature, 3, source.instanceId);
  } else {
    const ownZone = draft.players[source.player]?.zones[laneZone];
    if (ownZone?.creature) {
      dealToCreature(draft, ctx, ownZone.creature, 3, source.instanceId);
    }
  }

  const ownLand = draft.players[source.player]?.lands[laneZone];
  if (ownLand && !ownLand.flipped) {
    ownLand.flipped = true;
    emit(ctx, { type: 'land_changed', player: source.player, zone: laneZone, change: 'flipped' });
    enqueueTrigger(draft, ctx, 'on_flip', { player: source.player, zone: laneZone });
  }
};

/** Самоподрыв Громкого Буха (tree_trunks_card_10) */
export const armDelayedExplosion: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
): void => {
  const damage = (params?.damage as number | undefined) ?? 6;
  const instId = source.instanceId;
  if (!instId) return;
  const inst = instance(draft, instId);
  const sZone = sourceZone(draft, source);
  if (sZone !== null) {
    const opp = opponentZoneFor(draft, source.player, sZone);
    if (opp) {
      const oppCreature = draft.players[opp.player]?.zones[opp.zone]?.creature;
      if (oppCreature) {
        dealToCreature(draft, ctx, oppCreature, damage, source.instanceId);
      } else {
        dealToPlayer(draft, ctx, opp.player, damage, source.instanceId);
      }
    }
  }
  killInstance(draft, ctx, instId);
  emit(ctx, { type: 'creature_destroyed', instanceId: instId, cardId: inst.cardId });
};

/** Велик на двоих (charlie_card_3) */
export const charlieBikeForTwo: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const ownPick = choices?.[0];
  if (!ownPick || ownPick.kind !== 'creature') {
    throw new DomainError('invalid_choice', 'bike_for_two needs an own creature');
  }
  bounceToHand(draft, ctx, ownPick.instanceId);

  const otherPick = choices?.[1];
  if (otherPick) {
    if (otherPick.kind === 'creature') {
      bounceToHand(draft, ctx, otherPick.instanceId);
    } else if (otherPick.kind === 'player') {
      const p = draft.players[otherPick.playerId];
      const targetCreature = p?.zones.find(z => z.creature)?.creature;
      if (targetCreature) bounceToHand(draft, ctx, targetCreature);
    }
  }
};

/** Жнец: сброс карты и перемещение существа (jake_card_6) */
export const reaperDiscardAndMoveLaneCreature: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const cardPick = choices?.find(c => c.kind === 'card');
  if (cardPick && cardPick.kind === 'card') {
    const p = player(draft, source.player);
    const inst = instance(draft, cardPick.instanceId);
    if (inst.location === 'hand' && inst.controller === source.player) {
      inst.location = 'discard';
      p.hand.splice(p.hand.indexOf(cardPick.instanceId), 1);
      p.discard.push(cardPick.instanceId);
      emit(ctx, { type: 'card_discarded', player: source.player, instanceId: inst.id, cardId: inst.cardId, from: 'hand' });
    }
  }
  const sZone = sourceZone(draft, source);
  if (sZone !== null) {
    const opp = opponentZoneFor(draft, source.player, sZone);
    if (opp) {
      const oppP = draft.players[opp.player];
      const oppCreature = oppP?.zones[opp.zone]?.creature;
      if (oppP && oppCreature) {
        for (const destZ of [opp.zone - 1, opp.zone + 1]) {
          if (destZ >= 0 && destZ < oppP.zones.length && !oppP.zones[destZ]!.creature) {
            const fromZ = opp.zone;
            oppP.zones[fromZ]!.creature = null;
            const inst = instance(draft, oppCreature);
            inst.zone = destZ;
            inst.movedThisTurn = true;
            oppP.zones[destZ]!.creature = inst.id;
            emit(ctx, { type: 'card_moved', player: opp.player, instanceId: inst.id, fromZone: fromZ, toZone: destZ });
            break;
          }
        }
      }
    }
  }
};

/** Взрывной мужик: урон существу напротив и по бокам от него (tree_trunks_card_12) */
export const explosiveDudeCleave: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
): void => {
  const sZone = sourceZone(draft, source);
  if (sZone === null) return;
  const oppZone = opponentZoneFor(draft, source.player, sZone);
  if (!oppZone) return;
  const oppP = draft.players[oppZone.player];
  if (!oppP) return;
  const centerZone = oppZone.zone;
  for (const z of [centerZone - 1, centerZone, centerZone + 1]) {
    if (z >= 0 && z < oppP.zones.length) {
      const cId = oppP.zones[z]?.creature;
      if (cId) dealToCreature(draft, ctx, cId, 1, source.instanceId);
    }
  }
};

/** Док Кукольштейн (marceline_card_20) */
export const drKukolsteinHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const amount = (params?.amount as number | undefined) ?? 2;
  const threshold = (params?.threshold as number | undefined) ?? 5;
  const sourceInst = source.instanceId ? instance(draft, source.instanceId) : null;
  const hasFiveDamage = sourceInst ? sourceInst.damage >= threshold : false;
  if (hasFiveDamage) {
    for (const pid of draft.order) {
      for (const zone of draft.players[pid]!.zones) {
        if (zone.creature) healUnit(draft, ctx, zone.creature, amount);
      }
    }
  } else {
    const pick = choices?.[0];
    if (pick && pick.kind === 'creature') {
      healUnit(draft, ctx, pick.instanceId, amount);
    } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      for (const z of [sZone - 1, sZone + 1]) {
        const cId = draft.players[source.player]?.zones[z]?.creature;
        if (cId) healUnit(draft, ctx, cId, amount);
      }
    }
  }
  }
};

/** Пентапластырь: восстановить ровно 5 урона (marceline_card_27) */
export const pentaplasterHealFiveExact: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') return;
  const inst = instance(draft, pick.instanceId);
  if (inst.damage >= 5) healUnit(draft, ctx, pick.instanceId, 5);
};

/** Слинять (jake_2v2_card_28) */
export const baleOutRetreat: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') return;
  const inst = instance(draft, pick.instanceId);
  inst.damage = 0;
  bounceToHand(draft, ctx, pick.instanceId);
};

/** Митик: урон каждому противнику без карт в руке (bmo_card_17) */
export const damageOpponentsWithEmptyHand: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
): void => {
  const amount = (params?.amount as number | undefined) ?? 3;
  for (const pid of opponentsOf(draft, source.player)) {
    if (draft.players[pid]!.hand.length === 0) {
      dealToPlayer(draft, ctx, pid, amount, source.instanceId);
    }
  }
};

/** Яблочный пироклоп: вылечить или нанести 1 урон каждому существу (bubblegum_card_28) */
export const perCreatureHealOrDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
): void => {
  const amount = (params?.amount as number | undefined) ?? 1;
  const p = draft.players[source.player]!;
  for (const z of p.zones) {
    if (z.creature) {
      const inst = instance(draft, z.creature);
      if (inst.damage > 0) {
        healUnit(draft, ctx, z.creature, amount);
      }
    }
  }
};

/** Дай пять! (grand_prix_card_2) */
export const highFiveHealOrDamageAndPass: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const targetPick = choices?.[0];
  const modePick = choices?.[1];
  if (targetPick && targetPick.kind === 'creature') {
    if (modePick && modePick.kind === 'option' && modePick.option === 'damage') {
      dealToCreature(draft, ctx, targetPick.instanceId, 1, source.instanceId);
    } else {
      healUnit(draft, ctx, targetPick.instanceId, 1);
    }
  }
};

/** Дуэт: восстановить 1 урон своему и 1 чужому существу (grand_prix_card_3) */
export const duetHealOwnAndOther: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  for (const pick of choices ?? []) {
    if (pick.kind === 'creature') healUnit(draft, ctx, pick.instanceId, 1);
  }
};

/** Пляжная вечеринка (grand_prix_card_4) */
export const beachPartyRevealPickAndPass: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
): void => {
  drawCards(draft, ctx, source.player, 1);
};

/** Близняшки (grand_prix_card_5) */
export const twinsCompareTopDeck: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  drawCards(draft, ctx, source.player, 1);
  const targetPick = choices?.[0];
  if (targetPick && targetPick.kind === 'player') {
    drawCards(draft, ctx, targetPick.playerId, 1);
  }
};

/** Леденящее пение (grand_prix_card_10) */
export const freezeOneLandEachPlayerAndDraw: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
): void => {
  for (const pid of draft.order) {
    const unfrozenZone = draft.players[pid]!.lands.findIndex(l => !l.frozen);
    if (unfrozenZone !== -1) freezeLand(draft, ctx, pid, unfrozenZone);
  }
  drawCards(draft, ctx, source.player, 1);
};

/** Ледяной лимонад (grand_prix_card_11) */
export const healPerIceLandFriendlyCreatures: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
): void => {
  let count = 0;
  for (const pid of draft.order) {
    count += draft.players[pid]!.lands.filter(l => l.iceTokens > 0).length;
  }
  for (const z of draft.players[source.player]!.zones) {
    if (z.creature && count > 0) {
      healUnit(draft, ctx, z.creature, 1);
      count--;
    }
  }
};

/** Вафля в шоколаде (grand_prix_card_13) */
export const damageEachCreatureOfPlayer: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const targetPick = choices?.[0];
  if (!targetPick || targetPick.kind !== 'player') return;
  const p = draft.players[targetPick.playerId];
  if (!p) return;
  for (const z of p.zones) {
    if (z.creature) dealToCreature(draft, ctx, z.creature, 1, source.instanceId);
  }
};

/** Спасайся кто может! (grand_prix_card_29) */
export const bounceAndReplayFree: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') return;
  const inst = instance(draft, pick.instanceId);
  const z = inst.zone;
  bounceToHand(draft, ctx, pick.instanceId);
  if (z !== null && !draft.players[source.player]!.zones[z]!.creature) {
    draft.players[source.player]!.zones[z]!.creature = inst.id;
    draft.players[source.player]!.hand.splice(draft.players[source.player]!.hand.indexOf(inst.id), 1);
    inst.location = 'field';
    inst.zone = z;
    inst.slot = 'creature';
    emit(ctx, { type: 'card_played', player: source.player, instanceId: inst.id, cardId: inst.cardId, zone: z, slot: 'creature', replacedInstanceId: null });
  }
};

/** Ледяная леди (ice_king_card_29) */
export const iceLadyDiscardPerIceLand: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'player') return;
  const p = draft.players[pick.playerId];
  if (!p) return;
  const count = p.lands.filter(l => l.iceTokens > 0).length;
  for (let i = 0; i < count && p.hand.length > 0; i++) {
    const id = p.hand.pop()!;
    p.discard.push(id);
    const inst = instance(draft, id);
    inst.location = 'discard';
    emit(ctx, { type: 'card_discarded', player: pick.playerId, instanceId: id, cardId: inst.cardId, from: 'hand' });
  }
};

/** Шипастый зебрарог (jake_2v2_card_22) */
export const damageAllCreaturesOnAdjacentLanes: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
): void => {
  const amount = (params?.amount as number | undefined) ?? 1;
  const sZone = sourceZone(draft, source);
  if (sZone === null) return;
  for (const pid of draft.order) {
    const p = draft.players[pid]!;
    for (const z of [sZone - 1, sZone + 1]) {
      if (z >= 0 && z < p.zones.length && p.zones[z]!.creature) {
        dealToCreature(draft, ctx, p.zones[z]!.creature!, amount, source.instanceId);
      }
    }
  }
};

/** Перераспределение урона между двумя (lich_card_36) */
export const redistributeDamageBetweenTwo: MechanicHandler = (
  draft: Draft<MatchState>,
  _ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pickA = choices?.[0];
  const pickB = choices?.[1];
  if (!pickA || !pickB || pickA.kind !== 'creature' || pickB.kind !== 'creature') return;
  const instA = instance(draft, pickA.instanceId);
  const instB = instance(draft, pickB.instanceId);
  const total = instA.damage + instB.damage;
  instA.damage = Math.floor(total / 2);
  instB.damage = total - instA.damage;
};

/** Неразборчивый гладиатор: урон союзнику цели (lich_card_43) */
export const splashChosenTargetAlly: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  _choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
): void => {
  const amount = (params?.amount as number | undefined) ?? 2;
  const targetId = payload?.instanceId;
  if (!targetId) return;
  const inst = instance(draft, targetId);
  if (inst.zone === null) return;
  const p = draft.players[inst.controller]!;
  for (const z of [inst.zone - 1, inst.zone + 1]) {
    if (z >= 0 && z < p.zones.length && p.zones[z]!.creature) {
      dealToCreature(draft, ctx, p.zones[z]!.creature!, amount, source.instanceId);
      break;
    }
  }
};

/** Унициклоп (marceline_card_7) */
export const eachPlayerDrawThenDiscardChoice: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
): void => {
  for (const pid of draft.order) {
    drawCards(draft, ctx, pid, 1);
    const p = draft.players[pid]!;
    if (p.hand.length > 0) {
      const id = p.hand.pop()!;
      p.discard.push(id);
      const inst = instance(draft, id);
      inst.location = 'discard';
      emit(ctx, { type: 'card_discarded', player: pid, instanceId: id, cardId: inst.cardId, from: 'hand' });
    }
  }
};

/** Один в один (monika_card_2) */
export const drawTwoAndDealIfMatchAndPassSelf: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  drawCards(draft, ctx, source.player, 2);
  const targetPick = choices?.[0];
  if (targetPick && targetPick.kind === 'player') {
    dealToPlayer(draft, ctx, targetPick.playerId, 2, source.instanceId);
  }
};

/** Невероятное яйцо (ftg_card_69) */
export const revealTopTwoTakeCorn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
): void => {
  const p = draft.players[source.player]!;
  const revealed = p.deck.splice(0, Math.min(2, p.deck.length));
  for (const id of revealed) {
    const inst = instance(draft, id);
    const card = ctx.catalog.getCard(inst.cardId);
    if (card && card.landType === 'corn') {
      p.hand.push(id);
      inst.location = 'hand';
      emit(ctx, { type: 'card_drawn', player: source.player, count: 1 });
    } else {
      p.discard.push(id);
      inst.location = 'discard';
      emit(ctx, { type: 'card_discarded', player: source.player, instanceId: id, cardId: inst.cardId, from: 'deck' });
    }
  }
};

/** Призрачный мимик (ftg_card_102) */
export const drawBottomCard: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
): void => {
  const p = draft.players[source.player]!;
  if (p.deck.length === 0) return;
  const id = p.deck.pop()!;
  p.hand.push(id);
  const inst = instance(draft, id);
  inst.location = 'hand';
  emit(ctx, { type: 'card_drawn', player: source.player, count: 1 });
};

/** Теневая пирамида (ftg_card_116) */
export const drawAndDiscardIfCreatureOnLane: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
): void => {
  drawCards(draft, ctx, source.player, 1);
  const sZone = sourceZone(draft, source);
  if (sZone !== null) {
    if (draft.players[source.player]?.zones[sZone]?.creature) {
      const p = draft.players[source.player]!;
      if (p.hand.length > 0) {
        const id = p.hand.pop()!;
        p.discard.push(id);
        const inst = instance(draft, id);
        inst.location = 'discard';
        emit(ctx, { type: 'card_discarded', player: source.player, instanceId: id, cardId: inst.cardId, from: 'hand' });
      }
    }
  }
};

/** Заморозка и перенос жетонов (monika_card_11) */
export const freezeAndOptionalRedistributeTokens: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  }
};

/** Крепость из подушек (jake_2v2_card_8) */
export const pillowFortTwinHealOrDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  for (const pick of choices ?? []) {
    if (pick.kind === 'creature') healUnit(draft, ctx, pick.instanceId, 2);
  }
};

/** Авто-ощипыватель: лечить или нанести урон своему существу на линии (marceline_card_26) */
export const healOrDamageLane: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
): void => {
  const amount = (params?.amount as number | undefined) ?? 1;
  const sZone = sourceZone(draft, source);
  if (sZone === null) return;
  const cId = draft.players[source.player]?.zones[sZone]?.creature;
  if (!cId) return;
  const inst = instance(draft, cId);
  if (inst.damage > 0) {
    healUnit(draft, ctx, cId, amount);
  } else {
    dealToCreature(draft, ctx, cId, amount, source.instanceId);
  }
};

/** Шаровая бобовая бомба (charlie_card_39) */
export const bombHealOrDamageIfFourDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
): void => {
  const amount = (params?.amount as number | undefined) ?? 4;
  const sZone = sourceZone(draft, source);
  if (sZone === null) return;
  const cId = draft.players[source.player]?.zones[sZone]?.creature;
  if (!cId) return;
  const inst = instance(draft, cId);
  if (inst.damage === 4) {
    healUnit(draft, ctx, cId, amount);
  }
};

/** Браслет дружбы (fiona_card_7) */
export const swapDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  _ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pickA = choices?.[0];
  const pickB = choices?.[1];
  if (!pickA || !pickB || pickA.kind !== 'creature' || pickB.kind !== 'creature') return;
  const instA = instance(draft, pickA.instanceId);
  const instB = instance(draft, pickB.instanceId);
  const temp = instA.damage;
  instA.damage = instB.damage;
  instB.damage = temp;
};

/** Хлопковый король: пассивная аура защиты хлопковым (tree_trunks_card_4) */
export const cottonKingDefAura: MechanicHandler = (): void => {};

/** Хлопковый форт: пассивный бафф линии (tree_trunks_card_35) */
export const cottonFortLaneBuff: MechanicHandler = (): void => {};

/** Мятная мороженка: иммунитет (grand_prix_card_16) */
export const mintIceCreamSpellAndAbilityImmunity: MechanicHandler = (): void => {};

/** Крепкий лесоруб: дополнительное строение (cake_card_18) */
export const allowExtraBuildingOnLane: MechanicHandler = (): void => {};

/** Крысолов: замена атакующего (cake_card_33) */
export const replaceAttackerWithFlooped: MechanicHandler = (): void => {};

/** Торжество чар: перемещение и передача (charlie_card_5) */
export const moveCreatureAndPassCard: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    const inst = instance(draft, pick.instanceId);
    if (inst.zone !== null) {
      const p = draft.players[inst.controller]!;
      for (const destZ of [inst.zone - 1, inst.zone + 1]) {
        if (destZ >= 0 && destZ < p.zones.length && !p.zones[destZ]!.creature) {
          const fromZ = inst.zone;
          p.zones[fromZ]!.creature = null;
          inst.zone = destZ;
          inst.movedThisTurn = true;
          p.zones[destZ]!.creature = inst.id;
          emit(ctx, { type: 'card_moved', player: inst.controller, instanceId: inst.id, fromZone: fromZ, toZone: destZ });
          break;
        }
      }
    }
  }
};

/** Выручка: урон от партнера (charlie_card_28) */
export const revenuePartnerDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  }
};

/** Шалаш Вайда: переместить на соседнюю (finn_card_23) */
export const moveLaneCreatureToAdjacent: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
): void => {
  const sZone = sourceZone(draft, source);
  if (sZone === null) return;
  const p = draft.players[source.player]!;
  const cId = p.zones[sZone]?.creature;
  if (!cId) return;
  for (const destZ of [sZone - 1, sZone + 1]) {
    if (destZ >= 0 && destZ < p.zones.length && !p.zones[destZ]!.creature) {
      p.zones[sZone]!.creature = null;
      const inst = instance(draft, cId);
      inst.zone = destZ;
      inst.movedThisTurn = true;
      p.zones[destZ]!.creature = cId;
      emit(ctx, { type: 'card_moved', player: source.player, instanceId: cId, fromZone: sZone, toZone: destZ });
      break;
    }
  }
};

/** Чудик Вайда: карта становится радужной (fiona_card_28) */
export const revealHandCardBecomesRainbow: MechanicHandler = (): void => {};

/** Волшебник-гастролер: обмен с противником на линии (ftg_card_10) */
export const swapWithOpponentOnLane: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
): void => {
  const sZone = sourceZone(draft, source);
  if (sZone === null) return;
  const oppZone = opponentZoneFor(draft, source.player, sZone);
  if (!oppZone || !source.instanceId) return;
  const oppP = draft.players[oppZone.player];
  const ownP = draft.players[source.player];
  if (!oppP || !ownP) return;
  const oppCId = oppP.zones[oppZone.zone]?.creature;
  if (!oppCId) return;
  const ownCId = source.instanceId;

  oppP.zones[oppZone.zone]!.creature = ownCId;
  ownP.zones[sZone]!.creature = oppCId;
  const ownInst = instance(draft, ownCId);
  const oppInst = instance(draft, oppCId);
  ownInst.zone = oppZone.zone;
  ownInst.controller = oppZone.player;
  oppInst.zone = sZone;
  oppInst.controller = source.player;
  emit(ctx, { type: 'card_moved', player: oppZone.player, instanceId: ownCId, fromZone: sZone, toZone: oppZone.zone });
  emit(ctx, { type: 'card_moved', player: source.player, instanceId: oppCId, fromZone: oppZone.zone, toZone: sZone });
};

/** Хижина эльфа: добор за существ на линии (ftg_card_20) */
export const drawPerCreatureOnLane: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
): void => {
  const sZone = sourceZone(draft, source);
  if (sZone === null) return;
  let count = 0;
  for (const pid of draft.order) {
    if (draft.players[pid]?.zones[sZone]?.creature) count++;
  }
  if (count > 0) drawCards(draft, ctx, source.player, count);
};

/** Башня правосудия: урон существу и владельцу (ftg_card_25) */
export const towerOfJusticeDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') return;
  const inst = instance(draft, pick.instanceId);
  dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  dealToPlayer(draft, ctx, inst.controller, 1, source.instanceId);
};

/** Мисс Муми: возврат и бафф песчаного (ftg_card_63) */
export const bounceSelfAndBuffSandCreature: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  if (source.instanceId) bounceToHand(draft, ctx, source.instanceId);
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    const inst = instance(draft, pick.instanceId);
    inst.bonusDefense += 1; emit(ctx, { type: 'bonus_changed', instanceId: inst.id, cardId: inst.cardId, bonusAttack: inst.bonusAttack, bonusDefense: inst.bonusDefense });
  }
};

/** Жучья госпожа: возврат существа с малым DEF (ftg_card_74) */
export const bounceOwnCreatureWithLowDef: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') bounceToHand(draft, ctx, pick.instanceId);
};

/** Портал в никуда (ftg_card_87) */
export const portalNowhereShiftOpponent: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') return;
  const inst = instance(draft, pick.instanceId);
  if (inst.zone === null) return;
  const oppP = draft.players[inst.controller]!;
  for (const destZ of [inst.zone - 1, inst.zone + 1]) {
    if (destZ >= 0 && destZ < oppP.zones.length && !oppP.zones[destZ]!.creature) {
      const fromZ = inst.zone;
      oppP.zones[fromZ]!.creature = null;
      inst.zone = destZ;
      inst.movedThisTurn = true;
      oppP.zones[destZ]!.creature = inst.id;
      emit(ctx, { type: 'card_moved', player: inst.controller, instanceId: inst.id, fromZone: fromZ, toZone: destZ });
      break;
    }
  }
};

/** Семена Зазо: бафф песчаного существа (lady_rainicorn_card_25) */
export const zazoSeedsBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') return;
  const inst = instance(draft, pick.instanceId);
  inst.bonusAttack += 2; emit(ctx, { type: 'bonus_changed', instanceId: inst.id, cardId: inst.cardId, bonusAttack: inst.bonusAttack, bonusDefense: inst.bonusDefense });
};

/** Крок-регулятор: сдвиг атакующего (grand_prix_card_34) */
export const shiftAttackerToAdjacentEmpty: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  _choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
): void => {
  const attackerId = payload?.instanceId;
  if (!attackerId) return;
  const inst = instance(draft, attackerId);
  if (inst.zone === null) return;
  const oppP = draft.players[inst.controller]!;
  for (const destZ of [inst.zone - 1, inst.zone + 1]) {
    if (destZ >= 0 && destZ < oppP.zones.length && !oppP.zones[destZ]!.creature) {
      const fromZ = inst.zone;
      oppP.zones[fromZ]!.creature = null;
      inst.zone = destZ;
      inst.movedThisTurn = true;
      oppP.zones[destZ]!.creature = inst.id;
      emit(ctx, { type: 'card_moved', player: inst.controller, instanceId: inst.id, fromZone: fromZ, toZone: destZ });
      break;
    }
  }
};

/** Партнерское бесплатное существо (jake_2v2_card_40) */
export const partnerFreePlayCreature: MechanicHandler = (): void => {};

/** Партнерское бесплатное заклинание (monika_card_8) */
export const partnerFreePlaySpell: MechanicHandler = (): void => {};
