import { useMemo } from 'react';
import * as THREE from 'three';
import type { PlayerView } from '@card-wars/protocol';
import { heroNameOf } from '../hud/names';
import {
  CARD_T,
  CARD_W,
  CARD_H,
  boardTransform,
  deckLocal,
  discardLocal,
  heroLocal,
  livesLocal,
  zoneX,
} from './layout';
import { cardBackTexture, cardTexture } from './textures';
import { CardMesh, FrostToken, TokenMesh } from './CardMesh';
import { Land } from './Land';

/** Половина стола одного игрока: ряд земель, колода/сброс, герой, жизни, парная. */
export function PlayerBoard({ view, pid, isMe }: { view: PlayerView; pid: string; isMe: boolean }) {
  const p = view.players[pid]!;
  const transform = boardTransform(view, pid);
  const active = view.activePlayers.includes(pid) && view.status === 'running';

  if (!transform) return null;

  const team = p.teamId ? view.teams?.[p.teamId] ?? null : null;

  return (
    <group position={[transform.x, 0, transform.z]} rotation={[0, transform.rotation, 0]}>
      {p.zones.map((zone, i) => (
        <group key={i} position={[zoneX(i), 0, 0]}>
          <Land land={p.lands[i]!} zone={i} isMe={isMe} />
          {p.lands[i]!.frozen && (
            <group position={[0, 0, -34]}>
              <FrostToken />
            </group>
          )}
          {zone.creature && <CardMesh card={zone.creature} view={view} isMe={isMe} slot="creature" />}
          {zone.building && <CardMesh card={zone.building} view={view} isMe={isMe} slot="building" />}
        </group>
      ))}
      <DeckPile count={p.deckCount} />
      <DiscardPile view={view} pid={pid} />
      <HeroStand
        nickname={p.nickname}
        heroId={p.heroId}
        active={active}
        ready={p.battleReady}
        teamLabel={team ? `команда ${team.id === 'team-a' ? 'A' : 'B'}` : null}
      />
      {(!team || team.playerIds[0] === pid) && <LivesTokens lives={p.lives} />}
      {p.companion && <CardMesh card={p.companion} view={view} isMe={isMe} slot="companion" />}
      {/* заклинания текущего хода — парят над землями этого игрока (docs/UI-3D.md) */}
      {view.castSpells
        .filter((spell) => spell.player === pid)
        .map((spell, i) => (
          <SpellGhost key={spell.instanceId} cardId={spell.cardId} index={i} />
        ))}
    </group>
  );
}

function DeckPile({ count }: { count: number }) {
  const back = useMemo(() => cardBackTexture(), []);
  const [x, y, z] = deckLocal;
  const layers = Math.min(8, Math.ceil(count / 5));
  return (
    <group position={[x, y, z]}>
      {Array.from({ length: layers }, (_, i) => (
        <mesh key={i} position={[0, i * 1.4, 0]}>
          <boxGeometry args={[CARD_W, 1, CARD_H]} />
          <meshLambertMaterial map={back} />
        </mesh>
      ))}
      <FloatingLabel text={`Колода: ${count}`} position={[0, layers * 1.4 + 12, 0]} />
    </group>
  );
}

function DiscardPile({ view, pid }: { view: PlayerView; pid: string }) {
  const p = view.players[pid]!;
  const [x, y, z] = discardLocal;
  const top = p.discard[p.discard.length - 1];
  const texture = useMemo(() => (top ? cardTexture(top.cardId) : cardBackTexture()), [top?.cardId]);
  return (
    <group position={[x, y, z]}>
      {top && (
        <mesh position={[0, 1, 0]}>
          <boxGeometry args={[CARD_W, CARD_T, CARD_H]} />
          <meshLambertMaterial map={texture} />
        </mesh>
      )}
      <FloatingLabel text={`Сброс: ${p.discard.length}`} position={[0, 16, 0]} />
    </group>
  );
}

function HeroStand({
  nickname,
  heroId,
  active,
  ready,
  teamLabel,
}: {
  nickname: string;
  heroId: string;
  active: boolean;
  ready: boolean;
  teamLabel: string | null;
}) {
  const [x, , z] = heroLocal;
  const color = ready ? '#4c8ee8' : active ? '#48bb78' : '#3a4250';
  const suffix = `${ready ? ' · готов' : active ? ' · ход' : ''}${teamLabel ? ` · ${teamLabel}` : ''}`;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 14, 0]}>
        <boxGeometry args={[110, 28, 10]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <FloatingLabel text={`${heroNameOf(heroId)} · ${nickname}${suffix}`} position={[0, 34, 0]} />
    </group>
  );
}

/** Жизни — жетонами «3»/«1» у героя (числовой дубликат — в HUD). */
function LivesTokens({ lives }: { lives: number }) {
  const threes = Math.floor(Math.max(0, lives) / 3);
  const ones = Math.max(0, lives) % 3;
  const [x, y, z] = livesLocal;
  const tokens: Array<1 | 3> = [
    ...Array.from({ length: threes }, () => 3 as const),
    ...Array.from({ length: ones }, () => 1 as const),
  ];
  return (
    <group position={[x, y, z]}>
      {tokens.slice(0, 20).map((face, i) => (
        <TokenMesh key={i} face={face} y={2 + i * 3.6} />
      ))}
    </group>
  );
}

function SpellGhost({ cardId, index }: { cardId: string; index: number }) {
  const texture = useMemo(() => cardTexture(cardId), [cardId]);
  const column = index % 5;
  const row = Math.floor(index / 5);
  const x = (column - 2) * 76;
  const z = row * 22;
  return (
    <mesh position={[x, 80 + row * 8, z]} rotation={[-Math.PI / 2.6, 0, 0]}>
      <planeGeometry args={[CARD_W, CARD_H]} />
      <meshBasicMaterial map={texture} transparent opacity={0.55} />
    </mesh>
  );
}

/** Плоская текстовая плашка (canvas-спрайт) — без внешних шрифтов. */
export function FloatingLabel({ text, position }: { text: string; position: [number, number, number] }) {
  const texture = useMemo(() => labelTexture(text), [text]);
  return (
    <sprite position={position} scale={[120, 34, 1]}>
      <spriteMaterial map={texture} transparent />
    </sprite>
  );
}

const labelCache = new Map<string, THREE.CanvasTexture>();
function labelTexture(text: string): THREE.CanvasTexture {
  const cached = labelCache.get(text);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(16,20,28,0.75)';
  ctx.beginPath();
  ctx.roundRect(2, 2, 252, 68, 14);
  ctx.fill();
  ctx.fillStyle = '#e8edf4';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.length > 22 ? `${text.slice(0, 21)}…` : text, 128, 38, 240);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(text, texture);
  return texture;
}
