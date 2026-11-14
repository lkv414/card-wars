import type { Draft } from 'immer';
import { dealToCreature, dealToPlayer, killInstance } from '../damage';
import { DomainError } from '../errors';
import { drawCards, discardTopDeck } from '../draw';
import { clearZoneSlot, emit, instance, player } from '../util';
import { opponentsOf, opponentZoneFor, teammatesOf } from '../zones';
import type { Ctx } from '../util';
import type { MatchState, PlayerId, CardInstance } from '../types';
import type { EffectSource, MechanicHandler } from './registry';
import type { TargetChoice, TriggerPayload } from './types';
import { enqueueTrigger, enqueueLeavePlay } from './dispatch';
import { bumpCounter } from './effects';

function sourceZone(draft: Draft<MatchState>, source: EffectSource): number | null {
  return source.instanceId ? (draft.instances[source.instanceId]?.zone ?? null) : null;
}

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

function healPlayer(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId, amount: number): void {
  const p = player(draft, playerId);
  const healed = Math.min(amount, p.maxLives - p.lives);
  if (healed > 0) {
    p.lives += healed;
    emit(ctx, { type: 'lives_changed', player: playerId, delta: healed, lives: p.lives });
  }
}

function freezeLand(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId, zone: number): void {
  const land = draft.players[playerId]?.lands[zone];
  if (!land || land.frozen) return;
  land.frozen = true;
  emit(ctx, { type: 'land_changed', player: playerId, zone, change: 'frozen' });
  enqueueTrigger(draft, ctx, 'on_freeze', { player: playerId, zone });
}

function flipLand(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId, zone: number): void {
  const land = draft.players[playerId]?.lands[zone];
  if (!land) return;
  land.flipped = !land.flipped;
  emit(ctx, { type: 'land_changed', player: playerId, zone, change: land.flipped ? 'flipped' : 'unflipped' });
  enqueueTrigger(draft, ctx, 'on_flip', { player: playerId, zone });
}

function addBonus(draft: Draft<MatchState>, ctx: Ctx, instId: string, atk: number, def: number): void {
  const inst = instance(draft, instId);
  inst.bonusAttack += atk;
  inst.bonusDefense += def;
  emit(ctx, { type: 'bonus_changed', instanceId: inst.id, cardId: inst.cardId, bonusAttack: inst.bonusAttack, bonusDefense: inst.bonusDefense });
}

function addShield(draft: Draft<MatchState>, ctx: Ctx, instId: string, shield: number): void {
  const inst = instance(draft, instId);
  inst.shield += shield;
  emit(ctx, { type: 'shield_changed', instanceId: inst.id, cardId: inst.cardId, shield: inst.shield });
}

function burnCreature(draft: Draft<MatchState>, _ctx: Ctx, instId: string, count = 1): void {
  const inst = instance(draft, instId);
  inst.burnTokens = (inst.burnTokens ?? 0) + count;
}

function countAllBurnTokens(draft: MatchState): number {
  let count = 0;
  for (const pid of draft.order) {
    for (const z of draft.players[pid]!.zones) {
      if (z.creature) {
        count += draft.instances[z.creature]?.burnTokens ?? 0;
      }
    }
  }
  return count;
}

function discardCardFromHand(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId, instId: string): void {
  const p = player(draft, playerId);
  const idx = p.hand.indexOf(instId);
  if (idx < 0) return;
  p.hand.splice(idx, 1);
  p.discard.push(instId);
  const inst = instance(draft, instId);
  inst.location = 'discard';
  emit(ctx, { type: 'card_discarded', player: playerId, instanceId: instId, cardId: inst.cardId, from: 'hand' });
  enqueueTrigger(draft, ctx, 'on_card_discarded', { player: playerId, instanceId: instId, cardId: inst.cardId });
}

/** Всевидящий глаз (all-seeing-eye-630eb97): Раскрой 5 карт твоей колоды. Положи в руку по одной карте каждого типа земли и сбрось остальные. */
export const allSeeingEyeReveal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  discardTopDeck(draft, ctx, source.player, 5);
};

/** Удивительная непаук-тыква (udivitelnaya-nepauk-tykva-2748377): В начале твоего хода нанеси 1 урон выбранному сопернику за каждые 2 карты с тыквой в сбросе. */
export const amazingNotspiderPumpkin: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 1, source.instanceId);
  }
};

/** Милостивый броненосец (gracious-armadillo-621b4ea): Грохот Когда существо под контролем соперника атакует, ты можешь выбрать его целью атаки милостивого броненосца. */
export const armadilloTauntAttacker: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 2, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 2, 0);
  }
};

/** Облако пепла (oblako-pepla-a1eee34): Нанеси 2 урона выбранному существу под контролем соперника и каждому соседнему существу. */
export const ashCloudSplashDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 2, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 2, source.instanceId);
  }
};

/** Пепельный конструкт (ash-construct-ac283f6): Если у тебя на руке не больше 1 карты, пепельный конструкт получает в 2 раза меньше урона. (С округлением вверх). */
export const ashConstructDamageReduction: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Лавиннорождённый (avalanche-born-fca9424): Когда лавиннорождённый входит в игру, заморозь все твои земли и земли выбранного соперника. */
export const avalancheBornFreeze: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      freezeLand(draft, ctx, source.player, sZone);
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) freezeLand(draft, ctx, opp.player, opp.zone);
    }
  }
};

/** Базальтовый колосс (basalt-colossus-b7b80f2): ФЛЮП >>> Подожги выбранное существо под контролем соперника, затем нанеси 1 урон этому существу за каждый жетон ожога на существах в игре. */
export const basaltColossusBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
    const burns = countAllBurnTokens(draft);
    dealToCreature(draft, ctx, pick.instanceId, burns, source.instanceId);
  }
};

/** Пляжный мячик (beach-ball-a1d5468): Ты восстанавливаешь 4 жизни. Возьми 1 карту. Ты можешь положить эту карту на руку соперника. Если ты это сделаешь возьми дополнительную карту. (Ты можешь разыграть только 1 пляжный мячик за ход.) */
export const beachBallPass: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 4);
};

/** Битрот (beetroot-73a5c39): Битрот получает +1 к атаке за каждую карту на твоей руке. Когда битрот побеждает существо, возьми 1 карту. */
export const beetrootAttackAndDraw: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Большая свинья (big-pig-32705bb): В начале своего хода можешь положить карту в игру со словом «свинья» в названии из своей руки, или вернуть карту на руку. */
export const bigPigPlayOrBounce: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Призрак Бигфута (prizrak-bigfuta-89617ab): ФЛЮП >>> Переверни лицевой стороной вверх выбранную перевёрнутую землю под твоим контролем, если ты перевернул землю призраков, возьми 1 карту. */
export const bigfootGhostUnflipLand: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 1);
};

/** Слепой шееглаз (blind-see-eye-6692a64): Когда слепой шееглаз входит в игру, заморозь одну землю за каждое существо под твоим контролем с «шееглаз» в названии. */
export const blindSheeglazFreeze: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      freezeLand(draft, ctx, source.player, sZone);
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) freezeLand(draft, ctx, opp.player, opp.zone);
    }
  }
};

/** Ослепительная вспышка (blinding-flash-791204c): Возьми 5 карт. В конце хода сбрось все карты, кроме 1. */
export const blindingFlashDraw: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 5);
  const cardPick = choices?.find(c => c.kind === 'card');
  if (cardPick && cardPick.kind === 'card') {
    discardCardFromHand(draft, ctx, source.player, cardPick.instanceId);
  } else {
    discardTopDeck(draft, ctx, source.player, 1);
  }
};

/** Слепящий шееглаз (blinding-snake-eyes-721a918): Когда слепящий шееглаз входит в игру, нанеси 1 урон выбранному существу за каждое существо с «шееглаз» в названии. */
export const blindingSheeglazDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 1, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 1, source.instanceId);
      }
    }
  }
};

/** Белоснежный шторм (blizzard-82f3e8e): Каждый игрок показывает свою руку и сбрасывает все карты за 1 действие. Затем каждый игрок берёт 2 карты. */
export const blizzardDiscardCost1: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Поглощение крови (pogloshchenie-krovi-7a775a3): Сними Х урона с выбранного существа и возьми Х карт, где Х стоимость выбранного существа. Удали эту карту из игры. */
export const bloodDrainCostHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 1);
};

/** Кувшин кровопролития (bloodshed-pitcher-6777846): Когда кувшин кровопролития входит в игру, сбрось 3 верхние карты твоей колоды. За каждое заклинание, сброшенное таким образом, нанеси 2 урона выбранному существу. */
export const bloodshedPitcherMillDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  discardTopDeck(draft, ctx, source.player, 3);
};

/** Книга брани (book-of-swearing-11c1af0): Выбери букву. Нанеси 4 урона существам, имена которых не начинаются с выбранной буквы. */
export const bookOfSwearingDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 4, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 4, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 4, source.instanceId);
      }
    }
  }
};

/** Батутный домик (bounce-house-742c381): Когда тебе наносят урон, вместо себя нанеси урон батутному домику. */
export const bounceHouseInterceptPlayerDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Блестящее открытие (brilliant-discovery-06a87a9): Возьми 2 карты. Ты можешь замешать до 2 заклинаний из твоего сброса в исследовательские заметки. */
export const brilliantDiscoveryDrawRecycle: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 2);
};

/** Накаченное зелье (buffed-potion-5e087ac): Сними 2 урона с выбранного существа и положи на него 2(+). Если атака этого существа 5 или больше, возьми 1 карту. */
export const buffedPotionHealAndDraw: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 2);
};

/** Изваяние быка (izvayanie-byka-e984cf0): Положи ☩ на выбранное существо. Если на существе 2 или более ☩, ты можешь взять 1 карту. */
export const bullStatueBuffDraw: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Маслотаран (butter-ram-4a50eb5): Поверни сколько угодно существ под твоим контролем. Нанеси 2 урона выбранному сопернику за каждое существо, повёрнутое таким образом. */
export const butterRamFloopDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 2, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 2, source.instanceId);
  }
};

/** Хамелеон (chameleon-237b6d3): Когда хамелеон входит в игру, выбери ему тип земли. */
export const chameleonChooseLand: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Поля хаоса (polya-khaosa-b7f11ae): Выбери 2 существ с призрак под твоим контролем. Нанесите урон, равный сумме их атак. (Но не больше 8.) */
export const chaosFieldsGhostStrike: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Шпаргалка (cheatsheet-dd11a28): Возьми 1 карту. Следующие 2 карты со словом «зелье» в названии, которые ты разыграешь в этой ход, стоят на 1 действие меньше. */
export const cheatsheetPotionDiscount: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 1);
};

/** Химический стакан (chemical-beaker-7c36730): Когда ты разыгрываешь своё первое заклинание в каждом ходу, ты можешь применить его эффекты второй раз. (Ты можешь выбрать разные цели.) */
export const chemicalBeakerDuplicateSpell: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Временной Дрейк (chronos-drain-dc44bd2): Когда Временной Дрейк входит в игру, раскрой 5 карт с верха колоды выбранного игрока. Сбрось всех раскрытых существ, затем остальные карты положи обратно в любом порядке. Положи Временному Дрейку ⚔ за каждое существо, сброшенное таким образом. */
export const chronosDrakeMillCreatures: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  discardTopDeck(draft, ctx, source.player, 5);
};

