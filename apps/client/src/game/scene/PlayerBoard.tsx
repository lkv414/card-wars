import { useMemo } from 'react';
import * as THREE from 'three';
import type { PlayerView } from '@card-wars/protocol';
import { heroNameOf } from '../hud/names';
import { CARD_T, CARD_W, CARD_H, deckPos, discardPos, heroPos, livesTokenPos, rowZ, zoneX } from './layout';
import { cardBackTexture, cardTexture } from './textures';
import { CardMesh, FrostToken, TokenMesh } from './CardMesh';
import { Land } from './Land';
import { sendCommand, setUi, useGame } from '../../store';

/** Половина стола одного игрока: ряд земель, колода/сброс, герой, жизни. */
export function PlayerBoard({ view, pid, isMe }: { view: PlayerView; pid: string; isMe: boolean }) {
  const p = view.players[pid]!;
  const z = rowZ(isMe);
  const pendingPick = useGame((s) => s.ui.pendingPick);
  const pendingLandscape = pendingPick?.pick === 'landscape';

  const pickLandscape = (zone: number) => {
    if (!pendingPick || !pendingLandscape) return;
    const choices = { ...((pendingPick.base.choices as object) ?? {}), landscape: { player: pid, zone } };
    sendCommand({ ...pendingPick.base, choices } as never);
    setUi({ pendingPick: null });
  };

  return (
    <group position={[0, 0, z]}>
      {p.zones.map((zone, i) => (
        <group key={i} position={[zoneX(i), 0, 0]}>
          <Land
            land={p.lands[i]!}
            zone={i}
            isMe={isMe}
            pickable={pendingLandscape}
            onPick={pickLandscape}
          />
          {p.lands[i]!.frozen && (
            <group position={[0, 0, -34]}>
              <FrostToken />
            </group>
          )}
          {zone.creature && <CardMesh card={zone.creature} view={view} isMe={isMe} slot="creature" />}
          {zone.building && <CardMesh card={zone.building} view={view} isMe={isMe} slot="building" />}
        </group>
      ))}
      <DeckPile count={p.deckCount} isMe={isMe} />
      <DiscardPile view={view} pid={pid} isMe={isMe} />
      <HeroStand view={view} pid={pid} isMe={isMe} />
      <LivesTokens lives={p.lives} isMe={isMe} />
      {/* заклинания текущего хода — парят над землями (docs/UI-3D.md) */}
      {view.castSpells.map((spell, i) => (
        <SpellGhost key={spell.instanceId} cardId={spell.cardId} index={i} isMe={isMe} />
      ))}
    </group>
  );
}

function DeckPile({ count, isMe }: { count: number; isMe: boolean }) {
  const back = useMemo(() => cardBackTexture(), []);
  const [x, y, z] = deckPos(isMe);
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

function DiscardPile({ view, pid, isMe }: { view: PlayerView; pid: string; isMe: boolean }) {
  const p = view.players[pid]!;
  const [x, y, z] = discardPos(isMe);
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

function HeroStand({ view, pid, isMe }: { view: PlayerView; pid: string; isMe: boolean }) {
  const p = view.players[pid]!;
  const [x, , z] = heroPos(isMe);
  const active = view.activePlayer === pid && view.status === 'running';
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 14, 0]}>
        <boxGeometry args={[110, 28, 10]} />
        <meshLambertMaterial color={active ? '#48bb78' : '#3a4250'} />
      </mesh>
      <FloatingLabel text={`${heroNameOf(p.heroId)} · ${p.nickname}`} position={[0, 34, 0]} />
    </group>
  );
}

/** Жизни — жетонами «3»/«1» у героя (числовой дубликат — в HUD). */
function LivesTokens({ lives, isMe }: { lives: number; isMe: boolean }) {
  const threes = Math.floor(lives / 3);
  const ones = lives % 3;
  const [x, y, z] = livesTokenPos(isMe);
  const tokens: Array<1 | 3> = [
    ...Array.from({ length: threes }, () => 3 as const),
    ...Array.from({ length: ones }, () => 1 as const),
  ];
  return (
    <group position={[x, y, z]}>
      {tokens.map((face, i) => (
        <TokenMesh key={i} face={face} y={2 + i * 3.6} />
      ))}
    </group>
  );
}

function SpellGhost({ cardId, index, isMe }: { cardId: string; index: number; isMe: boolean }) {
  const texture = useMemo(() => cardTexture(cardId), [cardId]);
  const x = -150 + index * 76;
  const z = isMe ? 150 : -150;
  return (
    <mesh position={[x, 80 + (isMe ? 0 : 6), z]} rotation={[-Math.PI / 2.6, 0, isMe ? 0 : Math.PI]}>
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
  ctx.fillText(text.length > 16 ? `${text.slice(0, 15)}…` : text, 128, 38, 240);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(text, texture);
  return texture;
}
