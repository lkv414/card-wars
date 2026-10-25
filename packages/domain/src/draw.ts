import type { Draft } from 'immer';
import { pickRandom } from './rng';
import type { Ctx } from './util';
import { cardOf, emit, instance, moveId, player } from './util';
import type { CardType, LandType, MatchState, PlayerId } from './types';

export interface DiscardFilter {
  type?: CardType;
  landType?: LandType;
}

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
  if (drawn > 0) emit(ctx, { type: 'card_drawn', player: playerId, count: drawn });
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
    emit(ctx, {
      type: 'card_discarded',
      player: playerId,
      instanceId: id,
      cardId: inst.cardId,
      from: 'deck',
    });
  }
}

/** Opponent discards count random cards from hand (random pick is v1 semantics). */
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
    emit(ctx, {
      type: 'card_discarded',
      player: playerId,
      instanceId: id,
      cardId: inst.cardId,
      from: 'hand',
    });
  }
}

/** Return a card from discard to hand by filter (first or random match). */
export function returnFromDiscard(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  filter: DiscardFilter | undefined,
  random: boolean,
): boolean {
  const p = player(draft, playerId);
  const candidates = p.discard.filter((id: string) => {
    const inst = instance(draft, id);
    const card = cardOf(ctx, inst);
    if (filter?.type && card.type !== filter.type) return false;
    if (filter?.landType && card.landType !== filter.landType) return false;
    return true;
  });
  const chosen = random ? pickRandom(draft.rng, candidates) : candidates[0];
  if (!chosen) return false;
  const inst = instance(draft, chosen);
  inst.location = 'hand';
  moveId(p.discard, p.hand, chosen);
  emit(ctx, { type: 'card_returned', player: playerId, instanceId: chosen, cardId: inst.cardId });
  return true;
}