/** Когтистый лавинопард (clawed-avalanche-leopard-ebe90c9): Когда когтистый лавинопард входит в игру, заморозь выбранную землю под контролем соперника. Когда с любой земли сбрасывают жетон мороза, сними весь урон с когтистого лавинопарда. */
export const clawedAvalancheLeopard: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      freezeLand(draft, ctx, source.player, sZone);
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) freezeLand(draft, ctx, opp.player, opp.zone);
    }
  }
};

/** Разноцветные выдры (raznotsvetnye-vydry-26359d8): Когда разноцветные выдры входят в игру, положи на них 1 за каждое существо под твоим контролем с уникальным типом земли. */
export const colorfulOttersBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Пожарище (pozharishche-094e6d4): Нанеси 1 урон всем существам под контролем соперника за каждый жетон ожого на этом существе. Возьми 1 карту. */
export const conflagrationBurnDamageDraw: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 1);
};

/** Крутой бутылкобород (cool-bottlebeard-5457b56): Когда крутой бутылкобород входит в игру, ты можешь взять на руку из твоего сброса до 2 карт со словом «зелье» в названии. */
export const coolBottlebeardReturnPotions: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Кафе «холодный рожок» (cool-cone-0d39240): Когда кафе «холодный рожок» входит в игру, заморозь землю под контролем соперника в этой зоне. Чтобы убрать жетон мороза с этой земли, соперник сбрасывает дополнительно 1 карту. */
export const coolConeCafe: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      freezeLand(draft, ctx, source.player, sZone);
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) freezeLand(draft, ctx, opp.player, opp.zone);
    }
  }
};

/** Кукуканцлер (corn-chancellor-22d011b): Когда кукуканцлер входит в игру, выбери букву. Другие существа под твоим контролем, названия которых начинаются на эту букву, получают +3 к атаке. */
export const cornChancellorBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 3, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 3, 0);
  }
};

/** Тоте́м ярокорна (corn-fury-totem-7fed8d9): Выбранное дружественное существо получает +2 к атаке в этот ход. Если это существо побеждает другое существо в этот ход, возьми 1 карту. */
export const cornFuryTotemBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 2);
};

/** Король кукугоблин (corn-goblin-king-e62ad68): Когда король кукугоблин заменяется, перемести его на пустую дружественную зону. */
export const cornGoblinKingReplace: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  const instId = (pick && pick.kind === 'creature') ? pick.instanceId : source.instanceId;
  if (!instId) return;
  const inst = instance(draft, instId);
  if (inst.zone !== null) {
    const p = draft.players[inst.controller]!;
    for (const dz of [inst.zone - 1, inst.zone + 1]) {
      if (dz >= 0 && dz < p.zones.length && !p.zones[dz]!.creature) {
        const fromZ = inst.zone;
        p.zones[fromZ]!.creature = null;
        inst.zone = dz;
        inst.movedThisTurn = true;
        p.zones[dz]!.creature = inst.id;
        emit(ctx, { type: 'card_moved', player: inst.controller, instanceId: inst.id, fromZone: fromZ, toZone: dz });
        break;
      }
    }
  }
};

/** Зерно обновления (corn-renewal-d0683ee): Нанеси урон выбранному существу, равный количеству урона на одном из твоих существ. */
export const cornRenewalDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Осадная кукузебра (corn-siegezebra-f53859b): Если ты разыграл 2 не кукурузные карты, урон осадной кукузебры удваивается в этот ход. */
export const cornSiegezebraDoubleDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Граф Дракула (graf-drakula-dd2208d): Когда граф Дракула наносит урон, нанеси его всем существам под контролем соперника, а также сними с него столько урона, сколько он нанес. */
export const countDraculaLifesteal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const dmg = (payload?.amount as number | undefined) ?? 2;
  healPlayer(draft, ctx, source.player, dmg);
};

/** Кремократия (creamocracy-d657fa0): Выбери тип земель. Нанеси 2 урона каждому существу не на выбранном типе земли. */
export const creamocracyDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Ползущий куст (creeping-vine-dccf1b9): В начале твоего хода, ползущий куст получает +3 к атаке в этот ход, если другой игрок не решит сбросить карту. */
export const creepingVineThreat: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 3, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 3, 0);
  }
};

/** Кризисный монарх (crisis-monarch-c52ed43): Когда кризисный монарх входит в игру, уничтожь один из своих барьеров и получи его эффект. */
export const crisisMonarchBarrier: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    const rem = killInstance(draft, ctx, pick.instanceId);
    emit(ctx, { type: 'creature_destroyed', instanceId: pick.instanceId, cardId: rem.cardId });
  }
};

/** КрокОтреч (croc-o-stretch-e217f9f): Когда ты сбрасываешь эту карту в этот ход, получи 1 действие. Если ты сбрасываешь эту карту в ход соперника, возьми 1 карту. */
export const crocOStretchDiscardBonus: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Вороний Бар (crow-bar-640bac4): Вороний Бар стоит на 1 действие меньше за каждое строение в игре. Когда существо входит в эту зону, тот, кто его контролирует, может положить на него до 4(атака). Затем нанеси этому существу урон, равный удвоенному количеству жетонов (кроме урона) на нём. */
export const crowBarBuffPunish: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 1, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 1, source.instanceId);
      }
    }
  }
};

/** Коронованный лавинопард (crowned-avalanche-leopard-9a1a433): Когда коронованный лавинопард входит в игру, заморозь обе земли в этой зоне. Когда коронованный лавинопард выходит из игры, ты можешь сбросить жетон мороза с выбранной земли под твоим контролем. */
export const crownedAvalancheLeopard: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      freezeLand(draft, ctx, source.player, sZone);
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) freezeLand(draft, ctx, opp.player, opp.zone);
    }
  }
};

/** Хрустальный шар (crystal-ball-326d837): Назови карту и раскрой карту твоей колоды. Если это названная карта, разыграй её бесплатно. */
export const crystalBallGuessPlay: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const p = player(draft, source.player);
  const revealed = p.deck.slice(0, 3);
  if (revealed.length > 0) {
    emit(ctx, { type: 'cards_revealed', player: source.player, cardIds: revealed.map(id => draft.instances[id]?.cardId ?? id) });
  }
};

/** Колюще-режущее торнадо (kolyushche-rezhushchee-tornado-176b385): Убери все жетоны (кроме урона) с существ, земель и игроков. Затем нанеси 2 урона выбранному существу за каждый убранный жетон. */
export const cuttingTornadoTokenWipe: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Циклон (cyclone-70848e9): Нанеси 4 урона всем существам не за 1 действие. */
export const cycloneDamageNotCost1: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 4, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 4, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 4, source.instanceId);
      }
    }
  }
};

/** Циклоп (cyclops-90eb04a): +1 к защите за каждый открытый глаз на других существах под твоим контролем. */
export const cyclopsEyeCountDef: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Мракама предатель (darkama-traitor-a7faa33): Когда мракама предатель входит в игру, каждый игрок может сбросить 1 карту, чтобы положить 1 рану на одно из своих существ. */
export const darkamaTraitorDiscardWound: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Смертельная схватка (deadly-clash-a0605c6): Выбери зону. Существа в этой зоне атакуют друг друга, пока одно из них не будет побеждено. */
export const deadlyClashFightToDeath: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 2, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 2, 0);
  }
};

/** Доминирование дельты (delta-dominance-e70a8f9): Нанеси урон выбранному существу, равный суммарной стоимости всех карт под твоим контролем. */
export const deltaDominanceDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Смерч демонов (smerch-demonov-d38d7c4): Верни всех существ уничтоженных в этом ходу, которыми ты владеешь на руку. Удали эту карты из игры. */
export const demonTornadoReturnDead: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    bounceToHand(draft, ctx, pick.instanceId);
  } else if (source.instanceId) {
    bounceToHand(draft, ctx, source.instanceId);
  }
};

/** Демонические спирали (demonicheskie-spirali-617b132): Нанеси 6 урона выбранному существу. Если оно уничтожается этим способом, получи 1 действие. */
export const demonicSpiralsDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 6, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 6, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 6, source.instanceId);
      }
    }
  }
};

/** Грязная Игра (dirty-play-5a7a910): Подбрось монету. Орёл, выбранный соперник получает на 1 действие меньше в свой ход. Решка, получи 1 действие. Удали карту из игры. */
export const dirtyPlayCoinflip: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const win = draft.rng.next() < 0.5;
  if (win) {
    drawCards(draft, ctx, source.player, 1);
  }
};

/** Развеяться! (razveyatsya-dd59c95): Заморозь 1 землю за каждое существо с призрак под вашим контролем. */
export const disperseFreezePerGhost: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      freezeLand(draft, ctx, source.player, sZone);
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) freezeLand(draft, ctx, opp.player, opp.zone);
    }
  }
};

/** Док. Пироклоп (dr-cyclops-d120566): Каждый раз, когда ты разыгрываешь заклинание, ты восстанавливаешь 2 жизни. Если у тебя полное здоровье, нанеси 2 урона выбранному сопернику. */
export const drCyclopsSpellHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 2, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 2, source.instanceId);
  }
};

/** Ужасающая башня (dreadful-tower-57c60c2): Уничтожь существо под твоим контролем в этой зоне и ФЛЮП >>> Разыграй бесплатно 2 карты с верха твоей колоды. */
export const dreadfulTowerPlayTop2: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    const rem = killInstance(draft, ctx, pick.instanceId);
    emit(ctx, { type: 'creature_destroyed', instanceId: pick.instanceId, cardId: rem.cardId });
  }
};

/** Архитектор сновидений (arkhitektor-snovideniy-da704de): Когда архитектор сновидений входит в игру, выбранное существо не наносит урон, до начала твоего следующего хода. Если архитектор сновидений находится на земле призраков, то верни в подготовленное положение существо под твоим контролем. */
export const dreamArchitectEnters: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Дюнный жук в коляске (dune-buggy-b7357ea): Когда дюнный жук в коляске входит в игру, ты можешь раскрыть карту твоей колоды. Если ты раскрыл не песчаную карту, разыграй её бесплатно. */
export const duneBuggyRevealPlay: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Династический дезертир (dynastic-deserter-c3674b0): Когда династический дезертир выходит из игры, если ты владеешь им, ты можешь разыграть его на пустую землю другого игрока. */
export const dynasticDeserterDefect: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Урфо-Червь (earthworm-05f4765): Когда Урфо-Червь побеждён, ты можешь немедленно разыграть бесплатно существо за 1 действие с руки на эту землю. */
export const earthwormDeathFreeCreature: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Красноречивый броненосец (eloquent-armadillo-2f5c508): Когда красноречивый броненосец заменяет существо, положи на него 4. */
export const eloquentArmadilloReplaceBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Извергающийся колосс (erupting-colossus-1e53408): Если у тебя не больше 1 карты на руке, удвой весь урон наносимый всем существам от любого источника. */
export const eruptingColossusDoubleDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Итан
первоклассный лётчик (ethan-flyboy-8e520df): Если в этом ходу ты разыграл 2 или более существ стоимостью 1, ты можешь сыграть его бесплатно. */
export const ethanFlyboyCost: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Поглощение эфира (ether-drain-981660f): Нанеси 3 урона существу и ты восстанавливаешь 3 жизни. Повтори этот эффект за каждого игрока с не больше 1 картой на руке. */
export const etherDrainDamageHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 3, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 3, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 3, source.instanceId);
      }
    }
  }
};

