import type { Draft } from 'immer';
import { dealToCreature, dealToPlayer, killInstance } from '../damage';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import { drawCards } from '../draw';
import { emit, instance, player } from '../util';
import { computeEff } from '../stats';
import { opponentsOf, opponentZoneFor } from '../zones';
import { pickRandom } from '../rng';
import type { MatchState } from '../types';
import { resolveTarget } from './resolve';
import type { EffectSource, MechanicHandler } from './registry';
import type { PlayerId, TargetChoice, TriggerPayload } from './types';

/** Убей-молния: damage chain[0], chain[1], … along three chosen connected creatures. */
export const chainDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const chain = (params?.chain as number[] | undefined) ?? [];
  chain.forEach((amount, i) => {
    const pick = choices?.[i];
    if (!pick || pick.kind !== 'creature') {
      throw new DomainError('invalid_choice', `chain_damage needs ${chain.length} creature choices`);
    }
    // «по цепочке … на соседних землях»: соседние цели обязаны примыкать.
    if (i > 0) {
      const prev = choices![i - 1]!;
      const zoneA = instance(draft, (prev as { instanceId: string }).instanceId).zone;
      const zoneB = instance(draft, pick.instanceId).zone;
      if (zoneA === null || zoneB === null || Math.abs(zoneA - zoneB) !== 1) {
        throw new DomainError('invalid_choice', 'chain targets must be on adjacent lanes');
      }
    }
    dealToCreature(draft, ctx, pick.instanceId, amount, source.instanceId);
  });
};

/** Отрази угрозу: move up to `max` damage from a chosen own creature to a lane opponent. */
export const moveDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const max = (params?.max as number | undefined) ?? 3;
  // params.self: damage moves from the source creature itself (Ангел-болот Банши).
  const fromId = params?.self === true ? source.instanceId : undefined;
  const from = fromId ? { kind: 'creature' as const, instanceId: fromId } : choices?.[0];
  const to = params?.self === true ? choices?.[0] : choices?.[1];
  if (!from || from.kind !== 'creature' || !to || to.kind !== 'creature') {
    throw new DomainError('invalid_choice', 'move_damage needs two creature choices');
  }
  const src = instance(draft, from.instanceId);
  const moved = Math.min(max, src.damage);
  if (moved <= 0) return;
  src.damage -= moved;
  const dst = instance(draft, to.instanceId);
  dst.damage += moved;
  emit(ctx, {
    type: 'damage_dealt',
    sourceInstanceId: null,
    targetInstanceId: to.instanceId,
    targetPlayer: null,
    amount: moved,
    absorbedByShield: 0,
    toTarget: moved,
  });
};

/** Скелет гастролер: swap the source with one chosen own creature. */
export const swapLanes: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (!source.instanceId || !pick || pick.kind !== 'creature') {
    throw new DomainError('invalid_choice', 'swap_lanes needs one creature choice');
  }
  const instA = instance(draft, source.instanceId);
  const instB = instance(draft, pick.instanceId);
  const allowOpponent = params?.opponent === true;
  if (allowOpponent ? instB.controller === source.player : instB.controller !== source.player) {
    throw new DomainError('invalid_choice', allowOpponent ? 'swap_lanes needs an opponent creature' : 'swap_lanes needs an own creature');
  }
  if (instA.zone === null || instB.zone === null) return;
  const zones = player(draft, source.player).zones;
  const zoneA = instA.zone;
  const zoneB = instB.zone;
  zones[zoneA]!.creature = pick.instanceId;
  zones[zoneB]!.creature = source.instanceId;
  instA.zone = zoneB;
  instB.zone = zoneA;
  emit(ctx, { type: 'card_moved', player: source.player, instanceId: source.instanceId, fromZone: zoneA, toZone: zoneB });
  emit(ctx, { type: 'card_moved', player: source.player, instanceId: pick.instanceId, fromZone: zoneB, toZone: zoneA });
};

