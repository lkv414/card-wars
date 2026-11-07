import type { Draft } from 'immer';
import { dealToCreature, dealToPlayer, killInstance } from '../damage';
import { DomainError } from '../errors';
import { drawCards } from '../draw';
import { emit, instance, player } from '../util';
import { computeEff } from '../stats';
import { opponentsOf, teammatesOf } from '../zones';
import { pickRandom, shuffle } from '../rng';
import type { Ctx } from '../util';
import type { LandType, MatchState, PlayerId } from '../types';
import type { EffectSource, MechanicHandler } from './registry';
import { noteDiscard } from './effects';

const land = (draft: MatchState, pid: PlayerId, zone: number) => draft.players[pid]!.lands[zone]!;

function moveCreature(draft: Draft<MatchState>, ctx: Ctx, instanceId: string, destPlayer: PlayerId, zone: number): boolean {
  const inst = instance(draft, instanceId);
  if (inst.location !== 'field' || inst.slot !== 'creature' || inst.zone === null) return false;
  const from = inst.zone;
  if (destPlayer === inst.controller && zone === from) return false;
  if (draft.players[destPlayer]!.zones[zone]!.creature) return false;
  draft.players[inst.controller]!.zones[from]!.creature = null;
  inst.zone = zone;
  inst.movedThisTurn = true;
  draft.players[destPlayer]!.zones[zone]!.creature = instanceId;
  emit(ctx, { type: 'card_moved', player: destPlayer, instanceId, fromZone: from, toZone: zone });
  return true;
}

function playCardFree(draft: Draft<MatchState>, ctx: Ctx, source: EffectSource, instanceId: string, destZone: number | null): boolean {
  const inst = instance(draft, instanceId);
  const card = ctx.catalog.getCard(inst.cardId);
  if (!card) return false;
  const owner = player(draft, source.player);
  inst.controller = source.player;
  inst.location = 'field';
  inst.playedTurn = draft.turn;
  inst.enteredThisTurn = true;
  const slot = card.type === 'building' ? 'building' : 'creature';
  let zone = destZone;
  if (zone === null) {
    zone = owner.zones.findIndex((z) => !z[card.type === 'building' ? 'building' : 'creature']);
    if (zone < 0) return false;
  }
  if (owner.zones[zone]![slot]) return false;
  owner.zones[zone]![slot] = instanceId;
  inst.zone = zone;
  emit(ctx, { type: 'card_played', player: source.player, instanceId, cardId: card.id, zone, slot, replacedInstanceId: null });
  return true;
}

function deckRemove(draft: Draft<MatchState>, playerId: PlayerId, instanceId: string): void {
  const p = draft.players[playerId]!;
  p.deck = p.deck.filter((x) => x !== instanceId);
}

/** fiona_card_22: тяни карту, сбрось случайную; радужная — +1 действие. */
export const drawDiscardRainbowAction: MechanicHandler = (draft, ctx, source) => {
  drawCards(draft, ctx, source.player, 1);
  const p = player(draft, source.player);
  const id = pickRandom(draft.rng, p.hand);
  if (!id) return;
  const inst = instance(draft, id);
  inst.location = 'discard';
  p.hand = p.hand.filter((x) => x !== id);
  p.discard.push(id);
  emit(ctx, { type: 'card_discarded', player: source.player, instanceId: id, cardId: inst.cardId, from: 'hand' });
  noteDiscard(draft, ctx, source.player, { instanceId: id, cardId: inst.cardId, from: 'hand' });
  if (ctx.catalog.getCard(inst.cardId)?.landType === 'rainbow') {
    p.actions += 1;
  }
};

/** fiona_card_23: сбрось случайную свою карту руки — верни себя из сброса в руку. */
export const discardToReturnSelf: MechanicHandler = (draft, ctx, source) => {
  const id = source.instanceId;
  if (!id) return;
  const inst = instance(draft, id);
  if (inst.location !== 'discard') return;
  const p = player(draft, source.player);
  const pay = pickRandom(draft.rng, p.hand);
  if (!pay) return;
  const payInst = instance(draft, pay);
  payInst.location = 'discard';
  p.hand = p.hand.filter((x) => x !== pay);
  p.discard.push(pay);
  emit(ctx, { type: 'card_discarded', player: source.player, instanceId: pay, cardId: payInst.cardId, from: 'hand' });
  noteDiscard(draft, ctx, source.player, { instanceId: pay, cardId: payInst.cardId, from: 'hand' });
  p.discard = p.discard.filter((x) => x !== id);
  inst.location = 'hand';
  inst.zone = null;
  inst.slot = null;
  p.hand.push(id);
  emit(ctx, { type: 'card_returned', player: source.player, instanceId: id, cardId: inst.cardId });
};