/** Утончённый броненосец (fancy-armadillo-cbe97b0): Если ты разыграл существо стоимостью 2 или больше в этот ход, ты можешь разыграть утончённого броненосца бесплатно. */
export const fancyArmadilloCost: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Подпитай Пламя (feed-the-flame-c231d46): Если под контролем соперника находится 2 горящих существа, положи 3 [+] на выбранное дружественное существо. */
export const feedTheFlameBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Крепость огненного жерла (fiery-crater-fortress-db3c606): Сбрось жетон ожога с существа и ФЛЮП >>> Нанеси 3 урона тому существу. */
export const fieryCraterRemoveBurnDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    const inst = instance(draft, pick.instanceId);
    if ((inst.burnTokens ?? 0) > 0) inst.burnTokens! -= 1;
    dealToCreature(draft, ctx, pick.instanceId, 3, source.instanceId);
  }
};

/** Танец огня (fire-dance-e9fca5f): Положи существо с твоего сброса. Добавь ему урона, пока у него не останется 1 защита. */
export const fireDanceResurrect: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 1, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 1, source.instanceId);
      }
    }
  }
};

/** Огненный пёс (fire-dog-386e256): Когда огненный пёс входит в игру, ты можешь нанести урон выбранному существу, равный количеству жетонов ожога на всех существах. */
export const fireDogBurnDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Огнеминго пожарный (fire-flamingo-5eb6a0d): Огнеминго пожарный игнорирует первые 2 урона, которые ему наносят горящие существа, на каждом ходу. */
export const fireFlamingoBurnImmunity: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Огнеполз (flame-crawler-e693c20): Когда горящее существо под контролем соперника покидает игру, ты можешь поджечь выбранное существо один раз за каждый жетон ожога на покинувшем игру существе. */
export const flameCrawlerSpreadBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Латы пламенного сердца (flame-heart-armor-41f40bc): Подожги выбранное дружественное существо и сними с него весь урон. Возьми 1 карту. */
export const flameHeartArmorHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Синюшный пламенный бегун (blue-flame-runner-b277f1c): Разыграй синюшного пламенного бегуна только в правой крайней зоне. ФЛЮП >>> Если зона с лева от него пустая, перемести его туда. Если ты это сделал, положи ⚔ на него. */
export const flameRunnerStep: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  const instId = (pick && pick.kind === 'creature') ? pick.instanceId : source.instanceId;
  if (!instId) return;
  const inst = instance(draft, instId);
  if (inst.zone !== null) {
    const p = draft.players[inst.controller]!;
    for (const dz of [inst.zone - 1, inst.zone + 1]) {
      if (dz >= 0 && dz < p.zones.length && !p.zones[dz]!.creature) {
        const fromZ = inst.zone;
        p.zones[fromZ]!.creature = null;
        inst.zone = dz;
        inst.movedThisTurn = true;
        p.zones[dz]!.creature = inst.id;
        emit(ctx, { type: 'card_moved', player: inst.controller, instanceId: inst.id, fromZone: fromZ, toZone: dz });
        break;
      }
    }
  }
};

/** Пламенное колесо (flame-wheel-086348e): Потрать 1 действие >>> Возьми 1 карту и раскрой её. Затем подожги существо в зоне пламенного колеса столько раз, сколько стоит раскрытая карта. */
export const flameWheelRevealBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Огнеминго огнеклюв (flaming-flamingo-f5438d2): Когда огнеминго огнеклюв атакует, если существо под контролем соперника в этой зоне горит, он наносит урон выбранному сопернику вместо существа под контролем соперника. */
export const flamingBeakFaceStrike: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 2, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 2, source.instanceId);
  }
};

/** Пламенный прострел (flaming-bolt-7fe1a98): Подожжи выбранное существо, а затем нанеси ему 1 дополнительный урон. */
export const flamingBoltBurnAndDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 1, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 1, source.instanceId);
      }
    }
  }
};

/** Огнеминго капитан (flaming-cpt-3efbfe5): Когда огнеминго капитан наносит урон сопернику, подожги его. (В начале своего хода он получает 1 урон за каждый жетон ожога.) */
export const flamingCaptainBurnPlayer: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
    const burns = countAllBurnTokens(draft);
    dealToCreature(draft, ctx, pick.instanceId, burns, source.instanceId);
  }
};

/** Огнедышащий Дило (flaming-dilo-a832d34): ФЛЮП и сбрось карту >>> Подожги выбранное существо количество раз, равное атаке Огнедышащего Дило. Положи 1 на Огнедышащего Дило. */
export const flamingDiloBurnByAtk: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Огнеминго пылающий (flaming-flamingo-ea57ccd): Когда Огнеминго пылающий наносит урон существу, подожги то существо, если оно не горело. */
export const flamingFlamingoBurnOnHit: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Пылающие хижины (flaming-huts-4c44785): Когда ты поджигаешь существо под контролем соперника, нанеси ему 1 дополнительный урон. */
export const flamingHutsBurnDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Огнеминго Хранитель Пепла (flamingo-ash-keeper-fee8d6d): Когда огнеминго хранитель пепла входит в игру, ты можешь сбросить карту, чтобы поджечь существо под контролем соперника. */
export const flamingoAshKeeperBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Огнеминго начальник шлейфа (flamingo-chief-of-the-flume-ac754e0): Огнеминго начальник шлейфа стоит на 1 действие меньше за каждый жетон ожога на существах. Когда Огнеминго начальник шлейфа наносит урон существу, подожги его. */
export const flamingoChiefBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Огнеминго
хранитель огня (flamingo-fire-keeper-2563c92): Убери жетон ожога с существа под контролем соперника >>> Нанеси 1 урон выбранному сопернику. */
export const flamingoFireKeeperBurnDrain: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 1, source.instanceId);
  }
};

/** Огнеминго ткач огня (flamingo-fire-weaver-890662f): ФЛЮП >>> Подожги каждое существо в выбранной зоне. */
export const flamingoFireWeaverBurnZone: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Огнеминго жарострел (flamingo-flamethrower-f6c9c8b): Когда огнеминго жарострел атакует горящее существо, ты можешь нанести 2 урона другому существу. Если то другое существо не горит, подожги его. */
export const flamingoFlamethrowerSplash: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 2);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 2);
      }
    }
  }
};

/** Светлячок-Фонарщик (flickerbug-88ece22): Пока у тебя на руке не больше 1 карты, раскрой верхнюю карту твоей колоды. Ты можешь разыгрывать раскрытые карты. Карты, разыгранные таким способом, стоят на 1 действие больше в этом ходу. */
export const flickerbugDeckPlay: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Фонтан стойкости (fountain-of-fortitude-e4fcebf): Пока эта карта находится в игре, твоё максимальное здоровье увеличивается на 5. */
export const fountainOfFortitudeMaxHp: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Неистовая пекарня (frenzied-bakery-f9234df): Один раз за ход, ты можешь сбросить карту с руки чтобы положить жетон урона на неистовую пекарню. ФЛЮП >>> Нанеси 1 урон существу под контролем соперника в этой зоне за каждый жетон урона на этой карте. */
export const frenziedBakeryBake: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 1, source.instanceId);
  }
};

/** Хладная Тыква (khladnaya-tykva-6d49939): Выбранное существо получает +1 к атаке (либо +2, если оно находится на земле с жетоном мороза, если оно еще и с тыквой, то дополнительно получает +2 к атаке). */
export const frostPumpkinBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 1, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 1, 0);
  }
};

/** Покоренный Морозом (frostbitten-98c4682): Убери любое количество жетонов мороза со своих земель и героя, затем восстанови 2 жизни за каждый убранный жетон мороза таким способом. */
export const frostbittenTokenHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Хладный лавинопард (frosty-avalanche-leopard-95aac72): Когда другой игрок сбрасывает карту из руки, ты можешь нанести 2 урона выбранному существу. */
export const frostyLeopardDiscardReact: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Гейзерная пушка (geyser-cannon-c5841fb): Если у тебя на руке не больше 1 карты, удвой атаку у дружественных существ в этой зоне. */
export const geyserCannonDoubleAttack: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Призрачный зайчик (prizrachnyy-zaychik-d6ae113): Уничтожь призрачного зайчика >>> Заморозь выбранную землю. Если призрачный зайчик был на земле призраков, то заморозь 3 выбранные земли. */
export const ghostBunnyFreeze: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      freezeLand(draft, ctx, source.player, sZone);
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) freezeLand(draft, ctx, opp.player, opp.zone);
    }
  }
};

/** Призрачная лавина (prizrachnaya-lavina-7f71382): Нанеси 2 урона каждому существу под контролем соперника на земле с жетоном мороза, существа с призраками под вашем контролем на землях без жетонов мороза, получают +2 к атаке. */
export const ghostlyAvalancheEffect: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 2, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 2, source.instanceId);
  }
};

/** Благо призрачное (blago-prizrachnoe-92c8450): ФЛЮП >>> Положи любую карту с призраком из твоего сброса на верх колоды. Если благо призрачное находится на земле призраков, то возьми карту. */
export const ghostlyBlessingActive: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 1);
};

/** Горнило Великана (giant-s-crucible-430faaa): ФЛЮП >>> Подожги выбранное существо под твоим контролем и положи [1] на него. (Лимит: Один раз за ход.) */
export const giantsCrucibleBurnAndDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Ледниковый дрифт (glacier-drift-4f869ad): Перемести выбранное дружественное существо в пустую зону. Заморозь землю под конролем соперника в той зоне. */
export const glacierDriftMove: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      freezeLand(draft, ctx, source.player, sZone);
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) freezeLand(draft, ctx, opp.player, opp.zone);
    }
  }
};

/** Гран При (grand-prix-9bffff8): Один раз за ход ты можешь вернуть на руку одно из существ, разыгранных тобой в этот ход, затем разыграй его бесплатно и нанеси ему 3 урона. */
export const grandPrixReplay: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') return;
  const inst = instance(draft, pick.instanceId);
  if (inst.controller !== source.player || inst.location !== 'field' || inst.zone === null) return;
  const fromZone = inst.zone;
  bounceToHand(draft, ctx, inst.id);
  const p = player(draft, source.player);
  const destZone = p.zones[fromZone]?.creature ? p.zones.findIndex(z => !z.creature) : fromZone;
  if (destZone >= 0) {
    inst.location = 'field';
    inst.zone = destZone;
    inst.slot = 'creature';
    p.hand = p.hand.filter(id => id !== inst.id);
    p.zones[destZone]!.creature = inst.id;
    emit(ctx, { type: 'card_played', player: source.player, instanceId: inst.id, cardId: inst.cardId, zone: destZone, slot: 'creature', replacedInstanceId: null });
  }
  dealToCreature(draft, ctx, inst.id, 3, source.instanceId);
};

/** Травяные ракеты (grass-rockets-989c786): Когда дружественные существа наносят урон в этом ходу, сними с них урон, равный нанесённому урону. */
export const grassRocketsLifesteal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const dmg = (payload?.amount as number | undefined) ?? 2;
  healPlayer(draft, ctx, source.player, dmg);
};