/**
 * Copy a cast spell (docs/MECHANICS-V2.md §3): re-enqueue the spell's own
 * `on_cast` steps on behalf of the answering player (the partner, via
 * `pendingFor: 'payload_partner'`). Targets are asked by the regular
 * pendingChoice flow against the copied spell's own `targets`, so the new
 * target must be legal for the copying player. The copy is free, moves no
 * cards and does not bump turn counters; the original instance stays in the
 * discard pile (spells have no `this_creature` refs, so the identity reuse is
 * safe).
 */
export const copySpell: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  _choices: TargetChoice[] | undefined,
  payload: TriggerPayload | undefined,
  beneficiary: PlayerId,
): void => {
  const spellId = payload?.instanceId;
  const cardId = payload?.cardId;
  if (!spellId || !cardId) return; // nothing to copy
  const card = ctx.catalog.getCard(cardId);
  const casts = (card?.abilities ?? [])
    .map((ability, abilityIndex) => ({ ability, abilityIndex }))
    .filter(({ ability }) => ability.kind === 'passive' && ability.trigger === 'on_cast');
  const answering = beneficiary; // «другой партнёр», not the companion's owner
  for (const { ability, abilityIndex } of casts) {
    ctx.frame.queue.push({
      player: answering,
      beneficiary: answering,
      instanceId: spellId,
      cardId,
      abilityIndex,
      trigger: 'on_cast',
      payload: { instanceId: spellId, cardId, player: answering },
    });
  }
  emit(ctx, { type: 'spell_cast', player: answering, instanceId: spellId, cardId, copy: true });
};

/**
 * «Теряет все способности и получает Приём случайного существа (с приёмом)
 * из твоей стопки сброса до конца хода» (docs/MECHANICS-V2.md §3, A6): the
 * own creature in the source's lane loses its whole text and gains the active
 * ability of a random discard creature that has one. Both are live modifiers
 * pushed into `MatchState.turnModifiers` (suppress `all` + `grant_ability`,
 * duration `this_turn`), so coverage follows the board and expires at the end
 * of the turn.
 */
export const grantRandomDiscardActive: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  _choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  if (!source.instanceId) return; // only a field card can define its lane
  const targets = resolveTarget(draft, ctx, { kind: 'this_lane_own_creature' }, source, undefined);
  const victimId = targets.find((t) => t.kind === 'creature')?.instanceId;
  if (!victimId) return; // no own creature in the lane — nothing to swap
  const p = player(draft, source.player);
  const candidates = p.discard.filter((id) => {
    const card = ctx.catalog.getCard(draft.instances[id]!.cardId);
    return (card?.abilities ?? []).some((a) => a.kind === 'active');
  });
  const rolled = pickRandom(draft.rng, candidates);
  if (!rolled) return; // no discard creature has an active ability
  const rolledCard = ctx.catalog.getCard(draft.instances[rolled]!.cardId);
  const active = rolledCard?.abilities?.find((a) => a.kind === 'active');
  if (!active) return;
  draft.turnModifiers.push(
    {
      instanceId: source.instanceId,
      effect: { op: 'suppress', all: true, target: { kind: 'this_lane_own_creature' } },
      grantedOnTurn: draft.turn,
      duration: 'this_turn',
    },
    {
      instanceId: source.instanceId,
      effect: { op: 'grant_ability', target: { kind: 'this_lane_own_creature' }, ability: active },
      grantedOnTurn: draft.turn,
      duration: 'this_turn',
    },
  );
};

/**
 * «Нанеси N урона … если на земле с Ледяным жетоном — вместо N — M»
 * (docs/MECHANICS-V2.md §3, A7.1): base damage to the chosen creature, plus a
 * bonus while the victim stands on a land with ice tokens (Замороженное сердце
 * pattern: amount 1, bonus 2).
 */
export const tokenBonusDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  const amount = (params?.amount as number | undefined) ?? 1;
  const bonus = (params?.bonus as number | undefined) ?? 0;
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') {
    throw new DomainError('invalid_choice', 'token_bonus_damage needs one creature choice');
  }
  const victim = instance(draft, pick.instanceId);
  const onToken = victim.zone !== null && player(draft, victim.controller).lands[victim.zone]!.iceTokens > 0;
  dealToCreature(draft, ctx, pick.instanceId, onToken ? amount + bonus : amount, source.instanceId);
};

