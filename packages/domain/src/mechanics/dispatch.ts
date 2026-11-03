import type { Draft } from 'immer';
import { DomainError } from '../errors';
import { emit, instance } from '../util';
import type { Ctx } from '../util';
import type { MatchState } from '../types';
import { conditionsHold, forSource, isTriggerSuppressed } from './modifiers';
import { runEffect } from './effects';
import { runMechanic } from './registry';
import { validateChoices } from './resolve';
import type { EffectSource } from './source';
import type { AbilitySpec, PlayerId, QueuedAbility, TargetChoice, Trigger, TriggerPayload } from './types';

/**
 * Trigger queue (docs/MECHANICS-V2.md §2Б/§6): hooks enqueue, `drainTriggers`
 * runs until empty. An ability that needs the player's input pauses the drain
 * into `MatchState.pending`; `resolvePending` continues it. Re-entrant hooks
 * (an ability drawing cards fires on_draw) only append to the running queue.
 */

/**
 * Enqueue on_leave_play for a card that is ALREADY out of play (the live-source
 * scan cannot see it). Finds the ability index in the card data directly.
 */
export function enqueueLeavePlay(
  draft: Draft<MatchState>,
  ctx: Ctx,
  instanceId: string,
  cardId: string,
  playerId: PlayerId,
  zone: number | null,
): void {
  const card = ctx.catalog.getCard(cardId);
  const abilityIndex = card?.abilities?.findIndex((a) => a.kind === 'passive' && a.trigger === 'on_leave_play') ?? -1;
  if (!card || abilityIndex < 0) return;
  ctx.frame.queue.push({
    player: playerId,
    instanceId,
    cardId,
    abilityIndex,
    trigger: 'on_leave_play',
    payload: { instanceId, cardId, player: playerId, zone },
  });
}

/** Collect matching abilities of all live sources into the frame queue. */
export function enqueueTrigger(
  draft: Draft<MatchState>,
  ctx: Ctx,
  trigger: Trigger,
  payload: TriggerPayload = {},
): void {
  forSource(draft, ctx, (source, ability, abilityIndex) => {
    if (ability.kind !== 'passive' || ability.trigger !== trigger) return;
    // Turn-scoped triggers (start_of_turn, on_draw, …) fire only for the
    // scoped player; board events fire for everyone's abilities.
    if (payload.player && source.player !== payload.player) return;
    // «Когда эта карта вступает в игру» — только у входящей карты; реакции
    // других источников требуют явных if_payload_* условий (Персиковая Джинни).
    if (
      (trigger === 'on_enters_play' || trigger === 'on_leave_play') &&
      payload.instanceId &&
      source.instanceId &&
      source.instanceId !== payload.instanceId &&
      !ability.conditions?.some((c) => c.kind === 'if_payload_other')
    ) {
      return;
    }
    // Боевые триггеры и триггеры движения — по умолчанию только у источника
    // события; реакции чужих источников — при явных if_payload_other /
    // if_payload_player_self (Биомансер, Персиковая Джинни).
    if (
      (trigger === 'on_creature_attacks' ||
        trigger === 'on_damage_dealt' ||
        trigger === 'on_line_change' ||
        trigger === 'on_flip') &&
      payload.instanceId &&
      source.instanceId &&
      source.instanceId !== payload.instanceId &&
      !ability.conditions?.some((c) => c.kind === 'if_payload_other' || c.kind === 'if_payload_player_self')
    ) {
      return;
    }
    // Подавление (Дворец Костей).
    if (isTriggerSuppressed(draft, ctx, source, trigger)) return;
    ctx.frame.queue.push({
      player: source.player,
      instanceId: source.instanceId,
      cardId: source.instanceId ? instance(draft, source.instanceId).cardId : null,
      abilityIndex,
      trigger,
      payload,
    });
  });
}