/** ftg_card_15: подготовить по одному своему существу каждого типа. */
export const readyPerType: MechanicHandler = (draft, ctx, source, params) => {
  const types = (params?.types as LandType[] | undefined) ?? [];
  const p = player(draft, source.player);
  for (const type of types) {
    for (const z of p.zones) {
      const id = z.creature;
      if (!id) continue;
      const inst = instance(draft, id);
      const card = ctx.catalog.getCard(inst.cardId);
      if (card?.landType !== type || !inst.flipped) continue;
      inst.flipped = false;
      emit(ctx, { type: 'bonus_changed', instanceId: id, cardId: inst.cardId, bonusAttack: inst.bonusAttack, bonusDefense: inst.bonusDefense });
      break;
    }
  }
};

/** ftg_card_26: в начале хода владельца каждый игрок с существом в этой линии тянет карту. */
export const drawToLanePlayers: MechanicHandler = (draft, ctx, source) => {
  if (!source.instanceId) return;
  const zone = instance(draft, source.instanceId).zone;
  if (zone === null) return;
  for (const pid of draft.order) {
    if (!draft.players[pid]!.zones[zone]!.creature) continue;
    drawCards(draft, ctx, pid, 1);
  }
};

/** grand_prix_card_11: лечит по 1 урона со своих существ, пока хватает земель с жетонами. */
export const healOnePerIceLand: MechanicHandler = (draft, ctx, source) => {
  let heals = 0;
  for (const pid of draft.order) {
    for (const l of draft.players[pid]!.lands) {
      if (l.iceTokens > 0) heals += 1;
    }
  }
  if (heals === 0) return;
  const p = player(draft, source.player);
  for (const z of p.zones) {
    if (heals === 0) return;
    const id = z.creature;
    if (!id) continue;
    const inst = instance(draft, id);
    if (inst.damage <= 0) continue;
    inst.damage -= 1;
    heals -= 1;
    emit(ctx, { type: 'creature_healed', instanceId: id, amount: 1 });
  }
};

/** grand_prix_card_18: урон цели; если погибла — заморозить землю под ней. */
export const damageThenFreezeLand: MechanicHandler = (draft, ctx, source, params, choices) => {
  const amount = Number(params?.amount ?? 2);
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') throw new DomainError('invalid_choice', 'needs a creature');
  const targetZone = instance(draft, pick.instanceId).zone;
  dealToCreature(draft, ctx, pick.instanceId, amount, source.instanceId);
  const inst = instance(draft, pick.instanceId);
  if (inst.location === 'discard' && targetZone !== null) {
    const controller = inst.controller;
    const l = land(draft, controller, targetZone);
    if (!l.frozen) {
      l.frozen = true;
      emit(ctx, { type: 'land_changed', player: controller, zone: targetZone, change: 'frozen' });
    }
  }
};

/** ice_king_card_3: переместить себя на свою пустую землю; заморожена — +1 действие. */
export const moveSelfGainActionIfFrozen: MechanicHandler = (draft, ctx, source, _params, choices) => {
  const id = source.instanceId;
  if (!id) return;
  const answer = choices?.[0];
  if (!answer || answer.kind !== 'landscape') throw new DomainError('invalid_choice', 'needs a landscape');
  const moved = moveCreature(draft, ctx, id, answer.player, answer.zone);
  if (moved && land(draft, answer.player, answer.zone).frozen) {
    const p = player(draft, source.player);
    p.actions += 1;
  }
};

/** jake_card_6: при входе переместить существо противника в зеркальной зоне на соседнюю пустую его стороны. */
export const enterMoveLaneCreature: MechanicHandler = (draft, ctx, source, _params, _choices, payload) => {
  if (!source.instanceId || payload?.zone === undefined || payload.zone === null) return;
  for (const pid of opponentsOf(draft, source.player)) {
    const victimId = draft.players[pid]!.zones[payload.zone]!.creature;
    if (!victimId) continue;
    const victim = instance(draft, victimId);
    if (victim.zone === null) continue;
    for (const nz of [victim.zone - 1, victim.zone + 1]) {
      if (nz < 0 || nz >= 4) continue;
      if (!draft.players[pid]!.zones[nz]!.creature) {
        moveCreature(draft, ctx, victimId, pid, nz);
        return;
      }
    }
  }
};

