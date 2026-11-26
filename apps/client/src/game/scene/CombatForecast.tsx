import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { PlayerView } from '@card-wars/protocol';
import { useGame } from '../../store';
import { NO_RAYCAST, worldOfSlot } from './layout';

export interface OpponentZoneResult {
  player: string;
  zone: number;
}

/** Mirror pairing helper mirroring domain/zones.ts without domain imports. */
export function mirrorZoneIndex(zone: number, zoneCount: number): number {
  return zoneCount - 1 - zone;
}

export function neighborOfView(
  view: PlayerView,
  playerId: string,
  direction: -1 | 1,
): string | null {
  const alive = view.order.filter((pid) => !view.players[pid]!.eliminated);
  const start = alive.indexOf(playerId);
  if (start < 0) return null;
  const selfTeam = view.players[playerId]?.teamId;
  for (let step = 1; step < alive.length; step++) {
    const index = (start + direction * step + alive.length * 2) % alive.length;
    const candidate = alive[index]!;
    if (candidate === playerId) continue;
    if (selfTeam && view.players[candidate]?.teamId === selfTeam) continue;
    return candidate;
  }
  return null;
}

export function opponentZoneForView(
  view: PlayerView,
  attackerId: string,
  zone: number,
): OpponentZoneResult | null {
  const attacker = view.players[attackerId];
  if (!attacker || attacker.eliminated) return null;
  const zoneCount = attacker.zones.length;
  const teamId = attacker.teamId;
  const team = teamId && view.teams ? view.teams[teamId] ?? null : null;

  if (view.mode === 'teams' && view.teamVariant === 'wall') {
    if (!team || !view.teams) return null;
    const enemyTeam = Object.values(view.teams).find((t) => t.id !== team.id && !t.eliminated);
    if (!enemyTeam) return null;
    const half = team.playerIds.indexOf(attackerId);
    if (half < 0) return null;
    const rowLength = zoneCount * team.playerIds.length;
    const global = half * zoneCount + zone;
    const mirrored = rowLength - 1 - global;
    const defenderId = enemyTeam.playerIds[Math.floor(mirrored / zoneCount)];
    if (!defenderId || view.players[defenderId]?.eliminated) return null;
    return { player: defenderId, zone: mirrored % zoneCount };
  }

  if (typeof zone !== 'number' || zone < 0 || zone >= zoneCount) return null;
  const leftHalf = zone < Math.floor(zoneCount / 2);
  const defenderId = neighborOfView(view, attackerId, leftHalf ? -1 : 1);
  if (!defenderId) return null;
  return { player: defenderId, zone: mirrorZoneIndex(zone, zoneCount) };
}

interface ForecastItem {
  key: string;
  startPos: [number, number, number];
  endPos: [number, number, number];
  damage: number;
  targetDies: boolean;
  attackerDies: boolean;
  retaliationDamage: number;
  isFace: boolean;
}

function createForecastBadgeTexture(text: string, lethal: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 96);
  ctx.beginPath();
  ctx.roundRect(6, 6, 244, 84, 18);
  ctx.fillStyle = lethal ? 'rgba(185, 28, 28, 0.94)' : 'rgba(30, 41, 59, 0.92)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = lethal ? '#fca5a5' : '#fb923c';
  ctx.stroke();

  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.strokeText(text, 128, 50, 230);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 128, 50, 230);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ForecastIndicator({ item }: { item: ForecastItem }) {
  const badgeTexture = useMemo(() => {
    const label = item.isFace
      ? item.targetDies
        ? `❤ -${item.damage} 💀`
        : `❤ -${item.damage}`
      : item.targetDies
        ? `-${item.damage} 💀`
        : `-${item.damage}`;
    return createForecastBadgeTexture(label, item.targetDies);
  }, [item.isFace, item.targetDies, item.damage]);

  const attackerBadgeTexture = useMemo(() => {
    if (!item.attackerDies) return null;
    return createForecastBadgeTexture(`-${item.retaliationDamage} 💀`, true);
  }, [item.attackerDies, item.retaliationDamage]);

  useEffect(() => {
    return () => {
      badgeTexture.dispose();
      attackerBadgeTexture?.dispose();
    };
  }, [badgeTexture, attackerBadgeTexture]);

  const { startPos, endPos } = item;
  const dx = endPos[0] - startPos[0];
  const dz = endPos[2] - startPos[2];
  const len = Math.max(10, Math.hypot(dx, dz));
  const angle = Math.atan2(dx, dz);
  const midX = (startPos[0] + endPos[0]) / 2;
  const midZ = (startPos[2] + endPos[2]) / 2;
  const color = item.targetDies ? '#ef4444' : '#f97316';
  const shaftLen = Math.max(10, len - 36);

  return (
    <group>
      {/* Стрела атаки между противоположными зонами (+Z в группе смотрит точно от startPos к endPos) */}
      <group position={[midX, 14, midZ]} rotation={[0, angle, 0]}>
        <mesh position={[0, 0, -6]} rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
          <planeGeometry args={[6, shaftLen]} />
          <meshBasicMaterial color={color} transparent opacity={0.88} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, len / 2 - 18]} rotation={[Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
          <coneGeometry args={[10, 22, 4]} />
          <meshBasicMaterial color={color} transparent opacity={0.92} />
        </mesh>
      </group>
      {/* Бейдж цели: рассчитанный урон и значок черепа при смерти */}
      <sprite position={[endPos[0], 28, endPos[2]]} scale={[125, 47, 1]} raycast={NO_RAYCAST}>
        <spriteMaterial map={badgeTexture} transparent />
      </sprite>
      {/* Бейдж атакующего, если тот погибает от одновременной контратаки */}
      {attackerBadgeTexture && (
        <sprite position={[startPos[0], 28, startPos[2]]} scale={[110, 42, 1]} raycast={NO_RAYCAST}>
          <spriteMaterial map={attackerBadgeTexture} transparent />
        </sprite>
      )}
    </group>
  );
}