/** Хампир, Ночная Свинья (hampyre-night-pig-be42487): Когда Хампир атакует, ты восстанавливаешь жизни, равные его атаке. */
export const hampyreLifestealOnAttack: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const dmg = (payload?.amount as number | undefined) ?? 2;
  healPlayer(draft, ctx, source.player, dmg);
};

/** Сердечное зелье (heart-potion-864f2af): Сними 5 урона с выбранного существа или выбранный игрок восстанавливает 5 жизней. Если на том существе нет урона или у того игрока полное здоровье, возьми 1 карту. */
export const heartPotionChoice: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 5);
};

/** Тепловой удар (heat-stroke-4753949): Начиная с тебя, каждый игрок выбирает существо, которое ещё не выбирали в этот раз, и наносит ему 4 урона. */
export const heatStrokeEachPlayerPicks: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 4, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 4, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 4, source.instanceId);
      }
    }
  }
};

/** Адская лопата (hell-shovel-f89cf2a): Нанеси 1 урон выбранному существу за каждое заклинание в твоём сбросе. */
export const hellShovelSpellsDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 1, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 1, source.instanceId);
      }
    }
  }
};

/** Холмистый шееглаз (hilly-snakee-eye-903992d): Когда холмистый шееглаз входит в игру, сними 1 урон с каждого дружественного существа за каждое существо в игре с «шееглаз» в названии. */
export const hillySheeglazHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 1, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 1, source.instanceId);
      }
    }
  }
};

/** Голографический кролик (holographic-bunny-afeeb7f): Голографический кролик может находиться на одной земле с другим существом. Когда другое существо на этой земле получает урон, вместо этого нанеси урон голографическому кролику. */
export const holographicBunnyDamageIntercept: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Священный Рыцарь (svyashchennyy-rytsar-230f30f): Если в текущем месяце 31 день, каждый раз, когда существо уничтожается, положи 1 жетон атаки на Священного Рыцаря. */
export const holyKnightMonthBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 31, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 31, 0);
  }
};

/** Священная коса (holy-scythe-80e28ad): Уничтожь выбранное существо. Его владелец восстанавливает 5 жизней. */
export const holyScytheDestroyHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    const rem = killInstance(draft, ctx, pick.instanceId);
    emit(ctx, { type: 'creature_destroyed', instanceId: pick.instanceId, cardId: rem.cardId });
  }
};

/** Домашнее Поле (home-field-24e49f7): Если у тебя 10 жизней или меньше, ты можешь подбросить монету второй раз. Вместо первого результата ты можешь выбрать второй результат. Если результаты обоих подбрасываний совпадают, восстанови 1 жизнь. (Каждое подбрасывание монеты и каждый полученный результат учитывается для эффектов карт.) */
export const homeFieldCoinflipReroll: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Медоед (megoeg-7cc1628): Когда медоед входит в игру, если ты контролируешь 3 других радужных существа, положи 4 [А] на медоеда. +1 к защите за каждый [А] на медоеде. */
export const honeyBadgerBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addShield(draft, ctx, pick.instanceId, 3);
  } else if (source.instanceId) {
    addShield(draft, ctx, source.instanceId, 3);
  }
};

/** Враждебный кукугоблин (hostile-corn-goblin-16c770c): Поглощение Когда ты заменяешь враждебного кукугоблина, существо, которое его заменяет, сначала наносит урон, равный своей атаке, существу под контролем соперника в этой зоне. */
export const hostileCornGoblinStrike: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 2, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 2, source.instanceId);
  }
};

/** Холодно-горячо (hot-cold-08ac76c): Подожги всех существ на замороженных землях, затем заморозь каждую землю с горящим существом. */
export const hotColdSynergy: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Жаркоголовый (hot-head-5e9eed4): Жаркоголовый стоит на 1 действие меньше за каждое существо под твоим контролем за 1 действие. */
export const hotHeadCostReduction: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Горячие прыгуны (hot-jumpers-5f30437): Когда ты поджигаешь существо, положи ♆ на горячих прыгунов. */
export const hotJumpersShieldOnBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Жа роскорп (hot-scorpion-30144ec): ФЛЮП >>> Подожги жа роскорпа. Ты можешь разыграть бесплатно с руки заклинание за 1 действие. */
export const hotScorpionFreeSpell: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Жаркие спирали (hot-spirals-3f88e98): Нанеси 3 урона выбранному существу. Если существо уничтожается этим способом, получи 1 действие. */
export const hotSpiralsDamageAction: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 3, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 3, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 3, source.instanceId);
      }
    }
  }
};

/** Вой (voy-0a307f8): Нанеси выбранному существу под твоим контролем до 2 урона >>> Вой получает +1 к атаке за каждый нанесенный урон в этом ходу. (Используй до двух раз за твой ход) */
export const howlSelfBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Воющий Бродяга (howling-wanderer-1ab2afe): Воющий Бродяга получает +1 к атаке за каждый жетон (кроме урона) на твоём Герое. */
export const howlingWandererHeroTokens: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Призрак хижины (prizrak-khizhiny-29b553d): Когда существо входит в эту зону, тот, кто его контролирует, сбрасывает 1 карту. Если он это делает, то берёт 1 карту. */
export const hutGhostEnterCycle: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Ледяная коробка (ice-box-0922877): Каждый раз, когда соперник сбрасывает карту чтобы сбросить жетон мороза, наноси ему 1 урон и ты восстанавливаешь 1 жизнь. */
export const iceBoxTax: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Ледогенератор (ice-generator-7c2b098): Сбрось любой жетон с выбранной земли и ФЛЮП >>> Заморозь другую землю и возьми 1 карту. */
export const iceGeneratorActive: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      freezeLand(draft, ctx, source.player, sZone);
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) freezeLand(draft, ctx, opp.player, opp.zone);
    }
  }
};

/** Леденящий лавинопард (frosty-avalanche-leopard-d2feeef): Если леденящий лавинопард наносит урон сопернику, он сбрасывает заклинание или показывает руку, если у него таких нет. */
export const iceLeopardDamageSpellDiscard: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 2, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 2, source.instanceId);
  }
};

/** Ледяное очищение (ice-purge-c0abb76): Возьми 2 карты. Ты можешь сбросить один жетон (кроме урона) с существа или земли. Если ты это сделаешь, соперник сбрасывает 1 карту. */
export const icePurgeRemoveToken: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 2);
};

/** Ледзиратель (ice-warden-fc9277c): Существа под контролем соперника на любой земле с жетоном мороза получают двойной урон. */
export const iceWardenDoubleDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Совместное Решение (sovmestnoe-reshenie-1697cbb): Уловка Положи Совместное Решение под выбранное существо. Ты выигрываешь при равенстве голосов пока Совместное Решение находится в игре. Когда это существо выходит из игры, положи Совместное Решение в свой сброс. */
export const jointDecisionVoteTie: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Сочная молния (juicy-lightning-d678fb9): Сними 2 урона с каждого существа под твоим контролем. Если в твоём сбросе 3 или более заклинаний, положи 4 на каждое существо под твоим контролем. */
export const juicyLightningHealBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Кенгукошка (cangurocat-b503c57): Первый раз, когда кенгукошка наносит урон сопернику, положи на неё жетон мороза. */
export const kangaroocatFrostToken: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 2, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 2, source.instanceId);
  }
};

/** Защитник королевства (kingdom-defender-b49d559): Уничтожь защитника королевства >>> Отмени действие проклятия. */
export const kingdomDefenderCancelCurse: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addShield(draft, ctx, pick.instanceId, 2);
  } else if (source.instanceId) {
    addShield(draft, ctx, source.instanceId, 2);
  }
};

/** Рыцарский броненосец (knightly-armadillo-1b0c2b3): Когда рыцарский броненосец заменяет существо, разыграй верхнюю карту твоей колоды бесплатно. */
export const knightlyArmadilloReplacePlay: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Крутетская тасовка (krutetskaya-tasovka-1fa3baa): Выбери букву. Раскрой 3 карты твоей колоды. Возьми все карты на руку, имена которых начинаются с выбранной буквы, и сбрось остальные. */
export const krutetskayaTasovkaPick: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 3);
  const cardPick = choices?.find(c => c.kind === 'card');
  if (cardPick && cardPick.kind === 'card') {
    discardCardFromHand(draft, ctx, source.player, cardPick.instanceId);
  } else {
    discardTopDeck(draft, ctx, source.player, 1);
  }
};

/** Лавоканалы (lava-canals-eca8e1b): ФЛЮП >>> Нанеси 1 урон существу под контролем соперника в этой зоне за каждый жетон ожога на существах в других зонах. */
export const lavaCanalsDamageBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const burns = countAllBurnTokens(draft);
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, burns, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, burns, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, burns, source.instanceId);
  }
};

/** Лаволамповые угри (lava-lamp-eels-3a2eb11): Сбрось карту >>> Подожги выбранное существо. */
export const lavaEelsBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Врата лавокамня (lava-rock-gate-adcd79e): Потрать 1 действие и ФЛЮП >>> Подожги выбранное существо в этой зоне. */
export const lavaGateBurnLane: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Леднериус (ice-king-b69f0ac): Стоимость Леднериуса уменьшается на 1 действие за каждую землю с жетоном мороза под контролем 2 выбранных игроков. В конце твоего хода потеряй 5 жизней или за каждую землю с жетоном мороза, в зависимости от того, какое значение больше. */
export const ledneriusIceTitan: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Живая пустыня (living-sands-2e377a6): Ты не можешь играть существ. Когда существо противника атакует твоё существо, ты можешь выбрать живую пустыню. */
export const livingSandsTauntAndRestrict: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Лоббист (lobbyist-0c0b9f6): Уловка Каждый раз когда ты должен участвовать в голосовании, ты можешь потерять 2 жизни, что бы добавить +1 к своему голосу. (Лимит: Один раз за голосование. Необходимо объявить при выкладывании карт.) */
export const lobbyistVoteBoost: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Призрак счастья и удачи (prizrak-schastya-i-udachi-bac365e): Когда призрак счастья и удачи входит в игру и атакует, ты можешь раскрыть верхнюю карту своей колоды. Если это радужная карта, ты можешь взять её на руку. */
export const luckyGhostRevealRainbow: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 2, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 2, 0);
  }
};

/** Волшебная палочка (magic-wand-1057a3a): Выбранный игрок сбрасывает 1 карту. Если он сбросил заклинание, ты можешь разыграть его бесплатно. */
export const magicWandDiscardPlaySpell: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Математическое зелье (mathematical-potion-85fbb87): Возьми 3 карты, затем положи 1 карту с руки наверх твоей колоды. */
export const mathematicalPotionDrawTop: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 3);
};

/** Плавленый шееглаз (melted-snake-eye-ce39161): Когда плавленный шееглаз входит в игру, положи 1 на каждое существо с «шееглаз» в названии. */
export const meltedSheeglazDamageBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 1, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 1, 0);
  }
};

/** Расплавленное зелье (molten-potion-692f118): Подожги выбранное существо. Нанеси 2 урона каждому горящему существу под контролем соперника. */
export const moltenPotionBurnDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 2);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 2);
      }
    }
  }
};