/** lich_card_43: 2 урона случайному соседу цели на её стороне. */
export const splashTargetAllies: MechanicHandler = (draft, ctx, source, params, _choices, payload) => {
  const amount = Number(params?.amount ?? 2);
  const targetId = payload?.targetInstanceId;
  if (!targetId) return;
  const target = instance(draft, targetId);
  if (target.zone === null) return;
  const p = draft.players[target.controller]!;
  const allies = [target.zone - 1, target.zone + 1]
    .filter((z) => z >= 0 && z < p.zones.length)
    .map((z) => p.zones[z]!.creature)
    .filter((x): x is string => x !== null);
  if (allies.length === 0) return;
  const victimId = pickRandom(draft.rng, allies)!;
  dealToCreature(draft, ctx, victimId, amount, source.instanceId);
};

/** lich_card_46: уничтожить своё существо; урон < половины DEF — тяни 3, иначе 2. */
export const sacrificeHalfDefDraw: MechanicHandler = (draft, ctx, source, params, choices) => {
  const full = Number(params?.full ?? 3);
  const fallback = Number(params?.else ?? 2);
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') throw new DomainError('invalid_choice', 'needs an own creature');
  const inst = instance(draft, pick.instanceId);
  const def = computeEff(draft, ctx, pick.instanceId).defense;
  const half = inst.damage * 2 < def;
  killInstance(draft, ctx, pick.instanceId);
  emit(ctx, { type: 'creature_destroyed', instanceId: pick.instanceId, cardId: inst.cardId });
  drawCards(draft, ctx, source.player, half ? full : fallback);
};

/** jake_2v2_card_23/24: покидая игру в свою фазу сражения — в руку или на верх колоды. */
export const selfRescueOnDeath: MechanicHandler = (draft, ctx, source, params) => {
  const id = source.instanceId;
  if (!id) return;
  const inst = instance(draft, id);
  if (inst.location !== 'discard') return;
  const p = player(draft, source.player);
  p.discard = p.discard.filter((x) => x !== id);
  inst.location = 'deck';
  inst.zone = null;
  inst.slot = null;
  inst.damage = 0;
  if (params?.destination === 'hand') {
    inst.location = 'hand';
    p.hand.push(id);
    emit(ctx, { type: 'card_returned', player: source.player, instanceId: id, cardId: inst.cardId });
  } else {
    p.deck.unshift(id);
    emit(ctx, { type: 'card_drawn', player: source.player, count: 0 });
  }
};

/** jake_2v2_card_35: каждый игрок тянет верхнее существо заданного типа (земля из выбора). */
export const eachDrawCreatureOfType: MechanicHandler = (draft, ctx, _source, _params, choices) => {
  const zoneAnswer = choices?.find((c) => c.kind === 'landscape');
  if (!zoneAnswer || zoneAnswer.kind !== 'landscape') throw new DomainError('invalid_choice', 'needs a landscape');
  const type = land(draft, zoneAnswer.player, zoneAnswer.zone).type;
  for (const pid of draft.order) {
    const p = draft.players[pid]!;
    const idx = p.deck.findIndex((id) => {
      const card = ctx.catalog.getCard(draft.instances[id]!.cardId);
      return card?.type === 'creature' && card.landType === type;
    });
    if (idx < 0) continue;
    const id = p.deck.splice(idx, 1)[0]!;
    const inst = instance(draft, id);
    inst.location = 'hand';
    p.hand.push(id);
    emit(ctx, { type: 'card_drawn', player: pid, count: 1 });
  }
};

/** jake_2v2_card_34 / grand_prix_card_6: вооружить бесплатный розыгрыш. */
export const armFreePlay: MechanicHandler = (draft, ctx, source, params, _choices, payload) => {
  draft.armedFreePlays.push({
    player: source.player,
    landType: params?.landType as string | undefined,
    maxCost: params?.costFromPayload ? payload?.cost : (params?.maxCost as number | undefined),
    name: params?.nameRequired && source.instanceId
      ? ctx.catalog.getCard(instance(draft, source.instanceId).cardId)?.name
      : undefined,
    expiresTurn: draft.turn + 1,
  });
};