function abilityOf(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  qa: QueuedAbility,
): AbilitySpec | null {
  if (qa.instanceId) {
    const inst = draft.instances[qa.instanceId];
    const cardId = inst?.cardId ?? qa.cardId;
    if (!cardId) return null;
    // on_death / on_leave_play sources sit in the discard already; other
    // triggers require the source to still be in play (docs/MECHANICS-V2.md §2Б).
    if (qa.trigger !== 'on_death' && qa.trigger !== 'on_leave_play') {
      if (!inst || (inst.location !== 'field' && inst.location !== 'companion')) return null;
    }
    return ctx.catalog.getCard(cardId)?.abilities?.[qa.abilityIndex] ?? null;
  }
  const hero = ctx.catalog.getHero(draft.players[qa.player]!.heroId);
  return hero?.ability ?? null;
}

/** Run one queued ability: conditions checked now, effect or named mechanic. */
export function runQueuedAbility(
  draft: Draft<MatchState>,
  ctx: Ctx,
  qa: QueuedAbility,
  choices: TargetChoice[] | undefined,
): void {
  const ability = abilityOf(draft, ctx, qa);
  if (!ability) return; // source left play while queued
  const source: EffectSource = { player: qa.player, instanceId: qa.instanceId };
  if (!conditionsHold(draft, ctx, source, ability.conditions, undefined, qa.payload)) return;
  runAbilityEffect(draft, ctx, ability, source, choices, qa.payload);
}

/** Run an ability's effect(s) — a single spec or a sequential array. */
export function runAbilityEffect(
  draft: Draft<MatchState>,
  ctx: Ctx,
  ability: AbilitySpec,
  source: EffectSource,
  choices: TargetChoice[] | undefined,
  payload?: TriggerPayload,
): void {
  if (Array.isArray(ability.effect)) {
    for (const effect of ability.effect) runEffect(draft, ctx, effect, source, choices, payload);
  } else if (ability.effect) {
    runEffect(draft, ctx, ability.effect, source, choices, payload);
  } else if (ability.mechanic) {
    runMechanic(draft, ctx, ability.mechanic, source, ability.params, choices);
  }
}

/** Direct execution for player-initiated abilities (floop / hero_ability / on_cast). */
export function runAbilityDirect(
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  ability: AbilitySpec,
  choices: TargetChoice[] | undefined,
): void {
  if (!conditionsHold(draft, ctx, source, ability.conditions, undefined)) return;
  runAbilityEffect(draft, ctx, ability, source, choices);
}

/** Process the queue; pauses into MatchState.pending when input is required. */
export function drainTriggers(draft: Draft<MatchState>, ctx: Ctx): void {
  while (ctx.frame.queue.length > 0) {
    if (draft.pending) return; // already paused; resumed by resolve_choice
    if (draft.status === 'finished') {
      ctx.frame.queue = [];
      return;
    }
    ctx.frame.steps += 1;
    if (ctx.frame.steps > 500) throw new DomainError('trigger_storm', 'trigger queue exceeded 500 steps');
    const qa = ctx.frame.queue.shift()!;
    const ability = abilityOf(draft, ctx, qa);
    if (!ability) continue;
    // Payload-conditions (реакция на конкретное событие) проверяются ДО паузы:
    // мёртвая реакция не должна останавливать матч вопросом (Привлекательный слон).
    if (
      ability.conditions?.some((c) => c.kind.startsWith('if_payload')) &&
      !conditionsHold(draft, ctx, { player: qa.player, instanceId: qa.instanceId }, ability.conditions, undefined, qa.payload)
    ) {
      continue;
    }
    if (ability.optional) {
      pause(draft, ctx, qa, { kind: 'optional' });
      return;
    }
    if ((ability.targets?.length ?? 0) > 0) {
      pause(draft, ctx, qa, { kind: 'target', askIndex: 0, collected: [] });
      return;
    }
    runQueuedAbility(draft, ctx, qa, undefined);
  }
}