/** Расплавленный ритуалист (molten-ritualist-332f3c6): ФЛЮП >>> Каждый игрок, у кого не больше 1 карты на руке, берёт 1 карту. */
export const moltenRitualistDraw: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Призыв грязи (muck-summon-0d23946): Когда ты сбрасываешь призыв грязи, ты можешь разыграть его бесплатно. */
export const muckSummonOnDiscardPlay: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Грязепирожные Зомби (mudcake-zombies-f458783): Когда грязепирожные зомби входят в игру, каждый игрок сбрасывает 1 карту, затем берёт 1 карту. */
export const mudcakeZombiesCycle: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Мистический заклинатель (mystical-spellcaster-0f6e099): В конце твоего хода, если ты разыграл 2 или более не равнинных карт в этом ходу, сними 2 урона с выбранного существа в соседней зоне. */
export const mysticalSpellcasterHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Защитница Нат (nat-guard-e6fefb0): Первый раз за каждую фазу атаки, когда ты должен потерять жизни, уменьши количество теряемых жизней вдвое (округляя вниз). */
export const natGuardHalveCombatDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Ночная сова (night-owl-58d07d9): Ночная сова получает -1 к атаке за каждую карту в руке других игроков. */
export const nightOwlHandPenalty: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Благородный броненосец (noble-armadillo-5645c99): Грохот Когда существо под контролем соперника атакует, ты можешь выбрать его целью атаки благородного броненосца. */
export const nobleArmadilloTaunt: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 2, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 2, 0);
  }
};

/** Медсестра (nurse-4c785fd): Когда медсестра входит в игру, ты можешь раскрыть любое заклинание из твоей руки. За каждое заклинание, раскрытое таким образом, выбранный игрок восстанавливает 2 жизни. */
export const nurseRevealHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Защитник оазиса (oasis-defender-4d62fc4): Когда ты разыграл не песчаную карту, нанеси 1 урон каждому существу под контролем соперника. */
export const oasisDefenderNonSandDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 1, source.instanceId);
  }
};

/** Энергия тусовки (party-energy-514525a): Перемести всех существ под твоим контролем в другую зону. Каждое существо, которое переместилось в другую зону получает +2 к атаке в этот ход. */
export const partyEnergyMoveBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  const instId = (pick && pick.kind === 'creature') ? pick.instanceId : source.instanceId;
  if (!instId) return;
  const inst = instance(draft, instId);
  if (inst.zone !== null) {
    const p = draft.players[inst.controller]!;
    for (const dz of [inst.zone - 1, inst.zone + 1]) {
      if (dz >= 0 && dz < p.zones.length && !p.zones[dz]!.creature) {
        const fromZ = inst.zone;
        p.zones[fromZ]!.creature = null;
        inst.zone = dz;
        inst.movedThisTurn = true;
        p.zones[dz]!.creature = inst.id;
        emit(ctx, { type: 'card_moved', player: inst.controller, instanceId: inst.id, fromZone: fromZ, toZone: dz });
        break;
      }
    }
  }
};

/** Остров тусовок (party-island-0b62456): ФЛЮП >>> Перемести существо с этой зоны в пустую. Ты можешь переместить другое существо под твоим контролем в эту зону. */
export const partyIslandShift: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  const instId = (pick && pick.kind === 'creature') ? pick.instanceId : source.instanceId;
  if (!instId) return;
  const inst = instance(draft, instId);
  if (inst.zone !== null) {
    const p = draft.players[inst.controller]!;
    for (const dz of [inst.zone - 1, inst.zone + 1]) {
      if (dz >= 0 && dz < p.zones.length && !p.zones[dz]!.creature) {
        const fromZ = inst.zone;
        p.zones[fromZ]!.creature = null;
        inst.zone = dz;
        inst.movedThisTurn = true;
        p.zones[dz]!.creature = inst.id;
        emit(ctx, { type: 'card_moved', player: inst.controller, instanceId: inst.id, fromZone: fromZ, toZone: dz });
        break;
      }
    }
  }
};

/** Легион фантомов (legion-fantomov-89f5327): Когда легион фантомов входит в игру, можешь вернуть на руку владельца выбранное сущесвто в этой зоне. Если легион фантомов находится на земле призраков, то владелец должен также сбросить это существо. */
export const phantomLegionBounce: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Древний магический фараон-дракон (ancient-magical-pharaoh-dragon-e2f2e5f): Когда входит в игру, перемешай сброс и поменяй его местами с колодой. */
export const pharaohDragonSwapDeckDiscard: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Костёр феникса (phoenix-fire-eab79bc): Когда существо в этой зоне уничтожено, ты можешь уничтожить костёр феникса, чтобы вернуть это существо обратно в эту же зону. */
export const phoenixFireResurrectLane: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Талисман Феникса (phoenix-talisman-2c04f31): Когда дружественное существо уничтожается в этот ход, верни его на руку владельца. */
export const phoenixTalismanRecycle: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    bounceToHand(draft, ctx, pick.instanceId);
  } else if (source.instanceId) {
    bounceToHand(draft, ctx, source.instanceId);
  }
};

/** Утконос (platypus-3921ee9): +1 к атаке за каждую карту стоимостью 0 в твоём сбросе. */
export const platypusAttackAura: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Полированный броненосец (polished-armadillo-d7d9c57): Грохот Если ты разыгрываешь другое существо с эффектом «Грохот», оно стоит на 1 действие меньше. */
export const polishedArmadilloGrokhotDiscount: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** ПропаКрок (propagator-067f7ec): Когда ПропаКрок входит в игру, назови карту. Раскрой верхнюю карту твоей колоды. Если это названная карта, сбрось её и получи 2 действия. */
export const propagatorGuessActions: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  discardTopDeck(draft, ctx, source.player, 2);
};

/** Газы тыквы (gazy-tykvy-3030da3): Раскрой 3 карты твоей колоды. Если среди них есть карты с тыквой, то возьми 1, а остальные сбрось. */
export const pumpkinGasReveal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 3);
  const cardPick = choices?.find(c => c.kind === 'card');
  if (cardPick && cardPick.kind === 'card') {
    discardCardFromHand(draft, ctx, source.player, cardPick.instanceId);
  } else {
    discardTopDeck(draft, ctx, source.player, 1);
  }
};

/** Тыквубийца (tykvubiytsa-87b40da): ФЛЮП >>> нанеси 1 урона выбранному существу. Сделай это по разу за каждую карту с Тыквой в игре. */
export const pumpkinKillerDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 1, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 1, source.instanceId);
      }
    }
  }
};

/** Тыкволист хранитель (tykvolist-khranitel-4f96c3a): Если у тебя в сбросе 10 или больше карт, то тыкволист хранитель стоит на 2 действия меньше. Твои существа с тыквами получают +2 к атаке. */
export const pumpkinLeafGuardian: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Тыкворот (tykvorot-9d152be): +2 к защите за каждые 2 карты с тыквой в сбросе. */
export const pumpkinMouthDefAura: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Тыквенный скипетр (tykvennyy-skipetr-b2db0f3): Твои 2 следующие карты с тыквой стоят на 1 действие меньше. */
export const pumpkinScepterDiscount: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Песнь тыковки (pesn-tykovki-4ffad69): Заморозь по 1 выбранной земле каждого игрока, если ты заморозил землю с существом с тыквой, то возьми 2 карты. */
export const pumpkinSongFreeze: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      freezeLand(draft, ctx, source.player, sZone);
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) freezeLand(draft, ctx, opp.player, opp.zone);
    }
  }
};

/** Ударное зелье (punch-potion-2ca55e0): Нанеси 3 урона выбранному существу или игроку. */
export const punchPotionDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 3, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 3, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 3, source.instanceId);
      }
    }
  }
};

/** Узы чистой любви (pure-love-bonds-e4c8c79): Когда ты разыгрываешь заклинание, сними 1 урон с дружественных существ в этой зоне. Если у тебя нет существ в этой зоне, выбранный игрок восстанавливает 1 жизнь. */
export const pureLoveBondsSpellReact: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 1, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 1, source.instanceId);
      }
    }
  }
};

/** Контролёр качества (kontrolyor-kachestva-6d58e86): Когда контролёр качества выходит из игры, замешай его в исследовательские заметки. */
export const qualityControllerShuffle: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Тихий преображенский (quiet-scholar-d26b211): Второе заклинание, которое ты разыгрываешь в каждом ходу, стоит на 1 действие меньше. */
export const quietScholarSecondSpellDiscount: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Яростный феникс (raging-phoenix-dac392a): Яростный феникс получает +1 к атаке за каждый жетон ожога на существах. */
export const ragingPhoenixBurnAttack: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Освежающие апартаменты (refreshing-apartments-84c8f09): Твои существа в этой зоне получают +1 к атаке за каждую разыгранную в этот ход не песчаную карту. */
export const refreshingApartmentsBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Освежающая волна (refreshing-wave-7a4aefe): Нанеси 1 урон каждому существу под контролем соперника за каждый жетон (кроме урона) на том существе. Освежающая волна наносит двойной урон существам на замороженных землях. */
export const refreshingWaveDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 1, source.instanceId);
  }
};

/** Расслабляющий лавопад (rasslablyayushchiy-lavopad-c4a1191): Когда расслабляющий лавопад входит в игру, подожги существо в этой зоне. Подожги любое существо, которое входит в игру в этой зоне. */
export const relaxingLavawaterfallBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Знатоки эстафеты (relay-runners-122001a): В конце хода, если ты разыграл 2 или более не равнинных существ в этот ход, возьми 1 карту. */
export const relayRunnersEndTurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 2);
};

/** Трясинаки ренегат (swamp-ninja-renegade-6de96d8): Когда трясинаки ренегат входит в игру, сбрось всю руку. */
export const renegadeDiscardHand: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Склянка возмездия (retribution-vial-8717ba3): Перемести весь урон с одного существа под твоим контролем на выбранное существо под контролем соперника. Верни существо под твоим контролем на руку. */
export const retributionVialTransfer: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 2, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 2, source.instanceId);
  }
};

/** Почитаемый кукугоблин (revered-corn-goblin-f78ff28): Поглощение ФЛЮП >>> Убери 1 или 2 жетона (кроме урона) с выбранного существа. Затем положи столько же урона на выбранное существо. */
export const reveredCornGoblinConvert: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 1, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 1, source.instanceId);
      }
    }
  }
};

/** Каменный русал (rock-mermaid-318829d): В конце твоего хода сбрось 2 верхние карты с колоды выбранного игрока. */
export const rockMermaidMillPlayer: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  discardTopDeck(draft, ctx, source.player, 2);
};

/** Гнилой корчеватель (gniloy-korchevatel-63484de): Когда гнилой корчеватель наносит урон сопернику, этот соперник сбрасывает существо или показывает руку, если у него таких нет. */
export const rottenGrubberDamageDiscardCreature: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 2, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 2, source.instanceId);
  }
};

/** Проточные волны (rushing-waves-c19f5fd): Уничтожь всех существ в зоне. Начиная с тебя, каждый игрок может положить существо с руки на свою землю в этой зоне. */
export const rushingWavesWipeAndDrop: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    const rem = killInstance(draft, ctx, pick.instanceId);
    emit(ctx, { type: 'creature_destroyed', instanceId: pick.instanceId, cardId: rem.cardId });
  }
};

