import type { Draft } from 'immer';
import { dealToCreature, dealToPlayer } from '../damage';
import { afterEffects } from '../deaths';
import { computeEff } from '../effects/stats';
import { mirrorZoneIndex } from '../effects/targets';
import type { Ctx } from '../util';
import { emit, instance, opponentOf, player } from '../util';
import type { MatchState } from '../types';
import { endTurn, lastAliveInOrder } from './turn';

export { mirrorZoneIndex };

/**
 * Combat phase (docs/RULES.md «Бой»): ready creatures of the active player
 * attack zone by zone, left to right. The defender creature retaliates
 * simultaneously; an empty defending zone takes the damage to the face.
 *
 * Round 1: only the last player in turn order attacks.
 */
export function resolveCombat(draft: Draft<MatchState>, ctx: Ctx): void {
  const attackerId = draft.activePlayer;
  draft.phase = 'combat';
  emit(ctx, { type: 'phase_changed', player: attackerId, phase: 'combat' });

  const canAttack = !(draft.round === 1 && attackerId !== lastAliveInOrder(draft));

  if (canAttack) {
    const attacker = player(draft, attackerId);
    const defenderId = opponentOf(draft, attackerId);
    const defender = player(draft, defenderId);

    for (let z = 0; z < attacker.zones.length; z++) {
      const attackerInstanceId = attacker.zones[z]!.creature;
      if (!attackerInstanceId) continue;
      const attackerInstance = instance(draft, attackerInstanceId);
      if (attackerInstance.flipped) continue;

      const attackPower = computeEff(draft, ctx, attackerInstanceId).attack;
      const defenderZoneIndex = mirrorZoneIndex(z, defender.zones.length);
      const defenderInstanceId = defender.zones[defenderZoneIndex]?.creature ?? null;

      if (defenderInstanceId) {
        // Simultaneous exchange: both powers are computed before any damage lands.
        const retaliation = computeEff(draft, ctx, defenderInstanceId).attack;
        dealToCreature(draft, ctx, defenderInstanceId, attackPower, attackerInstanceId);
        dealToCreature(draft, ctx, attackerInstanceId, retaliation, defenderInstanceId);
      } else {
        dealToPlayer(draft, ctx, defenderId, attackPower, attackerInstanceId);
      }
    }
  }

  afterEffects(draft, ctx);
  if (draft.status !== 'finished') {
    endTurn(draft, ctx);
  }
}
