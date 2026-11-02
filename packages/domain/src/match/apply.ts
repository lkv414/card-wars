import { produce } from 'immer';
import type { ApplyResult, Command, DomainDeps } from '../commands';
import { afterEffects, eliminatePlayer, eliminateTeam } from '../deaths';
import { drawCards } from '../draw';
import { DomainError } from '../errors';
import { finishMatch } from '../finish';
import { isActive, teamOf } from '../zones';
import { resolveCombat } from './combat';
import { handleFloop } from './floop';
import { handleHeroAbility } from './hero';
import { handleKeepHand, handleMulligan } from './mulligan';
import { handlePlayCard } from './play';
import { endTurn } from './turn';
import { enqueueTrigger, resolvePending, skipPending } from '../mechanics/dispatch';
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
  const ctx: Ctx = { config: deps.config, catalog: deps.catalog, events, frame: { queue: [], steps: 0 } };
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
  if (!isActive(draft, playerId)) throw new DomainError('not_your_turn', `not ${playerId}'s turn`);
  if (draft.players[playerId]!.battleReady) {
    throw new DomainError('wrong_phase', 'player is ready for battle');
  }
  if (draft.phase !== 'main') throw new DomainError('wrong_phase', `phase is ${draft.phase}`);
}

/** FFA surrender eliminates one player and continues; 2v2 loses the team only on the second surrender. */
function handleSurrender(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId): void {
  requireRunning(draft);
  const p = player(draft, playerId);
  if (p.eliminated) throw new DomainError('match_finished', 'player already out');
  if (p.surrendered) throw new DomainError('already_surrendered', 'player already surrendered');

  p.surrendered = true;
  emit(ctx, { type: 'player_surrendered', player: playerId });

  const team = teamOf(draft, playerId);
  if (team) {
    const allSurrendered = team.playerIds.every(
      (pid) => draft.players[pid]!.surrendered || draft.players[pid]!.eliminated,
    );
    if (!allSurrendered) return; // the team keeps playing until both surrender
    eliminateTeam(draft, ctx, team.id);
    const otherTeam = Object.values(draft.teams ?? {}).find(
      (t) => t.id !== team.id && !t.eliminated,
    );
    finishMatch(draft, ctx, otherTeam ? [...otherTeam.playerIds] : [], 'surrender');
    return;
  }

  const wasActive = isActive(draft, playerId);
  eliminatePlayer(draft, ctx, playerId);
  const alive = draft.order.filter((pid) => !draft.players[pid]!.eliminated);
  if (alive.length <= 1) {
    finishMatch(draft, ctx, alive, 'surrender');
    return;
  }
  if (wasActive) endTurn(draft, ctx);
}

/** Reconnect wait expired: the disconnected side loses immediately (docs/NETWORK.md). */
function handleDisconnectLoss(draft: Draft<MatchState>, ctx: Ctx, playerId: PlayerId): void {
  requireRunning(draft);
  const p = player(draft, playerId);
  if (p.eliminated) return;
  emit(ctx, { type: 'player_disconnected', player: playerId });

  const team = teamOf(draft, playerId);
  if (team) {
    eliminateTeam(draft, ctx, team.id);
    const otherTeam = Object.values(draft.teams ?? {}).find(
      (t) => t.id !== team.id && !t.eliminated,
    );
    finishMatch(draft, ctx, otherTeam ? [...otherTeam.playerIds] : [], 'disconnect');
    return;
  }

  eliminatePlayer(draft, ctx, playerId);
  const winners = draft.order.filter((pid) => !draft.players[pid]!.eliminated);
  finishMatch(draft, ctx, winners, 'disconnect');
}

/** «В бой» / timer: in 2v2 only marks this ally ready; combat starts when both are ready. */
function markBattleReady(
  draft: Draft<MatchState>,
  ctx: Ctx,
  playerId: PlayerId,
  timedOut: boolean,
): void {
  requireRunning(draft);
  if (!isActive(draft, playerId)) throw new DomainError('not_your_turn', `not ${playerId}'s turn`);
  if (draft.phase !== 'main') throw new DomainError('wrong_phase', `phase is ${draft.phase}`);
  const p = player(draft, playerId);
  if (p.battleReady) return; // stale timer / duplicate press
  if (timedOut) emit(ctx, { type: 'timer_expired', player: playerId });
  if (draft.mode !== 'teams' || draft.activePlayers.length === 1) {
    resolveCombat(draft, ctx);
    return;
  }
  p.battleReady = true;
  emit(ctx, { type: 'battle_ready', player: playerId });
  const allReady = draft.activePlayers.every((pid) => draft.players[pid]!.battleReady);
  if (allReady) resolveCombat(draft, ctx);
}

function handle(draft: Draft<MatchState>, ctx: Ctx, command: Command): void {
  // While a transition is paused for a decision (docs/MECHANICS-V2.md §6),
  // only the answer, its timer default, surrender and disconnect commands pass.
  if (
    draft.pending &&
    command.type !== 'resolve_choice' &&
    command.type !== 'time_expired' &&
    command.type !== 'surrender' &&
    command.type !== 'disconnect_loss'
  ) {
    throw new DomainError('choice_pending', 'a choice is awaited before other commands');
  }
  switch (command.type) {
    case 'mulligan':
      handleMulligan(draft, ctx, command.player);
      return;
    case 'keep_hand':
      handleKeepHand(draft, ctx, command.player);
      return;
    case 'play_card':
      handlePlayCard(draft, ctx, command.player, command.instanceId, command.zone, command.unfreezeWith, command.targets);
      return;
    case 'floop':
      handleFloop(draft, ctx, command.player, command.instanceId, command.targets);
      return;
    case 'hero_ability':
      handleHeroAbility(draft, ctx, command.player, command.targets);
      return;
    case 'resolve_choice': {
      const pending = draft.pending;
      if (!pending) throw new DomainError('no_pending_choice', 'nothing is awaited');
      if (pending.player !== command.player) {
        throw new DomainError('not_your_choice', `waiting for ${pending.player}`);
      }
      resolvePending(draft, ctx, command.answer);
      return;
    }
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
      const from = inst.location === 'companion' ? 'companion' : 'field';
      inst.location = 'discard';
      inst.zone = null;
      inst.slot = null;
      p.discard.push(command.instanceId);
      emit(ctx, { type: 'card_discarded', player: command.player, instanceId: command.instanceId, cardId: inst.cardId, from });
      enqueueTrigger(draft, ctx, 'on_leave_play', { instanceId: command.instanceId, cardId: inst.cardId, player: command.player });
      afterEffects(draft, ctx);
      return;
    }
    case 'go_battle':
      markBattleReady(draft, ctx, command.player, false);
      return;
    case 'time_expired':
      // Timer default for a paused choice (docs/MECHANICS-V2.md §6): skip/cancel
      // the awaited ability, then proceed with the automatic battle transition.
      if (draft.pending) skipPending(draft, ctx);
      // Automatic transition sent by the adapter's timer state machine (docs/TECH.md).
      markBattleReady(draft, ctx, command.player, true);
      return;
    case 'surrender':
      handleSurrender(draft, ctx, command.player);
      return;
    case 'disconnect_loss':
      // Server-only command: the reconnect wait expired for this player (docs/NETWORK.md).
      handleDisconnectLoss(draft, ctx, command.player);
      return;
    default: {
      // Exhaustiveness guard: unknown command shapes are rejected, not thrown past the API.
      const exhaustive: never = command;
      throw new DomainError('unknown_command', String((exhaustive as { type?: string }).type));
    }
  }
}