/** «Положи верхнюю карту колоды в сброс. Нанеси урон каждому существу равный её стоимости» (Зеленый тритон). */
export const discardTopDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  _choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  const p = player(draft, source.player);
  const topId = p.deck[0];
  if (!topId) return;
  p.deck.splice(0, 1);
  const topInst = instance(draft, topId);
  topInst.location = 'discard';
  p.discard.push(topId);
  emit(ctx, { type: 'card_discarded', player: source.player, instanceId: topId, cardId: topInst.cardId, from: 'deck' });
  const cost = ctx.catalog.getCard(topInst.cardId)?.cost ?? 0;
  for (const pid of draft.order) {
    for (const zone of draft.players[pid]!.zones) {
      if (zone.creature) dealToCreature(draft, ctx, zone.creature, cost, source.instanceId);
    }
  }
};

/** «Верни выбранное существо владельцу в руку. Получи действия равные её стоимости» (Теплый прием). */
export const returnCostActions: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') throw new DomainError('invalid_choice', 'return_cost_actions needs a creature');
  const inst = instance(draft, pick.instanceId);
  const cost = ctx.catalog.getCard(inst.cardId)?.cost ?? 0;
  const owner = player(draft, inst.controller);
  inst.location = 'hand';
  if (inst.zone !== null && inst.slot) {
    draft.players[inst.controller]!.zones[inst.zone]![inst.slot] = null;
  }
  inst.zone = null;
  inst.slot = null;
  owner.hand.push(pick.instanceId);
  emit(ctx, { type: 'card_returned', player: inst.controller, instanceId: pick.instanceId, cardId: inst.cardId });
  player(draft, source.player).actions += cost;
};

/** «Уничтожь выбранное существо противника. Каждый противник тянет столько карт, сколько оно стоило» (Горячая подача). */
export const destroyDrawCost: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') throw new DomainError('invalid_choice', 'destroy_draw_cost needs a creature');
  const inst = instance(draft, pick.instanceId);
  const cost = ctx.catalog.getCard(inst.cardId)?.cost ?? 0;
  killInstance(draft, ctx, pick.instanceId);
  for (const pid of opponentsOf(draft, source.player)) {
    drawCards(draft, ctx, pid, cost);
  }
};

/** «Выбранный противник сбрасывает до N карт, затем получает урон за каждую сброшенную» (Пощечина Ведьмы). */
export const discardThenDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  const count = (params?.count as number | undefined) ?? 5;
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'player') throw new DomainError('invalid_choice', 'discard_then_damage needs a player');
  const victim = player(draft, pick.playerId);
  let discarded = 0;
  for (let i = 0; i < count && victim.hand.length > 0; i++) {
    const id = pickRandom(draft.rng, victim.hand);
    if (!id) break;
    const inst = instance(draft, id);
    inst.location = 'discard';
    victim.hand.splice(victim.hand.indexOf(id), 1);
    victim.discard.push(id);
    discarded += 1;
    emit(ctx, { type: 'card_discarded', player: pick.playerId, instanceId: id, cardId: inst.cardId, from: 'hand' });
  }
  if (discarded > 0) dealToPlayer(draft, ctx, pick.playerId, discarded, source.instanceId);
};

/** «Сбрось N верхних карт колоды. За каждое заклинание среди них выбранный игрок сбрасывает карту» (Костяная рука). */
export const millSpellDiscard: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  const count = (params?.count as number | undefined) ?? 3;
  const p = player(draft, source.player);
  let spells = 0;
  for (let i = 0; i < count && p.deck.length > 0; i++) {
    const id = p.deck.shift()!;
    const inst = instance(draft, id);
    inst.location = 'discard';
    p.discard.push(id);
    if (ctx.catalog.getCard(inst.cardId)?.type === 'spell') spells += 1;
    emit(ctx, { type: 'card_discarded', player: source.player, instanceId: id, cardId: inst.cardId, from: 'deck' });
  }
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'player') throw new DomainError('invalid_choice', 'mill_spell_discard needs a player');
  const victim = player(draft, pick.playerId);
  for (let i = 0; i < spells && victim.hand.length > 0; i++) {
    const id = pickRandom(draft.rng, victim.hand);
    if (!id) break;
    const inst = instance(draft, id);
    inst.location = 'discard';
    victim.hand.splice(victim.hand.indexOf(id), 1);
    victim.discard.push(id);
    emit(ctx, { type: 'card_discarded', player: pick.playerId, instanceId: id, cardId: inst.cardId, from: 'hand' });
  }
};

