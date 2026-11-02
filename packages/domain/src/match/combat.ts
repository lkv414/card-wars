import type { Draft } from 'immer';
import { dealToCreature, dealToPlayer } from '../damage';
import { afterEffects } from '../deaths';
import { computeEff } from '../stats';
import { opponentZoneFor } from '../zones';
import type { Ctx } from '../util';
import { emit, instance, player } from '../util';
import type { MatchState } from '../types';
import { endTurn, lastAliveInOrder } from './turn';

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
          const retaliation = computeEff(draft, ctx, defenderInstanceId).attack;
          dealToCreature(draft, ctx, defenderInstanceId, attackPower, attackerInstanceId);
          dealToCreature(draft, ctx, attackerInstanceId, retaliation, defenderInstanceId);
        } else {
          dealToPlayer(draft, ctx, target.player, attackPower, attackerInstanceId);
        }
      }
    }
  }

  afterEffects(draft, ctx);
  if (draft.status !== 'finished') {
    endTurn(draft, ctx);
  }
}
