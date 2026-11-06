import type { Draft } from 'immer';
import { DomainError } from '../errors';
import { emit, instance } from '../util';
import type { Ctx } from '../util';
import type { MatchState } from '../types';
import { teammatesOf } from '../zones';
import { conditionsHold, forSource, isTriggerSuppressed } from './modifiers';
import { runEffect } from './effects';
import { runMechanic } from './registry';
import { validateChoices } from './resolve';
import type { EffectSource } from './source';
import type { AbilitySpec, PlayerId, QueuedAbility, TargetChoice, Trigger, TriggerPayload, EffectSpec } from './types';

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
  _draft: Draft<MatchState>,
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
    beneficiary: playerId,
    payload: { instanceId, cardId, player: playerId, zone },
  });
}

/** Which player answers a volunteered ability (default: the source controller). */
function beneficiaryOf(
  draft: MatchState,
  ability: AbilitySpec,
  payload: TriggerPayload | undefined,
  fallback: PlayerId,
): PlayerId {
  if (ability.pendingFor !== 'payload_partner') return fallback;
  const actor = payload?.player;
  if (!actor) return fallback;
  return teammatesOf(draft, actor)[0] ?? fallback;
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
    // Turn-scoped triggers (start_of_turn, on_draw, …) normally fire only for the
    // scoped player; companion reactions may opt into ally events via if_payload_ally.
    if (
      payload.player &&
      source.player !== payload.player &&
      !ability.conditions?.some((c) => c.kind === 'if_payload_ally' || c.kind === 'if_payload_other')
    ) {
      return;
    }
    // «Когда эта карта вступает в игру» — только у входящей карты; реакции
    // других источников требуют явных if_payload_* условий (Персиковая Джинни).
    if (
      (trigger === 'on_enters_play' || trigger === 'on_leave_play') &&
      payload.instanceId &&
      source.instanceId &&
      source.instanceId !== payload.instanceId &&
      !ability.conditions?.some((c) => c.kind === 'if_payload_other' || c.kind === 'if_payload_player_self')
    ) {
      return;
    }
    // Боевые триггеры и триггеры движения — по умолчанию только у источника
    // события; реакции чужих источников — при явных if_payload_*-условиях.
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
    const beneficiary = beneficiaryOf(draft, ability, payload, source.player);
    ctx.frame.queue.push({
      player: source.player,
      beneficiary,
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
    // on_death / on_leave_play / on_cast sources may be out of play already
    // (spell goes to discard on cast); other triggers require the source to
    // still be in play (docs/MECHANICS-V2.md §2Б).
    if (qa.trigger !== 'on_death' && qa.trigger !== 'on_leave_play' && qa.trigger !== 'on_cast') {
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
  runAbilityEffect(draft, ctx, ability, source, choices, qa.payload, qa);
}

/** Run an ability's effect(s) — a single spec or a sequential array with lazy choices. */
export function runAbilityEffect(
  draft: Draft<MatchState>,
  ctx: Ctx,
  ability: AbilitySpec,
  source: EffectSource,
  choices: TargetChoice[] | undefined,
  payload?: TriggerPayload,
  origin?: QueuedAbility,
): void {
  const steps = Array.isArray(ability.effect) ? ability.effect : ability.effect ? [ability.effect] : [];
  if (steps.length > 0) {
    runSteps(draft, ctx, ability, source, steps, choices ?? [], payload, origin);
    return;
  }
  if (ability.mechanic) {
    runMechanic(draft, ctx, ability.mechanic, source, ability.params, choices, payload, origin?.beneficiary ?? source.player);
  }
}

/**
 * Sequential steps with LAZY choice collection (docs/MECHANICS-V2.md §6):
 * each step runs when its choices are satisfied; otherwise the transition
 * pauses with `effect_step` and the remaining tail (pure data) resumes on
 * resolve_choice.
 */
function runSteps(
  draft: Draft<MatchState>,
  ctx: Ctx,
  ability: AbilitySpec,
  source: EffectSource,
  steps: EffectSpec[],
  collected: TargetChoice[],
  payload: TriggerPayload | undefined,
  origin: QueuedAbility | undefined,
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const need = effectChoiceNeed(step);
    if (need > collected.length) {
      const asks = ability.targets ?? [];
      const nextAskIndex = collected.length;
      if (!asks[nextAskIndex]) {
        throw new DomainError('target_required', `step ${i + 1} needs ${need - collected.length} more target(s)`);
      }
      if (origin) {
        draft.pending = {
          player: origin.beneficiary ?? source.player,
          ask: { kind: 'effect_step', askIndex: nextAskIndex, collected },
          current: origin,
          queue: ctx.frame.queue,
          resumeEffects: steps.slice(i),
        };
        ctx.frame.queue = [];
        emit(ctx, {
          type: 'choice_required',
          player: origin.beneficiary ?? source.player,
          kind: 'target',
          askIndex: nextAskIndex,
          askCount: asks.length,
        });
        return;
      }
      // Command-driven ability without pre-collected choices: reject.
      throw new DomainError('target_required', `step ${i + 1} needs ${need - collected.length} more target(s)`);
    }
    runEffect(draft, ctx, step, source, collected, payload);
  }
}

/**
 * Number of choices an effect consumes. Explicit `choice` TargetRefs and the
 * implicit hand picks of `discard_from_hand` both consume declared asks.
 */
function effectChoiceNeed(effect: EffectSpec): number {
  let max = -1;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.kind === 'choice' && typeof record.index === 'number') {
      max = Math.max(max, record.index);
    }
    if (record.kind === 'chosen_amount' && typeof record.index === 'number') {
      max = Math.max(max, record.index);
    }
    for (const item of Object.values(record)) visit(item);
  };
  visit(effect);
  if (effect.op === 'discard_from_hand') {
    return Math.max(max + 1, effect.count);
  }
  if (effect.op === 'play_from_hand') {
    // implicit hand-card pick (ask own_hand_card) + declared destination choice
    return Math.max(max + 1, 1);
  }
  if (effect.op === 'play_from_discard') {
    // discard-card pick (ask own_discard_card / any_discard_card) + destination
    return Math.max(max + 1, 1);
  }
  if (effect.op === 'redistribute_damage') return Math.max(max + 1, 1);
  if (effect.op === 'repeat_effect') {
    const times = typeof effect.times === 'number' ? effect.times : 1;
    return Math.max(max + 1, times * countChoiceRefs(effect.effect));
  }
  if (effect.op === 'set_land_type' && effect.landType === 'chosen') return Math.max(max + 1, 1);
  if (effect.op === 'discard_chosen') return Math.max(max + 1, 1);
  if (effect.op === 'resolve_peek') return Math.max(max + 1, 1);
  return max + 1;
}