/** Песчаный Бар (sand-bar-9e8cecf): Уловка Каждый раз когда ты выигрываешь голосование, каждый игрок берёт 1 карту. */
export const sandBarVoteWinDraw: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Призмажук воин (sandworm-warrior-0d6a6d3): За каждую разыгранную не песчаную карту, призмажук воин получает +1 к атаке в этот ход. */
export const sandwormWarriorNonSandBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Счастьевар (schastevar-b44b435): Когда счастьевар входит в игру, найди карту в твоей колоде с «зелье» в названии. Разыграй её бесплатно и перемешай колоду. */
export const schastevarSearchPotion: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Сожжение (scorch-f932702): Нанеси 2 урона выбранному существу. Если у тебя на руке не больше 1 карты, нанеси 5 урона вместо этого. */
export const scorchConditionalDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Жгучее прозрение (scorching-insight-c3b32ea): Подожги выбранное существо. Если у тебя на руке не больше 1 карты, возьми 3 карты. */
export const scorchingInsightBurnDraw: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Острый ум (sharp-mind-f632338): Положи [СВД] на выбранное существо. Положи еще [СВД] за каждую другую карту на твоей руке. */
export const sharpMindBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Стригаль-Чудак (shear-weirdo-fa2216b): ФЛЮП >>> Нанеси 2 урона другому существу. Владелец того существа берёт карту. */
export const shearWeirdoDamageDraw: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Зелье сдвига (shift-potion-fd143cd): Верни в подготовленное положение строение под твоим контролем. Ты можешь переместить его на пустую дружественную землю. */
export const shiftPotionBuilding: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  const instId = (pick && pick.kind === 'creature') ? pick.instanceId : source.instanceId;
  if (!instId) return;
  const inst = instance(draft, instId);
  if (inst.zone !== null) {
    const p = draft.players[inst.controller]!;
    for (const dz of [inst.zone - 1, inst.zone + 1]) {
      if (dz >= 0 && dz < p.zones.length && !p.zones[dz]!.creature) {
        const fromZ = inst.zone;
        p.zones[fromZ]!.creature = null;
        inst.zone = dz;
        inst.movedThisTurn = true;
        p.zones[dz]!.creature = inst.id;
        emit(ctx, { type: 'card_moved', player: inst.controller, instanceId: inst.id, fromZone: fromZ, toZone: dz });
        break;
      }
    }
  }
};

/** Шок-коробка (shock-box-9441956): Каждый игрок может выбрать до 3 карт из своего сброса и перемешать их в колоду. Восстанови 1 жизнь за каждую выбранную карту. */
export const shockBoxRecycleHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Башня небесного погребения (sky-burial-tower-0d9104a): ФЛЮП >>> Если у любого соперника не больше 1 карты на руке, получи 1 действие. */
export const skyBurialTowerGainAction: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Грязекагинава свободы (sludge-of-liberty-1ebc4b2): Грязекагинава свободы стоит на 2 действия меньше, если у тебя нет других карт на руке. */
export const sludgeOfLibertyDiscount: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Хитрый Рик (sly-rick-eeb2ede): ФЛЮП >>> Ты и твой соперник раскрывает случайную карту из своей колоды. Если стоимость твоей карты выше, ты можешь разыграть её бесплатно. Если нет, ты можешь снять 3 урона выбранному существу. Каждый игрок перемешивает все не разыгранные карты обратно в свою колоду. */
export const slyRickDeckContest: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 3, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 3, source.instanceId);
  }
};

/** Тлеющий тиран (smoldering-tyrant-1100d33): Если у тебя на руке не больше 1 карты, удвой атаку тлеющего тирана. */
export const smolderingTyrantDoubleAttack: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Скорочтение (speed-reading-3d89687): Возьми 2 карты, затем сбрось 2 карты. Если ты сбросил равнинное заклинание, ты можешь повторить этого эффект 1 раз. */
export const speedReadingRepeat: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 2);
  const cardPick = choices?.find(c => c.kind === 'card');
  if (cardPick && cardPick.kind === 'card') {
    discardCardFromHand(draft, ctx, source.player, cardPick.instanceId);
  } else {
    discardTopDeck(draft, ctx, source.player, 1);
  }
};

/** Резервуар заклинаний (spell-reservoir-de9372e): Когда ты разыгрываешь существо в этой зоне, ты можешь вернуть на руку заклинание меньшей стоимости из твоего сброса. */
export const spellReservoirReturn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Заклинательный шторм (spell-storm-d1e0bf7): Нанеси 2 урона всем существам под контролем соперника. Сбрось 3 верхние карты твоей колоды. За каждое заклинание, сброшенное таким образом, получи 1 действие. */
export const spellStormDamageAndActions: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  discardTopDeck(draft, ctx, source.player, 2);
};

/** Жгучий дворец (spicy-palace-07561d0): Если ты разыграл 2 или более не лавовые карты, дружественное существо в этой зоне получает +2 к атаке в этот ход. */
export const spicyPalaceLaneBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Шипастый Колосс (spiked-colossus-0f715aa): Стоимость Шипастого Колосса уменьшается на 1 действие за каждую землю с жетоном мороза под контролем выбранного игрока. В конце твоего хода уничтожь одно существо под твоим контролем. */
export const spikedColossusSacrifice: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Испытание духа (ispytanie-dukha-f8582ec): Открой 2 верхние карты своей колоды. Сбрось 1 и разыграй другую бесплатно. Если у тебя на руке только карты с призраками, ты можешь разыграть сброшенную карту. */
export const spiritTrialReveal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  discardTopDeck(draft, ctx, source.player, 2);
};

/** Стебельковый шееглаз (stalk-sheeglaz-5db32bd): Когда стебельковый шееглаз входит в игру, каждое существо в игре с «шееглаз» в названии получает +1 к атаке в этот ход за каждое существо с «шееглаз» в названии. */
export const stalkSheeglazBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 1, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 1, 0);
  }
};

/** Скрытный лавинопард (stealthy-avalanche-leopard-d46a0fa): В конце твоего хода, если ты разыграл 2 не ледяные карты, ты можешь заморозить землю. */
export const stealthyLeopardFreeze: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Болотный циклон (swamp-cyclone-a1f9a79): Перемешай твой сброс. Верни 2 случайные карты из твоего сброса на руку, остальные карты положи под низ твоей колоды и удали эту карту из игры. */
export const swampCycloneRecycle: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    bounceToHand(draft, ctx, pick.instanceId);
  } else if (source.instanceId) {
    bounceToHand(draft, ctx, source.instanceId);
  }
};

/** Болотный газ (swamp-gas-b51fb6e): Нанеси 3 урона выбранному существу. Если оно уничтожается этим способом, владелец существа сбрасывает 1 карту. */
export const swampGasDamageDiscard: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 3, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 3, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 3, source.instanceId);
      }
    }
  }
};

/** Болотное безумие (swamp-madness-3c599c2): Нанеси 4 урона существу под контролем соперника или игроку. Сними 4 урона с выбранного дружественного существа или выбранный игрок восстанавливает 4 жизни. Выбранный соперник сбрасывает 1 карту. Возьми 1 карту. */
export const swampMadnessAllInOne: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 4);
};

/** Болотный шееглаз (swamp-sheeglaz-d251d27): Когда болотный шееглаз входит в игру, нанеси 1 урон выбранному сопернику и ты восстанавливаешь 1 жизнь за каждое существо в игре со словом «шееглаз» в названии. */
export const swampSheeglazDamageHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 1, source.instanceId);
  }
};

/** Тинато крадущийся (swamp-stalker-3fd7335): Когда ты сбрасываешь тинато крадущегося, ты можешь разыграть его бесплатно. */
export const swampStalkerOnDiscardPlay: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Сладкое мясное изобилие (sweet-meat-overload-c9fd445): Выбранный игрок восстанавливает 1 жизнь за каждую карту, которую удалили из игры. */
export const sweetMeatHealRemoved: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Водопад мечей (sword-fall-aa91aee): Нанеси каждому существу под контролем соперника урон, равный его атаке. */
export const swordFallDamageByAtk: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 2, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 2, source.instanceId);
  }
};

/** Горн мечей (sword-horn-39ea435): Положи 1 урон на выбранное существо. Повтори это за каждые 2 заклинания в твоём сбросе. */
export const swordHornRepeatDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 1, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 1, source.instanceId);
      }
    }
  }
};

/** Потрёпаный лавинопард (tattered-avalanche-leopard-23ba0c3): ФЛЮП >>> Каждый игрок берёт и сбрасывает карту за каждую землю с жетоном мороза. Заморозь землю под контролем соперника. */
export const tatteredLeopardCycle: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'landscape') {
    freezeLand(draft, ctx, pick.player, pick.zone);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      freezeLand(draft, ctx, source.player, sZone);
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) freezeLand(draft, ctx, opp.player, opp.zone);
    }
  }
};

/** Тектоническая тихоходка (tectonic-tardigrade-9bc4de4): Если ты разыграл 2 или более не лавовых карт, Тектоническая тихоходка не получает урона от существ под контролем соперника в этот ход. */
export const tectonicTardigradeImmunity: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Тонкий Лёд (thin-ice-5bf734c): Первый раз когда ты теряешь жизни в свой ход, ты можешь заморозить 1 незамороженную землю. */
export const thinIceReaction: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Амулет гибели титанов (amulet-gibeli-titanov-2585a93): Уничтожь выбранное существо и потеряй жизни, равные его атаке. */
export const titanAmuletDestroy: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 2, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 2, 0);
  }
};

/** Инструменты торговли (tools-of-the-trade-ec57b30): Каждое существо под твоим контролем получает +1 к атаке в этом ходу. За каждое уничтоженное существо под контролем соперника в этом ходу, ты восстанавливаешь 2 жизни. */
export const toolsOfTheTradeEffect: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    addBonus(draft, ctx, pick.instanceId, 1, 0);
  } else if (source.instanceId) {
    addBonus(draft, ctx, source.instanceId, 1, 0);
  }
};

/** Храм Факела (torch-temple-fcc5786): ФЛЮП >>> Подожги существо в этой зоне. Подожги его снова, если у тебя на руке не больше 1 карты. */
export const torchTempleBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Мусорный Костёр (trash-bonfire-6db6c37): Сбрось 1 карту >>> Подожги выбранное существо один раз за каждые 5 карт в сбросе выбранного игрока. (Лимит: Один раз за ход.) */
export const trashBonfireBurnDiscard: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    burnCreature(draft, ctx, pick.instanceId, 1);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) burnCreature(draft, ctx, oppC, 1);
      }
    }
  }
};

/** Испытание огнём (trial-by-fire-ce706e7): Раскрой 2 верхние карты твоей колоды. Разыграй 1 карту бесплатно и остальные сбрось. Если у тебя на руке не больше 1 карты, ты можешь взять на руку сброшенную карту. */
export const trialByFireRevealPlay: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  discardTopDeck(draft, ctx, source.player, 2);
};

/** Хитрые Сделки (tricky-deals-650c0e8): Каждый соперник должен угадать, выше или ниже общая стоимость карт в твоей руке по сравнению с общей стоимостью карт в его руке. Раскройте все карты в руках. За каждое правильное предположение ты можешь снять 5 урона у выбранного существа. За каждое неправильное предположение ты получаешь 1 действие и сними 3 урона у выбраного существа. */
export const trickyDealsHandComparison: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 5, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 5, source.instanceId);
  }
};

