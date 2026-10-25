import type { Draft } from 'immer';
import { drawCards } from '../draw';
import { fireTriggerForPlayer, runHeroAbility } from '../effects/interpreter';
import type { Ctx } from '../util';
import { emit, player } from '../util';
import type { MatchState } from '../types';

/** The last non-eliminated player in seating order — the only one attacking in round 1 (docs/RULES.md). */
export function lastAliveInOrder(draft: Draft<MatchState>): string {
  for (let i = draft.order.length - 1; i >= 0; i--) {
    const pid = draft.order[i]!;
    if (!draft.players[pid]!.eliminated) return pid;
  }
  throw new Error('no alive players');
}

/** Untap + automatic draw phase + hero ability + start-of-turn triggers + actions. */
export function startTurn(draft: Draft<MatchState>, ctx: Ctx): void {
  const pid = draft.activePlayer;
  const p = player(draft, pid);
  draft.turn += 1;
  emit(ctx, { type: 'turn_started', player: pid, turn: draft.turn, round: draft.round });

  // Подготовка: own field cards and companion become ready again.
  for (const zone of p.zones) {
    if (zone.creature) draft.instances[zone.creature]!.flipped = false;
    if (zone.building) draft.instances[zone.building]!.flipped = false;
  }
  if (p.companion) draft.instances[p.companion]!.flipped = false;

  // Добор: free draws are automatic (docs/RULES.md, «Ход игрока»).
  draft.phase = 'draw';
  emit(ctx, { type: 'phase_changed', player: pid, phase: 'draw' });
  drawCards(draft, ctx, pid, ctx.config.freeDrawsPerTurn);

  // Hero passive (e.g. an extra free draw), then card start-of-turn triggers.
  const hero = ctx.catalog.getHero(p.heroId);
  if (hero) runHeroAbility(draft, ctx, hero);
  fireTriggerForPlayer(draft, ctx, 'start_of_turn', pid);

  draft.phase = 'main';
  emit(ctx, { type: 'phase_changed', player: pid, phase: 'main' });
  p.actions = ctx.config.actionsPerTurn;
}

/** Burn leftovers, drop this-turn buffs and spell visuals, pass to the next alive player. */
export function endTurn(draft: Draft<MatchState>, ctx: Ctx): void {
  draft.tempBuffs = [];
  draft.castSpells = [];
  player(draft, draft.activePlayer).actions = 0;

  const currentIndex = draft.order.indexOf(draft.activePlayer);
  let nextIndex = currentIndex;
  for (let step = 1; step <= draft.order.length; step++) {
    const candidate = (currentIndex + step) % draft.order.length;
    const pid = draft.order[candidate]!;
    if (!draft.players[pid]!.eliminated) {
      nextIndex = candidate;
      break;
    }
  }
  if (nextIndex <= currentIndex) draft.round += 1;
  draft.activePlayer = draft.order[nextIndex]!;
  startTurn(draft, ctx);
}