/** marceline_card_9: противники сбрасывают карту стоимости 0 или показывают руку. */
export const discardCost0OrRevealHand: MechanicHandler = (draft, ctx, source) => {
  for (const pid of opponentsOf(draft, source.player)) {
    const p = draft.players[pid]!;
    const cheap = p.hand.filter((id) => (ctx.catalog.getCard(instance(draft, id).cardId)?.cost ?? 0) === 0);
    if (cheap.length > 0) {
      const victim = pickRandom(draft.rng, cheap)!;
      const inst = instance(draft, victim);
      inst.location = 'discard';
      p.hand = p.hand.filter((x) => x !== victim);
      p.discard.push(victim);
      emit(ctx, { type: 'card_discarded', player: pid, instanceId: victim, cardId: inst.cardId, from: 'hand' });
      noteDiscard(draft, ctx, pid, { instanceId: victim, cardId: inst.cardId, from: 'hand' });
    } else if (p.hand.length > 0) {
      emit(ctx, { type: 'hand_revealed', player: pid, cardIds: [...p.hand] });
    }
  }
};

/** monika_card_1: двое игроков вскрывают случайные карты руки; разные стоимости — сброс. */
export const compareRevealPlayers: MechanicHandler = (draft, ctx, _source, _params, choices) => {
  const picks = choices?.filter((c) => c.kind === 'player') ?? [];
  if (picks.length < 2) throw new DomainError('invalid_choice', 'needs two players');
  const revealed: Array<{ pid: PlayerId; id: string; cost: number }> = [];
  for (const pick of picks) {
    if (pick.kind !== 'player') continue;
    const p = draft.players[pick.playerId]!;
    const id = pickRandom(draft.rng, p.hand);
    if (!id) continue;
    const inst = instance(draft, id);
    const cost = ctx.catalog.getCard(inst.cardId)?.cost ?? 0;
    revealed.push({ pid: pick.playerId, id, cost });
    emit(ctx, { type: 'cards_revealed', player: pick.playerId, cardIds: [id] });
  }
  if (revealed.length === 2 && revealed[0]!.cost !== revealed[1]!.cost) {
    for (const r of revealed) {
      const p = draft.players[r.pid]!;
      const inst = instance(draft, r.id);
      inst.location = 'discard';
      p.hand = p.hand.filter((x) => x !== r.id);
      p.discard.push(r.id);
      emit(ctx, { type: 'card_discarded', player: r.pid, instanceId: r.id, cardId: inst.cardId, from: 'hand' });
      noteDiscard(draft, ctx, r.pid, { instanceId: r.id, cardId: inst.cardId, from: 'hand' });
    }
  }
};

/** monika_card_2: тяни 2; одинаковая стоимость — урон выбранному противнику. */
export const drawTwoCostMatch: MechanicHandler = (draft, ctx, source, params, choices) => {
  const amount = Number(params?.amount ?? 2);
  drawCards(draft, ctx, source.player, 2);
  const p = player(draft, source.player);
  const top = p.hand.slice(-2);
  if (top.length < 2) return;
  const c0 = ctx.catalog.getCard(instance(draft, top[0]!).cardId)?.cost ?? 0;
  const c1 = ctx.catalog.getCard(instance(draft, top[1]!).cardId)?.cost ?? 0;
  if (c0 !== c1) return;
  const pick = choices?.find((c) => c.kind === 'player');
  if (!pick || pick.kind !== 'player') throw new DomainError('invalid_choice', 'needs a player');
  dealToPlayer(draft, ctx, pick.playerId, amount, source.instanceId);
  const mate = teammatesOf(draft, source.player)[0];
  if (mate && top[0]) {
    const id = top[0]!;
    const inst = instance(draft, id);
    p.hand = p.hand.filter((x) => x !== id);
    inst.location = 'hand';
    inst.controller = mate;
    draft.players[mate]!.hand.push(id);
  }
};

/** charlie_card_22: приватно посмотреть верх колоды выбранного игрока и разложить. */
export const peekReorder: MechanicHandler = (draft, _ctx, source, params, choices) => {
  const count = Number(params?.count ?? 4);
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'player') throw new DomainError('invalid_choice', 'needs a player');
  const target = draft.players[pick.playerId]!;
  const window = target.deck.slice(0, count);
  // Приватное окно владельца (docs §H16): reorder-UI отложен, порядок не меняется.
  draft.peeks[source.player] = [...window];
};