/** «Нанеси 6 урона существу противника на этой линии или противнику, если линия пуста» (Громкий Бух). */
export const laneOrFaceDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  _choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  const amount = (params?.amount as number | undefined) ?? 1;
  if (!source.instanceId) return;
  const src = instance(draft, source.instanceId);
  if (src.zone === null) return;
  const target = opponentZoneFor(draft, source.player, src.zone);
  if (!target) return;
  const defenderId = draft.players[target.player]!.zones[target.zone]?.creature;
  if (defenderId) dealToCreature(draft, ctx, defenderId, amount, source.instanceId);
  else dealToPlayer(draft, ctx, target.player, amount, source.instanceId);
};

/** «Поменяй местами двух существ под твоим контролем» (Магический портал). */
export const swapCreatures: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  _source: EffectSource,
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  const a = choices?.[0];
  const b = choices?.[1];
  if (!a || !b || a.kind !== 'creature' || b.kind !== 'creature') {
    throw new DomainError('invalid_choice', 'swap_creatures needs two creature choices');
  }
  const instA = instance(draft, a.instanceId);
  const instB = instance(draft, b.instanceId);
  if (instA.controller !== instB.controller) {
    throw new DomainError('invalid_choice', 'swap_creatures needs same-owner creatures');
  }
  if (instA.zone === null || instB.zone === null) return;
  const zones = draft.players[instA.controller]!.zones;
  const za = instA.zone;
  const zb = instB.zone;
  zones[za]!.creature = b.instanceId;
  zones[zb]!.creature = a.instanceId;
  instA.zone = zb;
  instB.zone = za;
  emit(ctx, { type: 'card_moved', player: instA.controller, instanceId: a.instanceId, fromZone: za, toZone: zb });
  emit(ctx, { type: 'card_moved', player: instA.controller, instanceId: b.instanceId, fromZone: zb, toZone: za });
};

/** «Наноси урон выбранному существу, пока у него не останется 1 DEF» (Посох вуду). */
export const damageUntilDef: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  const floor = (params?.floor as number | undefined) ?? 1;
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') throw new DomainError('invalid_choice', 'damage_until_def needs a creature');
  let guard = 100;
  while (guard-- > 0) {
    const def = computeEff(draft, ctx, pick.instanceId).defense;
    if (def <= floor) break;
    dealToCreature(draft, ctx, pick.instanceId, 1, source.instanceId);
  }
};

/** «Нанеси урон существу и ещё двум существам по бокам от него» (Взрывной мужик). */
export const splashDamage: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  const amount = (params?.amount as number | undefined) ?? 1;
  const pick = choices?.[0];
  if (!pick || pick.kind !== 'creature') throw new DomainError('invalid_choice', 'splash_damage needs a creature');
  const center = instance(draft, pick.instanceId);
  dealToCreature(draft, ctx, pick.instanceId, amount, source.instanceId);
  if (center.zone === null) return;
  for (const pid of draft.order) {
    const board = draft.players[pid]!;
    if (board.zones.length !== draft.players[center.controller]!.zones.length) continue;
    for (const z of [center.zone - 1, center.zone + 1]) {
      if (z < 0 || z >= board.zones.length) continue;
      const id = board.zones[z]?.creature;
      if (id) dealToCreature(draft, ctx, id, amount, source.instanceId);
    }
  }
};

/** «Нанеси 1 урон противнику за каждую карту в его руке» (Поля кошмаров-стиль, Фермер-кочевник). */
export const damagePerHand: MechanicHandler = (
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  _params: Record<string, unknown> | undefined,
  _choices: TargetChoice[] | undefined,
  _payload: TriggerPayload | undefined,
  _beneficiary: PlayerId,
): void => {
  for (const pid of opponentsOf(draft, source.player)) {
    dealToPlayer(draft, ctx, pid, draft.players[pid]!.hand.length, source.instanceId);
  }
};