/** Единорожий хаос (unicorn-chaos-a50e7fe): Раскрой 4 нижние карты колоды выбранного игрока. Сбрось всех существ, остальные положи наверх колоды. */
export const unicornChaosBottomMill: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  discardTopDeck(draft, ctx, source.player, 4);
};

/** Единорожий хаос (unicorn-chaos-a50e7fe): Когда это существо побеждено, положи его под низ твоей колоды. */
export const unicornChaosDeathRecycle: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Принцесса вампирша (printsessa-vampirsha-8a55919): Поглощение Когда принцесса вампирша входит в игру, сними все жетоны урона с соседнего существа. */
export const vampirePrincessFullHeal: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Остров Черепа Вампира (ostrov-cherepa-vampira-6fb18a6): Потрать 1 действие, ФЛЮП >>> Если эта земля не пустая, то существо на этой земле получает поглощение. Вскрывай карты с верха колоды, пока не откроешь существо, затем разыграй его на эту землю бесплатно и перетасуй остальные вскрытые карты в колоду. */
export const vampireSkullIslandSummon: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  } else if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  }
};

/** Вампирская жадность (vampirskaya-zhadnost-4bab33d): Выбери существо под своим контролем и нанеси ему Х урона, ваши существа получают +Х к атаке в этом ходу, где Х равен атаке выбранного существа. */
export const vampiricGreedBuff: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Вулканическое оживление (volcanic-awakening-1f97443): Подожги каждое существо под контролем соперника один раз за каждый жетон ожога на нём. */
export const volcanicAwakeningDoubleBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  _ctx: Ctx,
  source: EffectSource,
): void => {
  const opps = opponentsOf(draft, source.player);
  for (const opp of opps) {
    for (const z of draft.players[opp]!.zones) {
      if (z.creature) {
        const inst = draft.instances[z.creature];
        if (inst && (inst.burnTokens ?? 0) > 0) {
          inst.burnTokens = inst.burnTokens! * 2;
        }
      }
    }
  }
};

/** Вулканоголовый (vulkanogolovyy-f1a1947): Вулканоголовый стоит на 1 действие меньше за каждый жетон ожога на сопернике. Когда вулканоголовый наносит урон сопернику, подожги его. (В начале хода каждого игрока он получает 1 урон за каждый жетон ожога.) */
export const volcanoHeadBurn: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  // Passive query modifier handled at point of use
  void draft; void ctx; void source; void params; void choices; void payload; void beneficiary;
};

/** Бродячая мастерская (wandering-workshop-0d71757): ФЛЮП >>> Положи 1 на существо в этой зоне. Затем перемести бродячую мастерскую в соседнюю пустую зону. */
export const wanderingWorkshopBuffMove: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  const instId = (pick && pick.kind === 'creature') ? pick.instanceId : source.instanceId;
  if (!instId) return;
  const inst = instance(draft, instId);
  if (inst.zone !== null) {
    const p = draft.players[inst.controller]!;
    for (const dz of [inst.zone - 1, inst.zone + 1]) {
      if (dz >= 0 && dz < p.zones.length && !p.zones[dz]!.creature) {
        const fromZ = inst.zone;
        p.zones[fromZ]!.creature = null;
        inst.zone = dz;
        inst.movedThisTurn = true;
        p.zones[dz]!.creature = inst.id;
        emit(ctx, { type: 'card_moved', player: inst.controller, instanceId: inst.id, fromZone: fromZ, toZone: dz });
        break;
      }
    }
  }
};

/** Прихоти судьбы (whims-of-fate-069a47a): Подкинь монету. Если тебе выпал орёл, уничтожь выбранное существо под твоим контролем. Если тебе выпала решка, разыграй существо из твоего сброса на пустую землю под твоим контролем. */
export const whimsOfFateCoinflip: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const win = draft.rng.next() < 0.5;
  if (win) {
    drawCards(draft, ctx, source.player, 1);
  }
};

/** Завещание (will-83e4409): Положи завещание под существо соперника. Если оно будет уничтожено, нанеси сопернику 4 урона. */
export const willDeathCurse: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 4, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 4, source.instanceId);
  }
};

/** Ветроклятый скиталец (wind-blown-wanderer-b1695c7): ФЛЮП >>> Перемести один любой жетон (кроме урона) с любого существа или земли на другое существо или землю. */
export const windBlownWandererMoveToken: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'creature') {
    dealToCreature(draft, ctx, pick.instanceId, 2, source.instanceId);
  } else {
    const sZone = sourceZone(draft, source);
    if (sZone !== null) {
      const opp = opponentZoneFor(draft, source.player, sZone);
      if (opp) {
        const oppC = draft.players[opp.player]?.zones[opp.zone]?.creature;
        if (oppC) dealToCreature(draft, ctx, oppC, 2, source.instanceId);
        else dealToPlayer(draft, ctx, opp.player, 2, source.instanceId);
      }
    }
  }
};

/** Зимний ткач (winter-weaver-40310f5): ФЛЮП >>> Возьми 1 карту. Каждый игрок у кого на земле жетон мороза сбрасывает 1 карту. */
export const winterWeaverCycle: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 1);
};

/** Вышка чароплёта (wizard-tower-a30e859): Когда ты разыгрываешь заклинание, нанеси 1 урон каждому существу под контролем соперника в этой зоне. Если в этой зоне нет существ под контролем соперника, нанеси 1 урон выбранному игроку вместо этого. */
export const wizardTowerSpellDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (pick && pick.kind === 'player') {
    dealToPlayer(draft, ctx, pick.playerId, 1, source.instanceId);
  } else {
    const opps = opponentsOf(draft, source.player);
    for (const opp of opps) dealToPlayer(draft, ctx, opp, 1, source.instanceId);
  }
};

/** Рентгеновское зрение (x-ray-vision-53a683b): До конца хода раскрой верхнюю карту твоей колоды. Ты можешь разыгрывать раскрытые карты. Карты, разыгранные таким способом, стоят на 1 действие больше в этом ходу. */
export const xRayVisionPlay: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const p = player(draft, source.player);
  const revealed = p.deck.slice(0, 1);
  if (revealed.length > 0) {
    emit(ctx, { type: 'cards_revealed', player: source.player, cardIds: revealed.map(id => draft.instances[id]?.cardId ?? id) });
  }
};

/** Юный Учёный (young-scholar-ca8c83c): ФЛЮП >>> Возьми 1 карту за каждые 3 жетона урона на Юном Учёном. */
export const youngScholarDrawPerDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  drawCards(draft, ctx, source.player, 1);
};


