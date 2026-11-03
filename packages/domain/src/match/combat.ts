import type { Draft } from 'immer';
import { dealToCreature, dealToPlayer } from '../damage';
import { afterEffects } from '../deaths';
import { computeEff } from '../stats';
import { bumpCounter } from '../mechanics/effects';
import { attacksSuppressed, defenseMods } from '../mechanics/modifiers';
import { opponentZoneFor } from '../zones';
import type { Ctx } from '../util';
import { emit, instance, player } from '../util';
import type { MatchState } from '../types';
import { endTurn, lastAliveInOrder } from './turn';
import { enqueueTrigger } from '../mechanics/dispatch';
import { attackMods, hasNoRetaliation } from '../mechanics/modifiers';

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
        // «Не могут атаковать» (Морозильная камера, docs/MECHANICS-V2.md §3).
        if (attacksSuppressed(draft, ctx, attackerInstanceId)) continue;

        const target = opponentZoneFor(draft, attackerId, z);
        if (!target) continue;
        const defender = player(draft, target.player);
        const defenderInstanceId = defender.zones[target.zone]?.creature ?? null;
        const attackPower = computeEff(draft, ctx, attackerInstanceId).attack;

        // Боевые модификаторы атакующего (A3, docs/MECHANICS-V2.md §2А):
        // тройной урон / бонус АТК по земле зоны, удар «в лицо».
        const attackerLand = attackerInstance.zone !== null
          ? player(draft, attackerId).lands[attackerInstance.zone]!.type
          : null;
        let attackPowerMod = attackPower;
        let faceDamage = false;
        for (const mod of attackMods(draft, ctx, attackerInstanceId)) {
          if (mod.vs === 'ownZone' && mod.landType && attackerLand !== mod.landType) continue;
          if (mod.vs === 'defenderZone' && mod.landType) {
            if (!defenderInstanceId) continue;
            if (defender.lands[target.zone]!.type !== mod.landType) continue;
          }
          if (mod.face) faceDamage = true;
          if (mod.atkBonus) attackPowerMod += mod.atkBonus;
          if (mod.multiplier) attackPowerMod *= mod.multiplier;
        }

        if (defenderInstanceId && !faceDamage) {
          // Simultaneous exchange: both powers are computed before any damage lands.
          bumpCounter(draft, 'creature_attack', attackerId);
          let retaliation = computeEff(draft, ctx, defenderInstanceId).attack;
          // Боевой контекст защитника (A8): «+N АТК пока защищается от существ
          // на X земле» — земля ЗОНЫ АТАКУЮЩЕГО.
          const attackerZoneLandType = attackerInstance.zone !== null
            ? player(draft, attackerInstance.controller).lands[attackerInstance.zone]!.type
            : null;
          for (const mod of defenseMods(draft, ctx, defenderInstanceId, attackerZoneLandType)) {
            retaliation += mod.atkBonus;
          }
          if (hasNoRetaliation(draft, ctx, attackerInstanceId)) retaliation = 0;
          enqueueTrigger(draft, ctx, 'on_creature_attacks', {
            instanceId: attackerInstanceId,
            player: attackerInstance.controller,
            targetInstanceId: defenderInstanceId,
            zone: z,
            amount: attackPowerMod,
          });
          dealToCreature(draft, ctx, defenderInstanceId, attackPowerMod, attackerInstanceId, false, true);
          dealToCreature(draft, ctx, attackerInstanceId, retaliation, defenderInstanceId, false, true);
          enqueueTrigger(draft, ctx, 'on_damage_dealt', {
            instanceId: attackerInstanceId,
            player: attackerInstance.controller,
            targetInstanceId: defenderInstanceId,
            amount: attackPower,
          });
          enqueueTrigger(draft, ctx, 'on_damage_dealt', {
            instanceId: defenderInstanceId,
            player: instance(draft, defenderInstanceId).controller,
            targetInstanceId: attackerInstanceId,
            amount: retaliation,
          });
        } else {
          enqueueTrigger(draft, ctx, 'on_creature_attacks', {
            instanceId: attackerInstanceId,
            player: attackerInstance.controller,
            zone: z,
            amount: attackPowerMod,
          });
          dealToPlayer(draft, ctx, target.player, attackPower, attackerInstanceId);
          enqueueTrigger(draft, ctx, 'on_damage_dealt', {
            instanceId: attackerInstanceId,
            player: attackerInstance.controller,
            targetPlayer: target.player,
            amount: attackPower,
          });
        }
      }
    }
  }

  afterEffects(draft, ctx);
  // Stay in the combat phase; applyCommand finalises the turn once no choice is pending.
}
