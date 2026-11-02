import type { Draft } from 'immer';
import { DomainError } from '../errors';
import type { Ctx } from '../util';
import { instance } from '../util';
import type { MatchState, PlayerId } from '../types';
import { isActive } from '../zones';

/**
 * Floop: turn (tap) a card and run its floop ability (docs/RULES.md «Ход игрока»).
 * A floop can be used the same turn the card entered play; the first player
 * cannot floop during the very first turn.
 *
 * Mechanics v2 interim state: no structured floop abilities exist yet
 * (docs/TECH.md № 2), so the command is rejected for every card; flip state and
 * the first-round rule stay in place.
 */
export function handleFloop(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  instanceId: string,
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

  // Mechanics v2 interim state: without structured floop data the engine cannot
  // know a card has «ПРИЕМ», so every floop is rejected (docs/TECH.md № 2).
  throw new DomainError('card_has_no_floop', `card ${inst.cardId} has no structured floop ability yet`);
}