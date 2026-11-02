import type { Draft } from 'immer';
import type { Ctx } from './util';
import { emit, instance, player } from './util';
import type { MatchState, PlayerId } from './types';
import { enqueueTrigger } from './mechanics/dispatch';

/** Draw n cards from the deck top; draws what is left when the deck runs out. */
export function drawCards(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  n: number,
): number {
  const p = player(draft, playerId);
  const drawn = Math.min(n, p.deck.length);
  for (let i = 0; i < drawn; i++) {
    const id = p.deck.shift()!;
    const inst = instance(draft, id);
    inst.location = 'hand';
    p.hand.push(id);
  }
  if (drawn > 0) {
    emit(ctx, { type: 'card_drawn', player: playerId, count: drawn });
    enqueueTrigger(draft, ctx, 'on_draw', { player: playerId, count: drawn });
  }
  return drawn;
}