export function CombatForecastLayer({ view }: { view: PlayerView }) {
  const forecastHover = useGame((s) => s.ui.combatForecastHover);
  const hoveredCreature = useGame((s) => s.ui.hoveredCreatureInstanceId);

  const items = useMemo<ForecastItem[]>(() => {
    if (!forecastHover && !hoveredCreature) return [];
    if (view.status !== 'running') return [];

    const activePid = view.me;
    const isMyTurn = view.activePlayers.includes(view.me) && view.phase === 'main';
    if (!isMyTurn) return [];

    const alive = view.order.filter((pid) => !view.players[pid]!.eliminated);
    const lastAlive = alive[alive.length - 1];
    const canAttack =
      view.mode === 'teams'
        ? view.round !== 1
        : !(view.round === 1 && view.activePlayer !== lastAlive);
    if (!canAttack) return [];

    const me = view.players[activePid];
    if (!me) return [];

    const list: ForecastItem[] = [];

    for (let z = 0; z < me.zones.length; z++) {
      const creature = me.zones[z]?.creature;
      if (!creature || creature.flipped) continue;
      if (hoveredCreature && creature.instanceId !== hoveredCreature) continue;

      const target = opponentZoneForView(view, activePid, z);
      if (!target) continue;

      const defPlayer = view.players[target.player];
      const defCreature = defPlayer?.zones[target.zone]?.creature ?? null;
      const startPos = worldOfSlot(view, activePid, z, 'creature');
      const endPos = worldOfSlot(view, target.player, target.zone, 'creature');
      if (!startPos || !endPos) continue;

      const damage = creature.effAttack;

      if (defCreature) {
        const effDmg = Math.max(0, damage - defCreature.shield);
        const targetDies = defCreature.damage + effDmg >= defCreature.effDefense;
        const retDmg = defCreature.effAttack;
        const effRetDmg = Math.max(0, retDmg - creature.shield);
        const attackerDies = creature.damage + effRetDmg >= creature.effDefense;

        list.push({
          key: `${creature.instanceId}->${defCreature.instanceId}`,
          startPos,
          endPos,
          damage,
          targetDies,
          attackerDies,
          retaliationDamage: retDmg,
          isFace: false,
        });
      } else {
        const team = defPlayer?.teamId ? view.teams?.[defPlayer.teamId] : null;
        const curLives = team ? team.lives : (defPlayer?.lives ?? 0);
        const targetDies = curLives - damage <= 0;

        list.push({
          key: `${creature.instanceId}->face-${target.player}`,
          startPos,
          endPos,
          damage,
          targetDies,
          attackerDies: false,
          retaliationDamage: 0,
          isFace: true,
        });
      }
    }

    return list;
  }, [forecastHover, hoveredCreature, view]);

  if (items.length === 0) return null;

  return (
    <group>
      {items.map((item) => (
        <ForecastIndicator key={item.key} item={item} />
      ))}
    </group>
  );
}
