import { produce } from 'immer';
import type { ApplyResult, Command, DomainDeps } from '../commands';
import { afterEffects } from '../deaths';
import { drawCards } from '../draw';
import { DomainError } from '../errors';
import { resolveCombat } from './combat';
import { handleFloop } from './floop';
import { handleKeepHand, handleMulligan } from './mulligan';
import { handlePlayCard } from './play';
import { emit, instance, moveId, player } from '../util';
import type { Draft } from 'immer';
import type { Ctx } from '../util';
import type { MatchState, PlayerId } from '../types';

/**
 * The only way the match state transitions (docs/ARCHITECTURE.md):
 * a command is validated and applied atomically, producing a new immutable
 * state plus the events it caused. Illegal commands leave the state untouched.
 */
export function applyCommand(
  state: MatchState,
  command: Command,
  deps: DomainDeps,
): ApplyResult {
  const events: Ctx['events'] = [];
  const ctx: Ctx = { config: deps.config, catalog: deps.catalog, events };
  try {
    const next = produce(state, (draft) => {
      handle(draft, ctx, command);
    });
    return { ok: true, state: next, events };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, rejected: { code: error.code, message: error.message } };
    }
    throw error;
  }
}

function requireRunning(draft: Draft<MatchState>): void {
  if (draft.status === 'finished') throw new DomainError('match_finished', 'match is finished');
  if (draft.status !== 'running') throw new DomainError('match_not_running', 'match is not running');
}

function requireActiveMain(draft: Draft<MatchState>, playerId: PlayerId): void {
  requireRunning(draft);
  if (draft.activePlayer !== playerId) throw new DomainError('not_your_turn', `not ${playerId}'s turn`);
  if (draft.phase !== 'main') throw new DomainError('wrong_phase', `phase is ${draft.phase}`);
}

/** Eliminate a player by their own action (surrender) or by timeout (disconnect); the opponent wins. */
function finishByForfeit(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  reason: 'surrender' | 'disconnect',
): void {
  const p = player(draft, playerId);
  if (p.eliminated) throw new DomainError('match_finished', 'player already out');
  if (reason === 'surrender') {
    p.surrendered = true;
    emit(ctx, { type: 'player_surrendered', player: playerId });
  } else {
    emit(ctx, { type: 'player_disconnected', player: playerId });
  }
  for (const zone of p.zones) {
    for (const slot of ['creature', 'building'] as const) {
      const id = zone[slot];
      if (id) {
        instance(draft, id).location = 'removed';
        zone[slot] = null;
      }
    }
  }
  if (p.companion) {
    instance(draft, p.companion).location = 'removed';
    p.companion = null;
  }
  p.eliminated = true;
  emit(ctx, { type: 'player_eliminated', player: playerId });
  const winners = draft.order.filter((pid) => !draft.players[pid]!.eliminated);
  draft.status = 'finished';
  draft.winners = winners;
  draft.finishReason = reason;
  emit(ctx, { type: 'match_finished', winners, reason });
}

function handle(draft: Draft<MatchState>, ctx: Ctx, command: Command): void {
  switch (command.type) {
    case 'mulligan':
      handleMulligan(draft, ctx, command.player);
      return;
    case 'keep_hand':
      handleKeepHand(draft, ctx, command.player);
      return;
    case 'play_card':
      handlePlayCard(draft, ctx, command.player, command.instanceId, command.zone, command.unfreezeWith, command.choices);
      return;
    case 'floop':
      handleFloop(draft, ctx, command.player, command.instanceId, command.choices);
      return;
    case 'draw_extra': {
      requireActiveMain(draft, command.player);
      const p = player(draft, command.player);
      if (p.deck.length === 0) throw new DomainError('deck_empty', 'deck is empty');
      if (p.actions < ctx.config.extraDrawCost) {
        throw new DomainError('insufficient_actions', 'not enough actions for an extra draw');
      }
      p.actions -= ctx.config.extraDrawCost;
      drawCards(draft, ctx, command.player, 1);
      return;
    }
    case 'discard_from_hand': {
      requireActiveMain(draft, command.player);
      const p = player(draft, command.player);
      const inst = instance(draft, command.instanceId);
      if (inst.location !== 'hand' || inst.controller !== command.player) {
        throw new DomainError('card_not_in_hand', 'card is not in your hand');
      }
      if (command.unfreezeZone !== undefined) {
        if (command.unfreezeZone < 0 || command.unfreezeZone >= p.lands.length) {
          throw new DomainError('zone_out_of_range', 'zone out of range');
        }
        if (!p.lands[command.unfreezeZone]!.frozen) {
          throw new DomainError('zone_not_frozen', 'zone is not frozen');
        }
        p.lands[command.unfreezeZone]!.frozen = false;
        emit(ctx, { type: 'land_changed', player: command.player, zone: command.unfreezeZone, change: 'unfrozen' });
      }
      inst.location = 'discard';
      moveId(p.hand, p.discard, command.instanceId);
      emit(ctx, { type: 'card_discarded', player: command.player, instanceId: command.instanceId, cardId: inst.cardId, from: 'hand' });
      return;
    }
    case 'discard_from_field': {
      requireActiveMain(draft, command.player);
      const p = player(draft, command.player);
      const inst = instance(draft, command.instanceId);
      if (inst.controller !== command.player || (inst.location !== 'field' && inst.location !== 'companion')) {
        throw new DomainError('card_not_in_play', 'card is not on your field');
      }
      if (inst.zone !== null && inst.slot) {
        p.zones[inst.zone]![inst.slot] = null;
      }
      if (inst.location === 'companion') p.companion = null;
      inst.location = 'discard';
      inst.zone = null;
      inst.slot = null;
      p.discard.push(command.instanceId);
      emit(ctx, { type: 'card_discarded', player: command.player, instanceId: command.instanceId, cardId: inst.cardId, from: 'field' });
      afterEffects(draft, ctx);
      return;
    }
    case 'go_battle': {
      requireActiveMain(draft, command.player);
      resolveCombat(draft, ctx);
      return;
    }
    case 'time_expired': {
      // Automatic transition sent by the adapter's timer state machine (docs/TECH.md).
      requireActiveMain(draft, command.player);
      emit(ctx, { type: 'timer_expired', player: command.player });
      resolveCombat(draft, ctx);
      return;
    }
    case 'surrender': {
      requireRunning(draft);
      finishByForfeit(draft, ctx, command.player, 'surrender');
      return;
    }
    case 'disconnect_loss': {
      // Server-only command: the reconnect wait expired for this player (docs/NETWORK.md).
      requireRunning(draft);
      finishByForfeit(draft, ctx, command.player, 'disconnect');
      return;
    }
    default: {
      // Exhaustiveness guard: unknown command shapes are rejected, not thrown past the API.
      const exhaustive: never = command;
      throw new DomainError('unknown_command', String((exhaustive as { type?: string }).type));
    }
  }
}