/** monika_card_11: заморозить землю; её жетоны — по 1 на свои земли без жетонов. */
export const freezeAndSpreadTokens: MechanicHandler = (draft, ctx, source, _params, choices) => {
  const answer = choices?.[0];
  if (!answer || answer.kind !== 'landscape') throw new DomainError('invalid_choice', 'needs a landscape');
  const l = land(draft, answer.player, answer.zone);
  if (!l.frozen) {
    l.frozen = true;
    emit(ctx, { type: 'land_changed', player: answer.player, zone: answer.zone, change: 'frozen' });
  }
  let moving = l.iceTokens;
  l.iceTokens = 0;
  emit(ctx, { type: 'token_changed', player: answer.player, zone: answer.zone, iceTokens: 0 });
  for (const z of draft.players[source.player]!.lands.keys()) {
    if (moving === 0) return;
    const tl = land(draft, source.player, z);
    if (tl.iceTokens > 0 || (answer.player === source.player && z === answer.zone)) continue;
    tl.iceTokens += 1;
    moving -= 1;
    emit(ctx, { type: 'token_changed', player: source.player, zone: z, iceTokens: tl.iceTokens });
  }
};

/** monika_card_35: уничтожить выбранное существо линии + все существа с тем же именем. */
export const destroyLaneAndSameName: MechanicHandler = (draft, ctx, _source, _params, choices) => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') throw new DomainError('invalid_choice', 'needs a creature');
  const name = ctx.catalog.getCard(instance(draft, pick.instanceId).cardId)?.name;
  killInstance(draft, ctx, pick.instanceId);
  emit(ctx, { type: 'creature_destroyed', instanceId: pick.instanceId, cardId: instance(draft, pick.instanceId).cardId });
  if (!name) return;
  for (const pid of draft.order) {
    for (const z of draft.players[pid]!.zones) {
      const id = z.creature;
      if (!id) continue;
      const card = ctx.catalog.getCard(instance(draft, id).cardId);
      if (card?.name === name) {
        const inst = instance(draft, id);
        killInstance(draft, ctx, id);
        emit(ctx, { type: 'creature_destroyed', instanceId: id, cardId: inst.cardId });
      }
    }
  }
};

/** tree_trunks_card_25: все существа в сброс, своя рука в сброс, тяни 5, +3 действия. */
export const resetAndRefill: MechanicHandler = (draft, ctx, source, params) => {
  const draw = Number(params?.draw ?? 5);
  const actions = Number(params?.actions ?? 3);
  for (const pid of draft.order) {
    for (const z of draft.players[pid]!.zones) {
      if (z.creature) {
        const inst = instance(draft, z.creature);
        killInstance(draft, ctx, z.creature);
        emit(ctx, { type: 'creature_destroyed', instanceId: z.creature, cardId: inst.cardId });
      }
    }
  }
  const p = player(draft, source.player);
  for (const id of [...p.hand]) {
    const inst = instance(draft, id);
    inst.location = 'discard';
    p.hand = p.hand.filter((x) => x !== id);
    p.discard.push(id);
    emit(ctx, { type: 'card_discarded', player: source.player, instanceId: id, cardId: inst.cardId, from: 'hand' });
    noteDiscard(draft, ctx, source.player, { instanceId: id, cardId: inst.cardId, from: 'hand' });
  }
  drawCards(draft, ctx, source.player, draw);
  p.actions += actions;
};

/** tree_trunks_card_26: перемещение по числу своих аллей + обмен на землях аллей. */
export const alleyMove: MechanicHandler = (draft, ctx, source, params, _choices, payload) => {
  const alleyId = params?.alleyCardId as string | undefined;
  if (!alleyId || !source.instanceId) return;
  const lane = instance(draft, source.instanceId).zone;
  if (lane === null) return;
  let alleys = 0;
  const alleyZones: number[] = [];
  for (const pid of draft.order) {
    for (let z = 0; z < 4; z++) {
      const bid = draft.players[pid]!.zones[z]!.building;
      if (bid && instance(draft, bid).cardId === alleyId && instance(draft, bid).controller === source.player) {
        alleys += 1;
        alleyZones.push(z);
      }
    }
  }
  if (alleys === 0) return;
  const moverId = draft.players[source.player]!.zones[lane]!.creature;
  if (moverId) {
    for (const nz of [lane - 1, lane + 1]) {
      if (nz < 0 || nz >= 4) continue;
      if (moveCreature(draft, ctx, moverId, source.player, nz)) break;
    }
  }
  if (alleys >= 2 && alleyZones.length >= 2) {
    const [a, b] = [alleyZones[0]!, alleyZones[1]!];
    const ca = draft.players[source.player]!.zones[a]!.creature;
    const cb = draft.players[source.player]!.zones[b]!.creature;
    if (ca && cb) {
      draft.players[source.player]!.zones[a]!.creature = cb;
      draft.players[source.player]!.zones[b]!.creature = ca;
      instance(draft, ca)!.zone = b;
      instance(draft, cb)!.zone = a;
      emit(ctx, { type: 'card_moved', player: source.player, instanceId: ca, fromZone: a, toZone: b });
      emit(ctx, { type: 'card_moved', player: source.player, instanceId: cb, fromZone: b, toZone: a });
    }
  }
  void payload;
};

