import type { Draft } from 'immer';
import type { Ctx } from './util';
import { emit } from './util';
import type { FinishReason, MatchState, PlayerId } from './types';

/** Close the match with the given winners (docs/RULES.md «Выбывание и победа»). */
export function finishMatch(
  draft: Draft<MatchState>,
  ctx: Ctx,
  winners: PlayerId[],
  reason: FinishReason,
): void {
  if (draft.status === 'finished') return;
  draft.status = 'finished';
  draft.winners = winners;
  draft.finishReason = reason;
  draft.pending = null; // a paused choice cannot outlive the match
  emit(ctx, { type: 'match_finished', winners, reason });
}
