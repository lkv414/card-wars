import type { Draft } from 'immer';
import { pickRandom } from './rng';
import type { Ctx } from './util';
import { emit, instance, moveId, player } from './util';
import type { MatchState, PlayerId } from './types';
import { enqueueTrigger } from './mechanics/dispatch';
import { bumpCounter, noteDiscard } from './mechanics/effects';

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
  for (let i = 0; i < drawn; i += 1) {
    bumpCounter(draft, 'cards_drawn', playerId);
  }
  if (drawn > 0) {
    emit(ctx, { type: 'card_drawn', player: playerId, count: drawn });
    enqueueTrigger(draft, ctx, 'on_draw', { player: playerId, count: drawn });
  }
  return drawn;
}

/** Put n cards from the deck top into the discard pile (механика «мельницы»). */
export function discardTopDeck(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  n: number,
): void {
  const p = player(draft, playerId);
  const count = Math.min(n, p.deck.length);
  for (let i = 0; i < count; i++) {
    const id = p.deck.shift()!;
    const inst = instance(draft, id);
    inst.location = 'discard';
    p.discard.push(id);
    emit(ctx, { type: 'card_discarded', player: playerId, instanceId: id, cardId: inst.cardId, from: 'deck' });
  }
}

/** Opponent discards count random cards from hand (random pick, docs/MECHANICS-V2.md §3). */
export function opponentDiscardsRandom(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  count: number,
): void {
  const p = player(draft, playerId);
  for (let i = 0; i < count; i++) {
    const id = pickRandom(draft.rng, p.hand);
    if (!id) break;
    const inst = instance(draft, id);
    inst.location = 'discard';
    moveId(p.hand, p.discard, id);
    emit(ctx, { type: 'card_discarded', player: playerId, instanceId: id, cardId: inst.cardId, from: 'hand' });
    noteDiscard(draft, ctx, playerId, { instanceId: id, cardId: inst.cardId, from: 'hand' });
  }
}
