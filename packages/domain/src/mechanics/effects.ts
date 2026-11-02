import type { Draft } from 'immer';
import { drawCards } from '../draw';
import { dealToCreature, dealToPlayer } from '../damage';
import { DomainError } from '../errors';
import { emit, instance, player } from '../util';
import type { Ctx } from '../util';
import type { MatchState } from '../types';
import { resolveStatAmount } from './modifiers';
import { resolveTarget } from './resolve';
import type { EffectSource } from './source';
import type { EffectSpec, TargetChoice } from './types';

/**
 * Execute one declarative effect (docs/MECHANICS-V2.md §3). Aura specs never
 * reach the interpreter — they are scanned by modifiers.ts; the union grows
 * per milestone and unknown ops are rejected explicitly.
 */
export function runEffect(
  draft: Draft<MatchState>,
  ctx: Ctx,
  effect: EffectSpec,
  source: EffectSource,
  choices: TargetChoice[] | undefined,
): void {
  switch (effect.op) {
    case 'deal_damage': {
      const targets = resolveTarget(draft, ctx, effect.target, source, choices);
      for (const target of targets) {
        if (target.kind === 'creature') {
          dealToCreature(draft, ctx, target.instanceId, effect.amount, source.instanceId, effect.pierce ?? false);
        } else if (target.kind === 'player') {
          dealToPlayer(draft, ctx, target.playerId, effect.amount, source.instanceId);
        }
      }
      return;
    }
    case 'draw_cards':
      drawCards(draft, ctx, source.player, effect.count);
      return;
    case 'stat_buff': {
      if (effect.duration === 'aura') {
        throw new DomainError('aura_not_castable', 'aura effects are scanned, never executed');
      }
      const targets = resolveTarget(draft, ctx, effect.target, source, choices);
      const amount = resolveStatAmount(draft, ctx, source, effect.amount);
      for (const target of targets) {
        if (target.kind !== 'creature' && target.kind !== 'building') continue;
        const inst = instance(draft, target.instanceId);
        if (effect.stat === 'attack') inst.bonusAttack += amount;
        else inst.bonusDefense += amount;
        emit(ctx, {
          type: 'bonus_changed',
          instanceId: target.instanceId,
          cardId: inst.cardId,
          bonusAttack: inst.bonusAttack,
          bonusDefense: inst.bonusDefense,
        });
      }
      return;
    }
    case 'gain_shield': {
      const targets = resolveTarget(draft, ctx, effect.target, source, choices);
      for (const target of targets) {
        if (target.kind !== 'creature') continue;
        const inst = instance(draft, target.instanceId);
        inst.shield += effect.amount;
        emit(ctx, { type: 'shield_changed', instanceId: target.instanceId, cardId: inst.cardId, shield: inst.shield });
      }
      return;
    }
    case 'gain_actions':
      player(draft, source.player).actions += effect.amount;
      return;
  }
}
