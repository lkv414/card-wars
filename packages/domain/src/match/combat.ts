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
            // Соседи цели на ЕЁ стороне (Призрак Тэдди-крюка, docs §H14).
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
          if (mod.emptyLane && defenderInstanceId) continue; // только пустая линия
          if (mod.face) faceDamage = true;
          if (mod.atkBonus) attackPowerMod += mod.atkBonus;
          if (mod.multiplier) attackPowerMod *= mod.multiplier;
        }

        // Защита (Пещера одиночества): атака по защищённому уходит в лицо.
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
          // Simultaneous exchange: both powers are computed before any damage lands.
          bumpCounter(draft, 'creature_attack', attackerId);
          // Уклонение (Прозрачный ниндзя, docs §H14): d6 ≥ min — обмен целиком
          // срывается, урон и сдача не проходят.
          const dodgeThreshold = dodgeMin(draft, ctx, defenderInstanceId);
          if (dodgeThreshold !== undefined) {
            const roll = rngInt(draft.rng, 6) + 1;
            emit(ctx, { type: 'dice_rolled', value: roll, reason: 'dodge' });
            if (roll >= dodgeThreshold) continue;
          }
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
          // Эхо урона (jake_2v2_card_36, docs §H16): вооружённое существо бьёт —
          // 2 урона тому же противнику-игроку.
          const echoIdx = draft.armedDamageEcho.findIndex((e) => e.creatureId === attackerInstanceId && e.expiresTurn >= draft.turn);
          if (echoIdx >= 0 && attackPowerMod > 0) {
            const echo = draft.armedDamageEcho[echoIdx]!;
            draft.armedDamageEcho.splice(echoIdx, 1);
            dealToPlayer(draft, ctx, instance(draft, defenderInstanceId).controller, 2, echo.creatureId);
            const mate = teammatesOf(draft, echo.playerId)[0];
            if (mate) {
              // карта-награда уходит партнёру из руки владельца, если есть
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
