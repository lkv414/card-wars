import type { Draft } from 'immer';
import { dealToCreature, dealToPlayer } from '../damage';
import { afterEffects } from '../deaths';
import { computeEff } from '../stats';
import { bumpCounter } from '../mechanics/effects';
import { attacksSuppressed, defenseMods, dodgeMin } from '../mechanics/modifiers';
import { opponentZoneFor, teammatesOf } from '../zones';
import { rngInt } from '../rng';
import type { Ctx } from '../util';
import { emit, instance, player } from '../util';
import type { MatchState } from '../types';
import { lastAliveInOrder } from './turn';
import { enqueueTrigger } from '../mechanics/dispatch';
import { attackMods, hasNoRetaliation } from '../mechanics/modifiers';

export { mirrorZoneIndex } from '../zones';

/**
 * Combat phase (docs/RULES.md): ready creatures attack zone by zone,
 * left to right. The defender creature retaliates simultaneously; an empty
 * defending zone takes the damage to the face. In 2v2 both allies attack,
 * each zone is paired by seating (docs/RULES.md).
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
        // Attack suppression aura (docs/MECHANICS-V2.md §3).
        if (attacksSuppressed(draft, ctx, attackerInstanceId)) continue;

        const target = opponentZoneFor(draft, attackerId, z);
        if (!target) continue;
        const defender = player(draft, target.player);
        const defenderInstanceId = defender.zones[target.zone]?.creature ?? null;
        const strikeInstanceId0 = attackerInstanceId; void strikeInstanceId0;
        const attackPower = computeEff(draft, ctx, attackerInstanceId).attack;

        // Attacker combat modifiers (A3, docs/MECHANICS-V2.md §2A):
        // multiplier / ATK bonus by zone land, direct face hit.
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
          if (mod.defenderType !== undefined) {
            if (!defenderInstanceId) continue;
            const defenderCard = ctx.catalog.getCard(instance(draft, defenderInstanceId).cardId);
            if (defenderCard?.landType !== mod.defenderType) continue;
          }
          if (mod.defenderCost !== undefined) {
            if (!defenderInstanceId) continue;
            const defenderCard = ctx.catalog.getCard(instance(draft, defenderInstanceId).cardId);
            if ((defenderCard?.cost ?? 0) !== mod.defenderCost) continue;
          }
          if (mod.atkBonusPerAdjacentEnemy !== undefined && defenderInstanceId) {
            // Target's neighbors on its own side (docs §H14).
            const defenderZone = instance(draft, defenderInstanceId).zone;
            if (defenderZone !== null) {
              let adjacentEnemies = 0;
              for (const dz of [defenderZone - 1, defenderZone + 1]) {
                const neighbor = defender.zones[dz]?.creature;
                if (neighbor) adjacentEnemies += 1;
              }
              attackPowerMod += mod.atkBonusPerAdjacentEnemy * adjacentEnemies;
            }
          }
          if (mod.emptyLane && defenderInstanceId) continue; // empty lane only
          if (mod.face) faceDamage = true;
          if (mod.atkBonus) attackPowerMod += mod.atkBonus;
          if (mod.multiplier) attackPowerMod *= mod.multiplier;
        }

        // Protection (docs §G5): attacks against a protected creature go to the face.
        const defenderProtected = defenderInstanceId !== null && draft.protections.some((pr) => pr.instanceId === defenderInstanceId);
        if (defenderProtected) {
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
          continue;
        }
        if (defenderInstanceId && !faceDamage) {
          // Attacker replacement (cake_card_33, docs §H16): strike and retaliation use the substitute.
          const armIdx = draft.armedReplacements.findIndex((r) => r.attackerId === attackerInstanceId && r.expiresTurn >= draft.turn);
          let strikeId = attackerInstanceId;
          if (armIdx >= 0) {
            strikeId = draft.armedReplacements[armIdx]!.substituteId;
            draft.armedReplacements.splice(armIdx, 1);
          }
          // Simultaneous exchange: both powers are computed before any damage lands.
          bumpCounter(draft, 'creature_attack', attackerId);
          // Dodge (docs §H14): d6 >= min cancels the entire combat exchange.
          const dodgeThreshold = dodgeMin(draft, ctx, defenderInstanceId);
          if (dodgeThreshold !== undefined) {
            const roll = rngInt(draft.rng, 6) + 1;
            emit(ctx, { type: 'dice_rolled', value: roll, reason: 'dodge' });
            if (roll >= dodgeThreshold) continue;
          }
          let retaliation = computeEff(draft, ctx, defenderInstanceId).attack;
          // Defender combat context (A8): "+N ATK while defending against creatures
          // on X land" — reads the attacker's zone land.
          const strikeZone = instance(draft, strikeId).zone;
          const attackerZoneLandType = strikeZone !== null
            ? player(draft, instance(draft, strikeId).controller).lands[strikeZone]!.type
            : null;
          for (const mod of defenseMods(draft, ctx, defenderInstanceId, attackerZoneLandType)) {
            retaliation += mod.atkBonus;
          }
          if (hasNoRetaliation(draft, ctx, strikeId)) retaliation = 0;
          enqueueTrigger(draft, ctx, 'on_creature_attacks', {
            instanceId: attackerInstanceId,
            player: attackerInstance.controller,
            targetInstanceId: defenderInstanceId,
            zone: z,
            amount: attackPowerMod,
          });
          dealToCreature(draft, ctx, defenderInstanceId, attackPowerMod, strikeId, false, true);
          dealToCreature(draft, ctx, strikeId, retaliation, defenderInstanceId, false, true);
          enqueueTrigger(draft, ctx, 'on_damage_dealt', {
            instanceId: attackerInstanceId,
            player: attackerInstance.controller,
            targetInstanceId: defenderInstanceId,
            amount: attackPower,
          });
          // Damage echo (jake_2v2_card_36, docs §H16): when the armed creature hits,
          // deal 2 damage to the defending player and give a card to the teammate.
          const echoIdx = draft.armedDamageEcho.findIndex((e) => e.creatureId === attackerInstanceId && e.expiresTurn >= draft.turn);
          if (echoIdx >= 0 && attackPowerMod > 0) {
            const echo = draft.armedDamageEcho[echoIdx]!;
            draft.armedDamageEcho.splice(echoIdx, 1);
            dealToPlayer(draft, ctx, instance(draft, defenderInstanceId).controller, 2, echo.creatureId);
            const mate = teammatesOf(draft, echo.playerId)[0];
            if (mate) {
              // Reward card goes to the teammate from the owner's hand, if any.
              const p = player(draft, echo.playerId);
              const give = p.hand[0];
              if (give) {
                const gi = instance(draft, give);
                p.hand = p.hand.filter((x) => x !== give);
                gi.controller = mate;
                gi.location = 'hand';
                draft.players[mate]!.hand.push(give);
              }
            }
          }
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