function pause(
  draft: Draft<MatchState>,
  ctx: Ctx,
  qa: QueuedAbility,
  ask:
    | { kind: 'optional' }
    | { kind: 'target'; askIndex: number; collected: TargetChoice[] },
): void {
  const ability = abilityOf(draft, ctx, qa)!;
  draft.pending = { player: qa.player, ask, current: qa, queue: [...ctx.frame.queue] };
  ctx.frame.queue = [];
  if (ask.kind === 'optional') {
    emit(ctx, { type: 'choice_required', player: qa.player, kind: 'optional' });
  } else {
    emit(ctx, {
      type: 'choice_required',
      player: qa.player,
      kind: 'target',
      askIndex: ask.askIndex,
      askCount: ability.targets?.length ?? 0,
    });
  }
}

/**
 * Apply a `resolve_choice` answer and continue the paused transition.
 * Targets arrive one ask per command; «optional» takes proceed yes/no.
 */
export function resolvePending(
  draft: Draft<MatchState>,
  ctx: Ctx,
  answer: { proceed?: boolean; targets?: TargetChoice[] },
): void {
  const pending = draft.pending;
  if (!pending) throw new DomainError('no_pending_choice', 'nothing is awaited');
  const ability = abilityOf(draft, ctx, pending.current);
  if (!ability) {
    // Source vanished while paused; skip the ability and continue the queue.
    draft.pending = null;
    ctx.frame.queue = pending.queue;
    drainTriggers(draft, ctx);
    return;
  }

  let choices: TargetChoice[] | undefined;
  if (pending.ask.kind === 'optional') {
    if (answer.proceed !== true) {
      finishPending(draft, ctx, pending);
      return;
    }
    if ((ability.targets?.length ?? 0) > 0) {
      pending.ask = { kind: 'target', askIndex: 0, collected: [] };
      emit(ctx, { type: 'choice_required', player: pending.player, kind: 'target', askIndex: 0, askCount: ability.targets!.length });
      return;
    }
    choices = undefined;
  } else {
    const asks = ability.targets ?? [];
    const ask = asks[pending.ask.askIndex];
    if (!ask) throw new DomainError('no_pending_choice', 'ask index out of range');
    const choice = answer.targets?.[0];
    if (!choice) throw new DomainError('target_required', `ask ${pending.ask.askIndex + 1} needs one choice`);
    // Re-validate the whole set against the declared asks (atomic, docs/MECHANICS-V2.md §5).
    const source: EffectSource = { player: pending.player, instanceId: pending.current.instanceId };
    validateChoices(draft, ctx, source, asks, [...pending.ask.collected, choice]);
    pending.ask.collected.push(choice);
    emit(ctx, {
      type: 'choice_resolved',
      player: pending.player,
      kind: 'target',
      askIndex: pending.ask.askIndex,
    });
    if (pending.ask.askIndex + 1 < asks.length) {
      pending.ask.askIndex += 1;
      emit(ctx, {
        type: 'choice_required',
        player: pending.player,
        kind: 'target',
        askIndex: pending.ask.askIndex,
        askCount: asks.length,
      });
      return;
    }
    choices = pending.ask.collected;
  }

  finishPending(draft, ctx, pending);
  runQueuedAbility(draft, ctx, pending.current, choices);
  drainTriggers(draft, ctx);
}

function finishPending(draft: Draft<MatchState>, ctx: Ctx, pending: NonNullable<MatchState['pending']>): void {
  if (pending.ask.kind === 'optional') {
    emit(ctx, { type: 'choice_resolved', player: pending.player, kind: 'optional' });
  }
  draft.pending = null;
  ctx.frame.queue = pending.queue;
}

/**
 * Timer default (docs/MECHANICS-V2.md §6): the awaiting player did not answer
 * in time — optional abilities are skipped, targeted ones are cancelled; the
 * rest of the queue drains so the turn never stalls.
 */
export function skipPending(draft: Draft<MatchState>, ctx: Ctx): void {
  if (!draft.pending) return;
  const pending = draft.pending;
  if (pending.ask.kind === 'optional') {
    finishPending(draft, ctx, pending);
  } else {
    emit(ctx, { type: 'choice_resolved', player: pending.player, kind: 'target', askIndex: pending.ask.askIndex });
    draft.pending = null;
    ctx.frame.queue = pending.queue;
  }
  drainTriggers(draft, ctx);
}