/** bmo_card_34: временный захват существа на свой путь; возврат в конце хода. */
export const borrowCreature: MechanicHandler = (draft, ctx, source, _params, choices) => {
  if (!source.instanceId) return;
  const lane = instance(draft, source.instanceId).zone;
  if (lane === null) return;
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') throw new DomainError('invalid_choice', 'needs a creature');
  const inst = instance(draft, pick.instanceId);
  if (inst.location !== 'field' || inst.zone === null) return;
  const destZone = lane;
  if (draft.players[source.player]!.zones[destZone]!.creature) return;
  const owner = inst.controller;
  const ownerZone = inst.zone;
  draft.players[owner]!.zones[ownerZone]!.creature = null;
  inst.controller = source.player;
  inst.zone = destZone;
  inst.flipped = false;
  draft.players[source.player]!.zones[destZone]!.creature = pick.instanceId;
  draft.borrowedCreatures.push({ instanceId: pick.instanceId, owner, zone: ownerZone });
  emit(ctx, { type: 'card_moved', player: source.player, instanceId: pick.instanceId, fromZone: ownerZone, toZone: destZone });
};

/** lsp_card_17: помеченное действие — только существо в эту зону. */
export const grantEarmark: MechanicHandler = (draft, _ctx, source) => {
  if (!source.instanceId) return;
  const zone = instance(draft, source.instanceId).zone;
  if (zone === null) return;
  const p = player(draft, source.player);
  p.earmarkedActions = [...(p.earmarkedActions ?? []), { zone }];
};

/** lich_card_16: замешать сброс, тянуть до карты из списка, сыграть бесплатно. */
export const digPlayNamed: MechanicHandler = (draft, ctx, source, params) => {
  const cardIds = (params?.cardIds as string[] | undefined) ?? [];
  const p = player(draft, source.player);
  p.deck = shuffle(draft.rng, [...p.deck, ...p.discard]);
  p.discard = [];
  for (let guard = 0; guard < 200; guard++) {
    const top = p.deck[0];
    if (!top) return;
    const card = ctx.catalog.getCard(instance(draft, top).cardId);
    if (card && cardIds.includes(card.id)) {
      p.deck.shift();
      playCardFree(draft, ctx, source, top, null);
      return;
    }
    p.deck.shift();
    const inst = instance(draft, top);
    inst.location = 'discard';
    p.discard.push(top);
    emit(ctx, { type: 'card_discarded', player: source.player, instanceId: top, cardId: inst.cardId, from: 'deck' });
  }
};

/** monika_card_32: открыть 3 верхних, сыграть парную карту бесплатно, остальное в сброс. */
export const digPlayCompanion: MechanicHandler = (draft, ctx, source, params) => {
  const count = Number(params?.count ?? 3);
  const p = player(draft, source.player);
  const window = p.deck.slice(0, count);
  emit(ctx, { type: 'cards_revealed', player: source.player, cardIds: [...window] });
  const compIdx = window.findIndex((id) => ctx.catalog.getCard(instance(draft, id).cardId)?.type === 'companion');
  for (const id of window) deckRemove(draft, source.player, id);
  for (const id of window) {
    if (id === window[compIdx]) continue;
    const inst = instance(draft, id);
    inst.location = 'discard';
    p.discard.push(id);
    emit(ctx, { type: 'card_discarded', player: source.player, instanceId: id, cardId: inst.cardId, from: 'deck' });
  }
  if (compIdx >= 0) playCardFree(draft, ctx, source, window[compIdx]!, null);
};

