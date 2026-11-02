import type { Draft } from 'immer';
import { dealToCreature, dealToPlayer } from '../damage';
import { afterEffects } from '../deaths';
import { computeEff } from '../stats';
import { opponentZoneFor } from '../zones';
import type { Ctx } from '../util';
import { emit, instance, player } from '../util';
import type { MatchState } from '../types';
import { endTurn, lastAliveInOrder } from './turn';
import { enqueueTrigger } from '../mechanics/dispatch';
import { hasNoRetaliation } from '../mechanics/modifiers';

export { mirrorZoneIndex } from '../zones';

/**
 * Combat phase (docs/RULES.md «Бой»): ready creatures attack zone by zone,
 * left to right. The defender creature retaliates simultaneously; an empty
 * defending zone takes the damage to the face. In 2v2 both allies attack,
 * each zone is paired by seating (docs/RULES.md «Зоны»).
 *
 * Round 1: FFA — only the last player in turn order attacks; 2v2 — no attacks.
 */
export function resolveCombat(draft: Draft<MatchState>, ctx: Ctx): void {
  draft.phase = 'combat';
  for (const pid of draft.activePlayers) {
    emit(ctx, { type: 'phase_changed', player: pid, phase: 'combat' });
    enqueueTrigger(draft, ctx, 'start_of_battle_phase', { player: pid });
  }

  const firstActive = draft.activePlayers[0]!;
  const canAttack =
    draft.mode === 'teams'
      ? draft.round !== 1
      : !(draft.round === 1 && firstActive !== lastAliveInOrder(draft));

  if (canAttack) {
    for (const attackerId of draft.activePlayers) {
      if (draft.status === 'finished') break;
      const attacker = player(draft, attackerId);

      for (let z = 0; z < attacker.zones.length; z++) {
        const attackerInstanceId = attacker.zones[z]!.creature;
        if (!attackerInstanceId) continue;
        const attackerInstance = instance(draft, attackerInstanceId);
        if (attackerInstance.flipped) continue;

        const target = opponentZoneFor(draft, attackerId, z);
        if (!target) continue;
        const defender = player(draft, target.player);
        const defenderInstanceId = defender.zones[target.zone]?.creature ?? null;
        const attackPower = computeEff(draft, ctx, attackerInstanceId).attack;

        if (defenderInstanceId) {
          // Simultaneous exchange: both powers are computed before any damage lands.
          let retaliation = computeEff(draft, ctx, defenderInstanceId).attack;
          if (hasNoRetaliation(draft, ctx, attackerInstanceId)) retaliation = 0;
          enqueueTrigger(draft, ctx, 'on_creature_attacks', {
            instanceId: attackerInstanceId,
            targetInstanceId: defenderInstanceId,
            zone: z,
            amount: attackPower,
          });
          dealToCreature(draft, ctx, defenderInstanceId, attackPower, attackerInstanceId, false, true);
          dealToCreature(draft, ctx, attackerInstanceId, retaliation, defenderInstanceId, false, true);
          enqueueTrigger(draft, ctx, 'on_damage_dealt', {
            instanceId: attackerInstanceId,
            targetInstanceId: defenderInstanceId,
            amount: attackPower,
          });
          enqueueTrigger(draft, ctx, 'on_damage_dealt', {
            instanceId: defenderInstanceId,
            targetInstanceId: attackerInstanceId,
            amount: retaliation,
          });
        } else {
          enqueueTrigger(draft, ctx, 'on_creature_attacks', {
            instanceId: attackerInstanceId,
            zone: z,
            amount: attackPower,
          });
          dealToPlayer(draft, ctx, target.player, attackPower, attackerInstanceId);
          enqueueTrigger(draft, ctx, 'on_damage_dealt', {
            instanceId: attackerInstanceId,
            targetPlayer: target.player,
            amount: attackPower,
          });
        }
      }
    }
  }

  afterEffects(draft, ctx);
  if (draft.status !== 'finished') {
    endTurn(draft, ctx);
  }
}
