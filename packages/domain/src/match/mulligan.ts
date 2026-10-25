import type { Draft } from 'immer';
import { DomainError } from '../errors';
import { shuffle } from '../rng';
import type { Ctx } from '../util';
import { emit, instance, player } from '../util';
import type { MatchState, PlayerId } from '../types';
import { startTurn } from './turn';

/** Mulligan: shuffle the whole hand back and draw a fresh starting hand (docs/RULES.md). */
export function handleMulligan(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId): void {
  if (draft.status !== 'mulligan') throw new DomainError('mulligan_unavailable', 'not in mulligan phase');
  const p = player(draft, playerId);
  if (draft.mulliganDecisions[playerId] !== undefined) {
    throw new DomainError('mulligan_unavailable', 'decision already made');
  }
  if (p.mulligansUsed >= ctx.config.mulliganCount) {
    throw new DomainError('mulligan_unavailable', 'mulligans used up');
  }
  const merged = shuffle(draft.rng, [...p.hand, ...p.deck]);
  const newHand = merged.splice(0, ctx.config.startingHandSize);
  for (const id of p.hand) instance(draft, id).location = 'deck';
  for (const id of newHand) instance(draft, id).location = 'hand';
  p.deck = merged;
  p.hand = newHand;
  p.mulligansUsed += 1;
  draft.mulliganDecisions[playerId] = 'mulligan';
  emit(ctx, { type: 'mulligan_made', player: playerId });
  maybeStartMatch(draft, ctx);
}

export function handleKeepHand(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId): void {
  if (draft.status !== 'mulligan') throw new DomainError('mulligan_unavailable', 'not in mulligan phase');
  player(draft, playerId);
  if (draft.mulliganDecisions[playerId] !== undefined) {
    throw new DomainError('mulligan_unavailable', 'decision already made');
  }
  draft.mulliganDecisions[playerId] = 'keep';
  emit(ctx, { type: 'mulligan_kept', player: playerId });
  maybeStartMatch(draft, ctx);
}

function maybeStartMatch(draft: Draft<MatchState>, ctx: Ctx): void {
  const allDecided = draft.order.every((pid) => draft.mulliganDecisions[pid] !== undefined);
  if (!allDecided) return;
  draft.status = 'running';
  draft.activePlayer = draft.order[0]!;
  startTurn(draft, ctx);
}