/** Distinct `choice` indices consumed by one effect (docs §H2 repeat_effect). */
export function countChoiceRefs(effect: EffectSpec): number {
  let max = -1;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.kind === 'choice' && typeof record.index === 'number') max = Math.max(max, record.index);
    for (const item of Object.values(record)) visit(item);
  };
  visit(effect);
  return max + 1;
}

/** Direct execution for player-initiated abilities (floop / hero_ability / on_cast). */
export function runAbilityDirect(
  draft: Draft<MatchState>,
  ctx: Ctx,
  source: EffectSource,
  ability: AbilitySpec,
  choices: TargetChoice[] | undefined,
  origin?: QueuedAbility,
): void {
  if (!conditionsHold(draft, ctx, source, ability.conditions, undefined)) return;
  runAbilityEffect(draft, ctx, ability, source, choices, undefined, origin);
}

/** Mark a triggered once-per-turn ability as used, before any optional pause. */
function markOncePerTurn(draft: Draft<MatchState>, qa: QueuedAbility): boolean {
  const sourceKey = qa.instanceId ?? 'hero';
  const key = `${qa.player}:${sourceKey}:${qa.abilityIndex}`;
  if (draft.abilityUses[key] === draft.turn) return false;
  draft.abilityUses[key] = draft.turn;
  return true;
}