/** Крысолов: вооружить подмену атакующего применённым существом (docs §H16). */
export const armReplaceAttacker: MechanicHandler = (draft, ctx, source, _params, choices) => {
  const ratId = source.instanceId;
  if (!ratId) return;
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') throw new DomainError('invalid_choice', 'needs a creature');
  draft.armedReplacements.push({ attackerId: ratId, substituteId: pick.instanceId, expiresTurn: draft.turn });
};

/** jake_2v2_card_36: вооружить эхо урона на выбранном существе (до конца хода). */
export const armDamageEcho: MechanicHandler = (draft, _ctx, source, _params, choices) => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') throw new DomainError('invalid_choice', 'needs a creature');
  draft.armedDamageEcho.push({ creatureId: pick.instanceId, playerId: source.player, expiresTurn: draft.turn });
};

/** jake_card_15: 1 урон каждому из N РАЗНЫХ существ, N = свои земли заданного типа. */
export const damageOncePerLand: MechanicHandler = (draft, ctx, source, params, choices) => {
  const type = params?.landType as string | undefined;
  const amount = Number(params?.amount ?? 1);
  const n = draft.players[source.player]!.lands.filter((l) => !type || l.type === type).length;
  const seen = new Set<string>();
  let hits = 0;
  for (const pick of choices ?? []) {
    if (hits >= n) break;
    if (!pick || pick.kind !== 'creature' || seen.has(pick.instanceId)) continue;
    seen.add(pick.instanceId);
    dealToCreature(draft, ctx, pick.instanceId, amount, source.instanceId);
    hits += 1;
  }
};

/** Ядро удара по линиям — и как mechanic, и как op (jake_2v2_card_5). */
export function laneStrikeAllCore(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId): void {
  const me = player(draft, playerId);
  const enemy = opponentsOf(draft, playerId)[0];
  if (!enemy) return;
  for (let z = 0; z < me.zones.length; z++) {
    const id = me.zones[z]!.creature;
    if (!id) continue;
    const atk = computeEff(draft, ctx, id).attack;
    if (atk <= 0) continue;
    const foe = draft.players[enemy]!.zones[z]!.creature;
    if (foe) dealToCreature(draft, ctx, foe, atk, id);
    else dealToPlayer(draft, ctx, enemy, atk, id);
  }
}

/** jake_2v2_card_5: каждое свое существо наносит свой ATK существу противника на линии. */
export const laneStrikeAll: MechanicHandler = (draft, ctx, source) => {
  laneStrikeAllCore(draft, ctx, source.player);
};

/** lemongrab_card_16: тяни за каждое существо, вошедшее на эту землю в этот ход. */
export const drawPerZoneEnters: MechanicHandler = (draft, ctx, source) => {
  if (!source.instanceId) return;
  const zone = instance(draft, source.instanceId).zone;
  if (zone === null) return;
  const n = draft.zoneEntersThisTurn[`${source.player}:${zone}`] ?? 0;
  if (n > 0) drawCards(draft, ctx, source.player, n);
};

/** jake_2v2_card_28: атакующее существо владельца эффекта покидает игру. */
export const banishAttacker: MechanicHandler = (draft, ctx, _source, _params, _choices, payload) => {
  if (!payload?.instanceId) return;
  const inst = instance(draft, payload.instanceId);
  if (inst.location !== 'field') return;
  killInstance(draft, ctx, payload.instanceId);
};

/** lich_card_6: двойник — сыграть вторую из колоды и связать уходы. */
export const soulTwin: MechanicHandler = (draft, ctx, source) => {
  if (!source.instanceId) return;
  const self = instance(draft, source.instanceId);
  const cardId = self.cardId;
  const p = player(draft, source.player);
  if (!p.zones.some((z) => !z.creature)) return;
  const twinIdx = p.deck.findIndex((id) => draft.instances[id]!.cardId === cardId);
  if (twinIdx < 0) return;
  const twin = p.deck.splice(twinIdx, 1)[0]!;
  const twinInst = instance(draft, twin);
  twinInst.cannotReturnFromDiscard = true;
  self.cannotReturnFromDiscard = true;
  const played = playCardFree(draft, ctx, source, twin, null);
  if (!played) {
    twinInst.cannotReturnFromDiscard = false;
    p.deck.push(twin);
    return;
  }
  p.deck = shuffle(draft.rng, p.deck);
};