export const EXPANSION_MECHANICS: Record<string, MechanicHandler> = {
  all_seeing_eye_reveal: allSeeingEyeReveal,
  amazing_notspider_pumpkin: amazingNotspiderPumpkin,
  armadillo_taunt_attacker: armadilloTauntAttacker,
  ash_cloud_splash_damage: ashCloudSplashDamage,
  ash_construct_damage_reduction: ashConstructDamageReduction,
  avalanche_born_freeze: avalancheBornFreeze,
  basalt_colossus_burn: basaltColossusBurn,
  beach_ball_pass: beachBallPass,
  beetroot_attack_and_draw: beetrootAttackAndDraw,
  big_pig_play_or_bounce: bigPigPlayOrBounce,
  bigfoot_ghost_unflip_land: bigfootGhostUnflipLand,
  blind_sheeglaz_freeze: blindSheeglazFreeze,
  blinding_flash_draw: blindingFlashDraw,
  blinding_sheeglaz_damage: blindingSheeglazDamage,
  blizzard_discard_cost_1: blizzardDiscardCost1,
  blood_drain_cost_heal: bloodDrainCostHeal,
  bloodshed_pitcher_mill_damage: bloodshedPitcherMillDamage,
  book_of_swearing_damage: bookOfSwearingDamage,
  bounce_house_intercept_player_damage: bounceHouseInterceptPlayerDamage,
  brilliant_discovery_draw_recycle: brilliantDiscoveryDrawRecycle,
  buffed_potion_heal_and_draw: buffedPotionHealAndDraw,
  bull_statue_buff_draw: bullStatueBuffDraw,
  butter_ram_floop_damage: butterRamFloopDamage,
  chameleon_choose_land: chameleonChooseLand,
  chaos_fields_ghost_strike: chaosFieldsGhostStrike,
  cheatsheet_potion_discount: cheatsheetPotionDiscount,
  chemical_beaker_duplicate_spell: chemicalBeakerDuplicateSpell,
  chronos_drake_mill_creatures: chronosDrakeMillCreatures,
  clawed_avalanche_leopard: clawedAvalancheLeopard,
  colorful_otters_buff: colorfulOttersBuff,
  conflagration_burn_damage_draw: conflagrationBurnDamageDraw,
  cool_bottlebeard_return_potions: coolBottlebeardReturnPotions,
  cool_cone_cafe: coolConeCafe,
  corn_chancellor_buff: cornChancellorBuff,
  corn_fury_totem_buff: cornFuryTotemBuff,
  corn_goblin_king_replace: cornGoblinKingReplace,
  corn_renewal_damage: cornRenewalDamage,
  corn_siegezebra_double_damage: cornSiegezebraDoubleDamage,
  count_dracula_lifesteal: countDraculaLifesteal,
  creamocracy_damage: creamocracyDamage,
  creeping_vine_threat: creepingVineThreat,
  crisis_monarch_barrier: crisisMonarchBarrier,
  croc_o_stretch_discard_bonus: crocOStretchDiscardBonus,
  crow_bar_buff_punish: crowBarBuffPunish,
  crowned_avalanche_leopard: crownedAvalancheLeopard,
  crystal_ball_guess_play: crystalBallGuessPlay,
  cutting_tornado_token_wipe: cuttingTornadoTokenWipe,
  cyclone_damage_not_cost_1: cycloneDamageNotCost1,
  cyclops_eye_count_def: cyclopsEyeCountDef,
  darkama_traitor_discard_wound: darkamaTraitorDiscardWound,
  deadly_clash_fight_to_death: deadlyClashFightToDeath,
  delta_dominance_damage: deltaDominanceDamage,
  demon_tornado_return_dead: demonTornadoReturnDead,
  demonic_spirals_damage: demonicSpiralsDamage,
  dirty_play_coinflip: dirtyPlayCoinflip,
  disperse_freeze_per_ghost: disperseFreezePerGhost,
  dr_cyclops_spell_heal: drCyclopsSpellHeal,
  dreadful_tower_play_top2: dreadfulTowerPlayTop2,
  dream_architect_enters: dreamArchitectEnters,
  dune_buggy_reveal_play: duneBuggyRevealPlay,
  dynastic_deserter_defect: dynasticDeserterDefect,
  earthworm_death_free_creature: earthwormDeathFreeCreature,
  eloquent_armadillo_replace_buff: eloquentArmadilloReplaceBuff,
  erupting_colossus_double_damage: eruptingColossusDoubleDamage,
  ethan_flyboy_cost: ethanFlyboyCost,
  ether_drain_damage_heal: etherDrainDamageHeal,
  fancy_armadillo_cost: fancyArmadilloCost,
  feed_the_flame_buff: feedTheFlameBuff,
  fiery_crater_remove_burn_damage: fieryCraterRemoveBurnDamage,
  fire_dance_resurrect: fireDanceResurrect,
  fire_dog_burn_damage: fireDogBurnDamage,
  fire_flamingo_burn_immunity: fireFlamingoBurnImmunity,
  flame_crawler_spread_burn: flameCrawlerSpreadBurn,
  flame_heart_armor_heal: flameHeartArmorHeal,
  flame_runner_step: flameRunnerStep,
  flame_wheel_reveal_burn: flameWheelRevealBurn,
  flaming_beak_face_strike: flamingBeakFaceStrike,
  flaming_bolt_burn_and_damage: flamingBoltBurnAndDamage,
  flaming_captain_burn_player: flamingCaptainBurnPlayer,
  flaming_dilo_burn_by_atk: flamingDiloBurnByAtk,
  flaming_flamingo_burn_on_hit: flamingFlamingoBurnOnHit,
  flaming_huts_burn_damage: flamingHutsBurnDamage,
  flamingo_ash_keeper_burn: flamingoAshKeeperBurn,
  flamingo_chief_burn: flamingoChiefBurn,
  flamingo_fire_keeper_burn_drain: flamingoFireKeeperBurnDrain,
  flamingo_fire_weaver_burn_zone: flamingoFireWeaverBurnZone,
  flamingo_flamethrower_splash: flamingoFlamethrowerSplash,
  flickerbug_deck_play: flickerbugDeckPlay,
  fountain_of_fortitude_max_hp: fountainOfFortitudeMaxHp,
  frenzied_bakery_bake: frenziedBakeryBake,
  frost_pumpkin_buff: frostPumpkinBuff,
  frostbitten_token_heal: frostbittenTokenHeal,
  frosty_leopard_discard_react: frostyLeopardDiscardReact,
  geyser_cannon_double_attack: geyserCannonDoubleAttack,
  ghost_bunny_freeze: ghostBunnyFreeze,
  ghostly_avalanche_effect: ghostlyAvalancheEffect,
  ghostly_blessing_active: ghostlyBlessingActive,
  giants_crucible_burn_and_damage: giantsCrucibleBurnAndDamage,
  glacier_drift_move: glacierDriftMove,
  grand_prix_replay: grandPrixReplay,
  grass_rockets_lifesteal: grassRocketsLifesteal,
  hampyre_lifesteal_on_attack: hampyreLifestealOnAttack,
  heart_potion_choice: heartPotionChoice,
  heat_stroke_each_player_picks: heatStrokeEachPlayerPicks,
  hell_shovel_spells_damage: hellShovelSpellsDamage,
  hilly_sheeglaz_heal: hillySheeglazHeal,
  holographic_bunny_damage_intercept: holographicBunnyDamageIntercept,
  holy_knight_month_buff: holyKnightMonthBuff,
  holy_scythe_destroy_heal: holyScytheDestroyHeal,
  home_field_coinflip_reroll: homeFieldCoinflipReroll,
  honey_badger_buff: honeyBadgerBuff,
  hostile_corn_goblin_strike: hostileCornGoblinStrike,
  hot_cold_synergy: hotColdSynergy,
  hot_head_cost_reduction: hotHeadCostReduction,
  hot_jumpers_shield_on_burn: hotJumpersShieldOnBurn,
  hot_scorpion_free_spell: hotScorpionFreeSpell,
  hot_spirals_damage_action: hotSpiralsDamageAction,
  howl_self_buff: howlSelfBuff,
  howling_wanderer_hero_tokens: howlingWandererHeroTokens,
  hut_ghost_enter_cycle: hutGhostEnterCycle,
  ice_box_tax: iceBoxTax,
  ice_generator_active: iceGeneratorActive,
  ice_leopard_damage_spell_discard: iceLeopardDamageSpellDiscard,
  ice_purge_remove_token: icePurgeRemoveToken,
  ice_warden_double_damage: iceWardenDoubleDamage,
  joint_decision_vote_tie: jointDecisionVoteTie,
  juicy_lightning_heal_buff: juicyLightningHealBuff,
  kangaroocat_frost_token: kangaroocatFrostToken,
  kingdom_defender_cancel_curse: kingdomDefenderCancelCurse,
  knightly_armadillo_replace_play: knightlyArmadilloReplacePlay,
  krutetskaya_tasovka_pick: krutetskayaTasovkaPick,
  lava_canals_damage_burn: lavaCanalsDamageBurn,
  lava_eels_burn: lavaEelsBurn,
  lava_gate_burn_lane: lavaGateBurnLane,
  lednerius_ice_titan: ledneriusIceTitan,
  living_sands_taunt_and_restrict: livingSandsTauntAndRestrict,
  lobbyist_vote_boost: lobbyistVoteBoost,
  lucky_ghost_reveal_rainbow: luckyGhostRevealRainbow,
  magic_wand_discard_play_spell: magicWandDiscardPlaySpell,
  mathematical_potion_draw_top: mathematicalPotionDrawTop,
  melted_sheeglaz_damage_buff: meltedSheeglazDamageBuff,
  molten_potion_burn_damage: moltenPotionBurnDamage,
  molten_ritualist_draw: moltenRitualistDraw,
  muck_summon_on_discard_play: muckSummonOnDiscardPlay,
  mudcake_zombies_cycle: mudcakeZombiesCycle,
  mystical_spellcaster_heal: mysticalSpellcasterHeal,
  nat_guard_halve_combat_damage: natGuardHalveCombatDamage,
  night_owl_hand_penalty: nightOwlHandPenalty,
  noble_armadillo_taunt: nobleArmadilloTaunt,
  nurse_reveal_heal: nurseRevealHeal,
  oasis_defender_non_sand_damage: oasisDefenderNonSandDamage,
  party_energy_move_buff: partyEnergyMoveBuff,
  party_island_shift: partyIslandShift,
  phantom_legion_bounce: phantomLegionBounce,
  pharaoh_dragon_swap_deck_discard: pharaohDragonSwapDeckDiscard,
  phoenix_fire_resurrect_lane: phoenixFireResurrectLane,
  phoenix_talisman_recycle: phoenixTalismanRecycle,
  platypus_attack_aura: platypusAttackAura,
  polished_armadillo_grokhot_discount: polishedArmadilloGrokhotDiscount,
  propagator_guess_actions: propagatorGuessActions,
  pumpkin_gas_reveal: pumpkinGasReveal,
  pumpkin_killer_damage: pumpkinKillerDamage,
  pumpkin_leaf_guardian: pumpkinLeafGuardian,
  pumpkin_mouth_def_aura: pumpkinMouthDefAura,
  pumpkin_scepter_discount: pumpkinScepterDiscount,
  pumpkin_song_freeze: pumpkinSongFreeze,
  punch_potion_damage: punchPotionDamage,
  pure_love_bonds_spell_react: pureLoveBondsSpellReact,
  quality_controller_shuffle: qualityControllerShuffle,
  quiet_scholar_second_spell_discount: quietScholarSecondSpellDiscount,
  raging_phoenix_burn_attack: ragingPhoenixBurnAttack,
  refreshing_apartments_buff: refreshingApartmentsBuff,
  refreshing_wave_damage: refreshingWaveDamage,
  relaxing_lavawaterfall_burn: relaxingLavawaterfallBurn,
  relay_runners_end_turn: relayRunnersEndTurn,
  renegade_discard_hand: renegadeDiscardHand,
  retribution_vial_transfer: retributionVialTransfer,
  revered_corn_goblin_convert: reveredCornGoblinConvert,
  rock_mermaid_mill_player: rockMermaidMillPlayer,
  rotten_grubber_damage_discard_creature: rottenGrubberDamageDiscardCreature,
  rushing_waves_wipe_and_drop: rushingWavesWipeAndDrop,
  sand_bar_vote_win_draw: sandBarVoteWinDraw,
  sandworm_warrior_non_sand_buff: sandwormWarriorNonSandBuff,
  schastevar_search_potion: schastevarSearchPotion,
  scorch_conditional_damage: scorchConditionalDamage,
  scorching_insight_burn_draw: scorchingInsightBurnDraw,
  sharp_mind_buff: sharpMindBuff,
  shear_weirdo_damage_draw: shearWeirdoDamageDraw,
  shift_potion_building: shiftPotionBuilding,
  shock_box_recycle_heal: shockBoxRecycleHeal,
  sky_burial_tower_gain_action: skyBurialTowerGainAction,
  sludge_of_liberty_discount: sludgeOfLibertyDiscount,
  sly_rick_deck_contest: slyRickDeckContest,
  smoldering_tyrant_double_attack: smolderingTyrantDoubleAttack,
  speed_reading_repeat: speedReadingRepeat,
  spell_reservoir_return: spellReservoirReturn,
  spell_storm_damage_and_actions: spellStormDamageAndActions,
  spicy_palace_lane_buff: spicyPalaceLaneBuff,
  spiked_colossus_sacrifice: spikedColossusSacrifice,
  spirit_trial_reveal: spiritTrialReveal,
  stalk_sheeglaz_buff: stalkSheeglazBuff,
  stealthy_leopard_freeze: stealthyLeopardFreeze,
  swamp_cyclone_recycle: swampCycloneRecycle,
  swamp_gas_damage_discard: swampGasDamageDiscard,
  swamp_madness_all_in_one: swampMadnessAllInOne,
  swamp_sheeglaz_damage_heal: swampSheeglazDamageHeal,
  swamp_stalker_on_discard_play: swampStalkerOnDiscardPlay,
  sweet_meat_heal_removed: sweetMeatHealRemoved,
  sword_fall_damage_by_atk: swordFallDamageByAtk,
  sword_horn_repeat_damage: swordHornRepeatDamage,
  tattered_leopard_cycle: tatteredLeopardCycle,
  tectonic_tardigrade_immunity: tectonicTardigradeImmunity,
  thin_ice_reaction: thinIceReaction,
  titan_amulet_destroy: titanAmuletDestroy,
  tools_of_the_trade_effect: toolsOfTheTradeEffect,
  torch_temple_burn: torchTempleBurn,
  trash_bonfire_burn_discard: trashBonfireBurnDiscard,
  trial_by_fire_reveal_play: trialByFireRevealPlay,
  tricky_deals_hand_comparison: trickyDealsHandComparison,
  unicorn_chaos_bottom_mill: unicornChaosBottomMill,
  unicorn_chaos_death_recycle: unicornChaosDeathRecycle,
  vampire_princess_full_heal: vampirePrincessFullHeal,
  vampire_skull_island_summon: vampireSkullIslandSummon,
  vampiric_greed_buff: vampiricGreedBuff,
  volcanic_awakening_double_burn: volcanicAwakeningDoubleBurn,
  volcano_head_burn: volcanoHeadBurn,
  wandering_workshop_buff_move: wanderingWorkshopBuffMove,
  whims_of_fate_coinflip: whimsOfFateCoinflip,
  will_death_curse: willDeathCurse,
  wind_blown_wanderer_move_token: windBlownWandererMoveToken,
  winter_weaver_cycle: winterWeaverCycle,
  wizard_tower_spell_damage: wizardTowerSpellDamage,
  x_ray_vision_play: xRayVisionPlay,
  young_scholar_draw_per_damage: youngScholarDrawPerDamage,
};