/** «В первый раз …»: a once-per-game ability is used only once per match. */
function markOncePerGame(draft: Draft<MatchState>, qa: QueuedAbility): boolean {
  const sourceKey = qa.instanceId ?? 'hero';
  const key = `${qa.player}:${sourceKey}:${qa.abilityIndex}`;
  if (draft.abilityUses[key] !== undefined) return false;
  draft.abilityUses[key] = draft.turn;
  return true;
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
    if (ability.oncePerTurn && !markOncePerTurn(draft, qa)) continue;
    if (ability.oncePerGame && !markOncePerGame(draft, qa)) continue;
    // Pre-collected command targets: apply directly (validated atomically at
    // command validation); interactive arrays always pause inside the steps.
    if (qa.choices && !ability.optional && !Array.isArray(ability.effect)) {
      validateChoices(
        draft,
        ctx,
        { player: qa.player, instanceId: qa.instanceId },
        ability.targets,
        qa.choices,
      );
      runQueuedAbility(draft, ctx, qa, qa.choices);
      continue;
    }
    if (ability.optional) {
      pause(draft, ctx, qa, { kind: 'optional' });
      return;
    }
    // Interactive arrays collect their choices through effect_step where each
    // effect needs them; declared targets are not pre-asked up front.
    if (Array.isArray(ability.effect)) {
      runQueuedAbility(draft, ctx, qa, undefined);
      continue;
    }
    if ((ability.targets?.length ?? 0) > 0) {
      pause(draft, ctx, qa, { kind: 'target', askIndex: 0, collected: [] });
      return;
    }
    runQueuedAbility(draft, ctx, qa, undefined);
  }
}

/** The source that owns the ability, independent of who answers its pendingChoice. */
function effectSourceOf(qa: QueuedAbility): EffectSource {
  return { player: qa.player, instanceId: qa.instanceId };
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
  const pendingPlayer = qa.beneficiary ?? qa.player;
  draft.pending = { player: pendingPlayer, ask, current: qa, queue: [...ctx.frame.queue] };
  ctx.frame.queue = [];
  if (ask.kind === 'optional') {
    emit(ctx, { type: 'choice_required', player: pendingPlayer, kind: 'optional' });
  } else {
    emit(ctx, {
      type: 'choice_required',
      player: pendingPlayer,
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
    delete draft.revealed[pending.current.player];
    delete draft.peeks[pending.current.player];
    draft.pending = null;
    ctx.frame.queue = pending.queue;
    drainTriggers(draft, ctx);
    return;
  }

  if (pending.ask.kind === 'effect_step') {
    const asks = ability.targets ?? [];
    const ask = asks[pending.ask.askIndex];
    if (!ask) throw new DomainError('no_pending_choice', 'ask index out of range');
    const choice = answer.targets?.[0];
    if (!choice) throw new DomainError('target_required', `ask ${pending.ask.askIndex + 1} needs one choice`);
    const source = effectSourceOf(pending.current);
    validateChoices(draft, ctx, source, [ask], [choice]);
    const collected = [...pending.ask.collected, choice];
    emit(ctx, {
      type: 'choice_resolved',
      player: pending.player,
      kind: 'target',
      askIndex: pending.ask.askIndex,
    });
    const resumeEffects = pending.resumeEffects ?? [];
    finishPending(draft, ctx, pending);
    runSteps(draft, ctx, ability, source, resumeEffects, collected, undefined, pending.current);
    drainTriggers(draft, ctx);
    return;
  }

  let choices: TargetChoice[] | undefined;
  if (pending.ask.kind === 'optional') {
    if (answer.proceed !== true) {
      finishPending(draft, ctx, pending);
      return;
    }
    if (Array.isArray(ability.effect)) {
      finishPending(draft, ctx, pending);
      runQueuedAbility(draft, ctx, pending.current, undefined);
      drainTriggers(draft, ctx);
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
    // Валидируем собранную ПРЕФИКС-часть набора: ответы приходят по одному
    // (docs/MECHANICS-V2.md §6), поэтому сверяем ask[0..askIndex] с собранными.
    const source = effectSourceOf(pending.current);
    validateChoices(
      draft,
      ctx,
      source,
      asks.slice(0, pending.ask.askIndex + 1),
      [...pending.ask.collected, choice],
    );
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
    emit(ctx, {
      type: 'choice_resolved',
      player: pending.player,
      kind: 'target',
      askIndex: pending.ask.askIndex,
    });
    // The cards stay in the deck in their original order; clear the public window
    // and any private peek opened before the pause (docs §H8). Both keys: the
    // window owner may be the ability source or the answering beneficiary.
    delete draft.revealed[pending.current.player];
    delete draft.revealed[pending.player];
    delete draft.peeks[pending.current.player];
    delete draft.peeks[pending.player];
    draft.pending = null;
    ctx.frame.queue = pending.queue;
  }
  drainTriggers(draft, ctx);
}
