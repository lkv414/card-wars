import type { Draft } from 'immer';
import type { CardCatalog } from './catalog';
import type { GameConfig } from './config';
import { DomainError } from './errors';
import type { GameEvent } from './events';
import type { CardData, CardInstance, MatchState, PlayerId, PlayerState } from './types';

/** Internal engine context passed through every handler. */
export interface Ctx {
  config: GameConfig;
  catalog: CardCatalog;
  events: GameEvent[];
}

export function emit(ctx: Ctx, event: GameEvent): void {
  ctx.events.push(event);
}

export function player(draft: Draft<MatchState>, id: PlayerId): PlayerState {
  const p = draft.players[id];
  if (!p) throw new DomainError('unknown_player', `unknown player ${id}`);
  return p;
}

export function instance(draft: Draft<MatchState>, id: string): CardInstance {
  const inst = draft.instances[id];
  if (!inst) throw new DomainError('unknown_instance', `unknown instance ${id}`);
  return inst;
}

export function cardOf(ctx: Pick<Ctx, 'config' | 'catalog'>, inst: CardInstance): CardData {
  const card = ctx.catalog.getCard(inst.cardId);
  if (!card) throw new DomainError('unknown_card', `unknown card ${inst.cardId}`);
  return card;
}

/** All instance ids currently in play (field cards + companions), in seating order. */
export function inPlayInstanceIds(draft: Draft<MatchState>): string[] {
  const ids: string[] = [];
  for (const pid of draft.order) {
    const p = draft.players[pid]!;
    for (const zone of p.zones) {
      if (zone.creature) ids.push(zone.creature);
      if (zone.building) ids.push(zone.building);
    }
    if (p.companion) ids.push(p.companion);
  }
  return ids;
}

/** The single opponent in a 2-player match (MVP); 3–4 players arrive in stage 5. */
export function opponentOf(draft: Draft<MatchState>, playerId: PlayerId): PlayerId {
  const other = draft.order.find((id) => id !== playerId);
  if (!other) throw new DomainError('invalid_setup', 'opponent not found');
  return other;
}

/** Move an instance id between id lists of a player (hand/deck/discard). */
export function moveId(from: string[], to: string[], id: string): void {
  const i = from.indexOf(id);
  if (i >= 0) from.splice(i, 1);
  to.push(id);
}
