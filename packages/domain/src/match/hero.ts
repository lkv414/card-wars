import type { Draft } from 'immer';
import { afterEffects } from '../deaths';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import { killInstance } from '../damage';
import { emit, instance, moveId, player } from '../util';
import { costPicks, costPicksCount, sacrificePicks } from '../mechanics/costs';
import { noteDiscard } from '../mechanics/effects';
import type { MatchState, PlayerId } from '../types';
import { isActive } from '../zones';
import { runAbilityDirect } from '../mechanics/dispatch';
import { conditionsHold } from '../mechanics/modifiers';
import { validateChoices } from '../mechanics/resolve';
import type { TargetChoice } from '../mechanics/types';

/**
 * Activate the hero's active ability (docs/MECHANICS-V2.md §1, docs/COMMANDS.md
 * «Активация способности героя»). Same contract as floop: action cost, optional
 * additional cost with hand-card picks, declared targets, once-per-turn limit.
 */
export function handleHeroAbility(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  targets: TargetChoice[] | undefined,
): void {
  if (draft.status === 'finished') throw new DomainError('match_finished', 'match is finished');
  if (draft.status !== 'running') throw new DomainError('match_not_running', 'match is not running');
  if (!isActive(draft, playerId)) throw new DomainError('not_your_turn', `not ${playerId}'s turn`);
  if (draft.players[playerId]!.battleReady) {
    throw new DomainError('wrong_phase', 'player is ready for battle');
  }
  if (draft.phase !== 'main') throw new DomainError('wrong_phase', `phase is ${draft.phase}`);

  const hero = ctx.catalog.getHero(player(draft, playerId).heroId);
  const ability = hero?.ability;
  if (!hero || !ability || ability.kind !== 'active') {
    throw new DomainError('hero_has_no_ability', `hero ${hero?.id ?? playerId} has no active ability`);
  }

  const useKey = `${playerId}:hero:0`;
  if (ability.oncePerTurn && draft.abilityUses[useKey] === draft.turn) {
    throw new DomainError('ability_already_used', 'hero ability is once per turn');
  }

  const p = player(draft, playerId);
  const cost = ability.cost ?? 0;
  if (p.actions < cost) {
    throw new DomainError('insufficient_actions', `hero ability costs ${cost} actions`);
  }

  const interactiveArray = Array.isArray(ability.effect);
  const discardCount = ability.additionalCost?.discardFromHand ?? 0;
  const costCount = costPicksCount(ability.additionalCost);
  const declaredAsks = ability.targets ?? [];
  const expectedTargets = costCount + (interactiveArray ? 0 : declaredAsks.length);
  if ((targets?.length ?? 0) !== expectedTargets) {
    throw new DomainError('target_required', interactiveArray ? 'ability takes its choices during resolution' : `hero ability needs ${expectedTargets} targets`);
  }
  const allTargets = targets ?? [];
  const handPicks = costPicks(allTargets, discardCount, playerId, draft);
  if (!interactiveArray && declaredAsks.length > 0) {
    validateChoices(draft, ctx, { player: playerId, instanceId: null }, declaredAsks, allTargets.slice(costCount));
  }

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
  // Условие до оплаты (docs/MECHANICS-V2.md §6).
  if (ability.conditions && ability.conditions.length > 0 && !conditionsHold(draft, ctx, { player: playerId, instanceId: null }, ability.conditions, undefined)) {
    throw new DomainError('condition_not_met', 'ability conditions are not met');
  }

  runAbilityDirect(draft, ctx, { player: playerId, instanceId: null }, ability, interactiveArray ? [] : allTargets.slice(costCount), {
    player: playerId,
    instanceId: null,
    cardId: null,
    abilityIndex: 0,
  });
  if (ability.oncePerTurn) draft.abilityUses[useKey] = draft.turn;

  emit(ctx, { type: 'hero_ability_used', player: playerId, paidActions: cost });
  afterEffects(draft, ctx);
}
