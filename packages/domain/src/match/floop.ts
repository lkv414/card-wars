import type { Draft } from 'immer';
import { afterEffects } from '../deaths';
import { runFloopAbilities } from '../effects/interpreter';
import { DomainError } from '../errors';
import type { CommandChoices } from '../commands';
import type { Ctx } from '../util';
import { cardOf, emit, instance, player } from '../util';
import type { MatchState, PlayerId } from '../types';
import { isActive } from '../zones';

/**
 * Floop: turn (tap) a card and run its floop ability (docs/RULES.md «Ход игрока»).
 * A floop can be used the same turn the card entered play; the first player
 * cannot floop during the very first turn.
 */
export function handleFloop(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  instanceId: string,
  choices: CommandChoices | undefined,
): void {
  if (draft.status === 'finished') throw new DomainError('match_finished', 'match is finished');
  if (draft.status !== 'running') throw new DomainError('match_not_running', 'match is not running');
  if (!isActive(draft, playerId)) throw new DomainError('not_your_turn', `not ${playerId}'s turn`);
  if (draft.players[playerId]!.battleReady) {
    throw new DomainError('wrong_phase', 'player is ready for battle');
  }
  if (draft.phase !== 'main') throw new DomainError('wrong_phase', `phase is ${draft.phase}`);

  const p = player(draft, playerId);
  const inst = instance(draft, instanceId);
  if (inst.controller !== playerId) throw new DomainError('card_not_in_play', 'not your card');
  if (inst.location !== 'field' && inst.location !== 'companion') {
    throw new DomainError('card_not_in_play', 'card is not in play');
  }
  if (inst.flipped) throw new DomainError('already_flipped', 'card is already flipped');

  const card = cardOf(ctx, inst);
  const floops = card.abilities.filter((a) => a.kind === 'floop');
  if (floops.length === 0) {
    throw new DomainError('card_has_no_floop', `card ${card.id} has no flop ability`);
  }

  // FFA: the first player cannot floop in their first turn; 2v2: no floops in round 1.
  // (docs/RULES.md «Подготовка партии», «Ход команды»).
  const firstRoundForbidden =
    draft.round === 1 && (draft.mode === 'teams' || draft.activePlayer === draft.order[0]);
  if (firstRoundForbidden) {
    throw new DomainError('floop_forbidden_first_turn', 'floop is forbidden in the first round');
  }

  const paidActions = floops.reduce((sum, a) => sum + (a.floopCost ?? 0), 0);
  if (p.actions < paidActions) {
    throw new DomainError('insufficient_actions', `floop costs ${paidActions} actions`);
  }

  runFloopAbilities(draft, ctx, instanceId, choices);

  p.actions -= paidActions;
  inst.flipped = true;
  emit(ctx, { type: 'floop_used', player: playerId, instanceId, cardId: card.id, paidActions });
  afterEffects(draft, ctx);
}
