import type { Draft } from 'immer';
import { afterEffects } from '../deaths';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import { killInstance } from '../damage';
import { emit, instance, moveId, player } from '../util';
import { costPicks, costPicksCount, floopCostPicks, sacrificePicks } from '../mechanics/costs';
import type { MatchState, PlayerId } from '../types';
import { isActive } from '../zones';
import { runAbilityDirect } from '../mechanics/dispatch';
import { noteDiscard } from '../mechanics/effects';
import { areActivesSuppressed, collectGrantedActives, conditionsHold } from '../mechanics/modifiers';
import { validateChoices } from '../mechanics/resolve';
import type { TargetChoice } from '../mechanics/types';

/**
 * Floop: turn (tap) a card and run its active ability (docs/RULES.md «Ход игрока»,
 * docs/MECHANICS-V2.md §5). A floop can be used the same turn the card entered
 * play; the first player cannot floop during the very first turn. Targets and
 * additional-cost picks arrive with the command and are validated atomically
 * before anything is paid.
 */
export function handleFloop(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  instanceId: string,
  targets: TargetChoice[] | undefined,
): void {
  if (draft.status === 'finished') throw new DomainError('match_finished', 'match is finished');
  if (draft.status !== 'running') throw new DomainError('match_not_running', 'match is not running');
  if (!isActive(draft, playerId)) throw new DomainError('not_your_turn', `not ${playerId}'s turn`);
  if (draft.players[playerId]!.battleReady) {
    throw new DomainError('wrong_phase', 'player is ready for battle');
  }
  if (draft.phase !== 'main') throw new DomainError('wrong_phase', `phase is ${draft.phase}`);

  const inst = instance(draft, instanceId);
  if (inst.controller !== playerId) throw new DomainError('card_not_in_play', 'not your card');
  if (inst.location !== 'field' && inst.location !== 'companion') {
    throw new DomainError('card_not_in_play', 'card is not in play');
  }
  if (inst.flipped) throw new DomainError('already_flipped', 'card is already flipped');

  // FFA: the first player cannot floop in their first turn; 2v2: no floops in round 1.
  // (docs/RULES.md «Подготовка партии», «Ход команды»).
  const firstRoundForbidden =
    draft.round === 1 && (draft.mode === 'teams' || draft.activePlayer === draft.order[0]);
  if (firstRoundForbidden) {
    throw new DomainError('floop_forbidden_first_turn', 'floop is forbidden in the first round');
  }

  const card = ctx.catalog.getCard(inst.cardId);
  const actives = (card?.abilities ?? []).filter((a) => a.kind === 'active');
  // Granted actives (Финн: «получают ПРИЕМ >>> …») come from live grant_ability auras.
  const granted = collectGrantedActives(draft, ctx, instanceId);
  const suppressed = areActivesSuppressed(draft, ctx, instanceId);
  if (actives.length > 0 && suppressed && granted.length === 0) {
    throw new DomainError('ability_suppressed', 'abilities of this card are suppressed');
  }
  if (actives.length === 0 && granted.length === 0) {
    throw new DomainError('card_has_no_floop', `card ${card?.id ?? inst.cardId} has no active ability`);
  }
  // One «ПРИЕМ» per card in the original game (docs/MECHANICS-V2.md §4);
  // a suppressed text leaves only the granted ability usable (Школа).
  const ability = (suppressed ? granted[0] : (actives[0] ?? granted[0]))!;

  // Условие проверяется ДО оплаты: мёртвая способность не сжигает флюп и действия.
  if (ability.conditions && ability.conditions.length > 0 && !conditionsHold(draft, ctx, { player: playerId, instanceId }, ability.conditions, undefined)) {
    throw new DomainError('condition_not_met', 'ability conditions are not met');
  }

  // Once-per-turn tracking (docs/MECHANICS-V2.md §6).
  const useKey = `${playerId}:${instanceId}:0`;
  if (ability.oncePerTurn && draft.abilityUses[useKey] === draft.turn) {
    throw new DomainError('ability_already_used', 'ability is once per turn');
  }

  const p = player(draft, playerId);
  const cost = ability.cost ?? 0;
  if (p.actions < cost) {
    throw new DomainError('insufficient_actions', `floop costs ${cost} actions`);
  }

  // Atomic validation: additional-cost picks first; interactive arrays collect
  // their ability choices during resolution (docs/MECHANICS-V2.md §6).
  const interactiveArray = Array.isArray(ability.effect);
  const discardCount = ability.additionalCost?.discardFromHand ?? 0;
  const costCount = costPicksCount(ability.additionalCost);
  const declaredAsks = ability.targets ?? [];
  const expectedTargets = costCount + (interactiveArray ? 0 : declaredAsks.length);
  if ((targets?.length ?? 0) !== expectedTargets) {
    throw new DomainError(
      'target_required',
      interactiveArray ? 'ability takes its choices during resolution' : `ability needs ${expectedTargets} targets`,
    );
  }
  const allTargets = targets ?? [];
  const handPicks = costPicks(allTargets, discardCount, playerId, draft, ctx, ability.additionalCost);
  if (!interactiveArray && declaredAsks.length > 0) {
    validateChoices(draft, ctx, { player: playerId, instanceId }, declaredAsks, allTargets.slice(costCount));
  }

  // Apply: pay actions, pay additional cost, run, flip.
  p.actions -= cost;
  for (const pickId of handPicks) {
    const pickInst = instance(draft, pickId);
    pickInst.location = 'discard';
    moveId(p.hand, p.discard, pickId);
    emit(ctx, {
      type: 'card_discarded',
      player: playerId,
      instanceId: pickId,
      cardId: pickInst.cardId,
      from: 'hand',
    });
    noteDiscard(draft, ctx, playerId, { instanceId: pickId, cardId: pickInst.cardId, from: 'hand' });
  }
  for (const pickId of sacrificePicks(allTargets, discardCount, ability.additionalCost, draft, ctx, playerId)) {
    killInstance(draft, ctx, pickId);
  }
  for (const pickId of floopCostPicks(allTargets, discardCount, ability.additionalCost, draft, playerId)) {
    instance(draft, pickId).flipped = true;
    emit(ctx, { type: 'floop_used', player: playerId, instanceId: pickId, cardId: instance(draft, pickId).cardId, paidActions: 0 });
  }
  const abilityIndex = (card?.abilities ?? []).indexOf(ability);
  runAbilityDirect(
    draft,
    ctx,
    { player: playerId, instanceId },
    ability,
    interactiveArray ? [] : allTargets.slice(costCount),
    { player: playerId, instanceId, cardId: card!.id, abilityIndex: Math.max(0, abilityIndex) },
  );
  if (ability.oncePerTurn) draft.abilityUses[useKey] = draft.turn;

  inst.flipped = true;
  // «Уничтожь [эту карту] >>> …» — самопожертвование после эффекта.
  if (ability.additionalCost?.destroySelf) {
    killInstance(draft, ctx, instanceId);
  }
  emit(ctx, { type: 'floop_used', player: playerId, instanceId, cardId: card!.id, paidActions: cost });
  afterEffects(draft, ctx);
}
