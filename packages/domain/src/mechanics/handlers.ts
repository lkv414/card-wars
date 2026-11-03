import type { Draft } from 'immer';
import { dealToCreature } from '../damage';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import { emit, instance, player } from '../util';
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
  _params: Record<string, unknown> | undefined,
  choices: TargetChoice[] | undefined,
): void => {
  const pick = choices?.[0];
  if (!source.instanceId || !pick || pick.kind !== 'creature') {
    throw new DomainError('invalid_choice', 'swap_lanes needs one creature choice');
  }
  const instA = instance(draft, source.instanceId);
  const instB = instance(draft, pick.instanceId);
  if (instB.controller !== source.player) {
    throw new DomainError('invalid_choice', 'swap_lanes needs an own creature');
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
