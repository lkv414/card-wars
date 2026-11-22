import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { CONFIG, type PlayerView } from '@card-wars/protocol';
import { heroNameOf } from '../hud/names';
import {
  CARD_T,
  CARD_W,
  CARD_H,
  NO_RAYCAST,
  boardTransform,
  deckLocalFor,
  discardLocalFor,
  frostLocalZ,
  heroLocalFor,
  livesLocalFor,
  zoneWorldTransform,
} from './layout';
import { cardBackTexture, cardTexture, heroTexture } from './textures';
import { CardMesh, FrostToken, TokenMesh } from './CardMesh';
import { Land } from './Land';
import { sendCommand, setUi, showHint, useGame } from '../../store';

/** Игровое поле одного игрока: 4 земли (с их точными углами/позициями боя), колода, сброс, герой, жизни. */
export function PlayerBoard({ view, pid, isMe }: { view: PlayerView; pid: string; isMe: boolean }) {
  const p = view.players[pid]!;
  const transform = boardTransform(view, pid);
  const active = view.activePlayers.includes(pid) && view.status === 'running';

  if (!transform) return null;

  const team = p.teamId ? view.teams?.[p.teamId] ?? null : null;

  return (
    <>
      {p.zones.map((zone, i) => {
        const lt = zoneWorldTransform(view, pid, i);
        if (!lt) return null;
        return (
          <group key={i} position={[lt.x, 0, lt.z]} rotation={[0, lt.rotation, 0]}>
            <Land land={p.lands[i]!} zone={i} isMe={isMe} pid={pid} view={view} />
            {p.lands[i]!.frozen && (
              <group position={[0, 0, frostLocalZ]}>
                <FrostToken />
              </group>
            )}
            {zone.creature && <CardMesh card={zone.creature} view={view} isMe={isMe} slot="creature" />}
            {zone.building && <CardMesh card={zone.building} view={view} isMe={isMe} slot="building" />}
          </group>
        );
      })}

      <group position={[transform.x, 0, transform.z]} rotation={[0, transform.rotation, 0]}>
        <DeckPile count={p.deckCount} view={view} isMe={isMe} pid={pid} />
        <DiscardPile view={view} pid={pid} />
        <HeroStand
          nickname={p.nickname}
          heroId={p.heroId}
          active={active}
          ready={p.battleReady}
          teamLabel={team ? `команда ${team.id === 'team-a' ? 'A' : 'B'}` : null}
          view={view}
        />
        {(!team || team.playerIds[0] === pid) && <LivesTokens lives={p.lives} view={view} />}
        {p.companion && <CardMesh card={p.companion} view={view} isMe={isMe} slot="companion" />}
        {/* заклинания текущего хода — парят над землями этого игрока (docs/UI-3D.md) */}
        {view.castSpells
          .filter((spell) => spell.player === pid)
          .map((spell, i) => (
            <SpellGhost key={spell.instanceId} cardId={spell.cardId} index={i} />
          ))}
      </group>
    </>
  );
}

function DeckPile({
  count,
  view,
  isMe,
  pid,
}: {
  count: number;
  view: PlayerView;
  isMe: boolean;
  pid: string;
}) {
  const back = useMemo(() => cardBackTexture(), []);
  const [x, y, z] = deckLocalFor(view);
  const layers = Math.min(8, Math.ceil(count / 5));
  const [hovered, setHovered] = useState(false);

  const me = view.players[view.me]!;
  const myTurn = view.activePlayers.includes(view.me) && view.status === 'running';
  const myMain = myTurn && view.phase === 'main' && !me.battleReady;
  const canDrawExtra = isMe && myMain && me.actions >= CONFIG.extraDrawCost && count > 0;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!isMe) return;
    if (count <= 0) {
      showHint('Колода пуста');
      return;
    }
    if (!myTurn) {
      showHint('Сейчас не ваш ход');
      return;
    }
    if (me.battleReady) {
      showHint('Вы уже готовы к бою');
      return;
    }
    if (view.phase !== 'main') {
      showHint('Добор доступен только в основную фазу');
      return;
    }
    if (me.actions < CONFIG.extraDrawCost) {
      showHint(`Не хватает действий для добора (нужно ${CONFIG.extraDrawCost} д.)`);
      return;
    }
    sendCommand({ type: 'draw_extra', player: view.me });
  };

  return (
    <group position={[x, y, z]}>
      {/* Мягкое золотистое свечение под колодой, если доступен добор за действие */}
      {isMe && canDrawExtra && (
        <mesh position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
          <planeGeometry args={[CARD_W + 24, CARD_H + 24]} />
          <meshBasicMaterial color="#ffe9a8" transparent opacity={hovered ? 0.65 : 0.28} />
        </mesh>
      )}

      {Array.from({ length: layers }, (_, i) => {
        const isTop = i === layers - 1;
        const liftY = isTop && isMe && hovered && canDrawExtra ? 5 : 0;
        return (
          <mesh
            key={i}
            position={[0, i * 1.4 + liftY, 0]}
            onClick={isMe ? handleClick : undefined}
            onPointerOver={isMe ? (e) => { e.stopPropagation(); setHovered(true); } : undefined}
            onPointerOut={isMe ? (e) => { e.stopPropagation(); setHovered(false); } : undefined}
          >
            <boxGeometry args={[CARD_W, 1, CARD_H]} />
            <meshLambertMaterial map={back} />
          </mesh>
        );
      })}

      <FloatingLabel
        text={
          isMe && canDrawExtra
            ? `Колода: ${count} • Добор (−${CONFIG.extraDrawCost} д.)`
            : `Колода: ${count}`
        }
        position={[0, layers * 1.4 + 14, 0]}
      />
    </group>
  );
}

/** Стопка сброса — цель перетаскивания (рука и поле); подсвечивается при драге (docs/UI-3D.md «Взаимодействие»). */
function DiscardPile({ view, pid }: { view: PlayerView; pid: string }) {
  const p = view.players[pid]!;
  const [x, y, z] = discardLocalFor(view);
  const top = p.discard[p.discard.length - 1];
  const texture = useMemo(() => (top ? cardTexture(top.cardId) : cardBackTexture()), [top?.cardId]);
  const isMe = pid === view.me;
  const active = isMe && useGame((s) => s.ui.dragging) !== null;
  const overDiscard = useGame((s) => s.ui.draggingOverDiscard);
  return (
    <group position={[x, y, z]}>
      {top && (
        <mesh
          position={[0, 1, 0]}
          onClick={(e) => {
            e.stopPropagation();
            setUi({ zoomedCard: { cardId: top.cardId, instanceId: top.instanceId } });
          }}
          onContextMenu={(e) => {
            e.stopPropagation();
            e.nativeEvent.preventDefault();
            setUi({ zoomedCard: { cardId: top.cardId, instanceId: top.instanceId } });
          }}
        >
          <boxGeometry args={[CARD_W, CARD_T, CARD_H]} />
          <meshLambertMaterial map={texture} />
        </mesh>
      )}
      {active && (
        <mesh position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
          <planeGeometry args={[CARD_W + 30, CARD_H + 30]} />
          <meshBasicMaterial
            color={overDiscard ? '#48d9a0' : '#48bb78'}
            transparent
            opacity={overDiscard ? 0.5 : 0.22}
          />
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
  view,
}: {
  nickname: string;
  heroId: string;
  active: boolean;
  ready: boolean;
  teamLabel: string | null;
  view: PlayerView;
}) {
  const [x, , z] = heroLocalFor(view);
  const color = ready ? '#4c8ee8' : active ? '#48bb78' : '#3a4250';
  const suffix = `${ready ? ' · готов' : active ? ' · ход' : ''}${teamLabel ? ` · ${teamLabel}` : ''}`;
  const portrait = useMemo(() => heroTexture(heroId), [heroId]);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 14, 0]} raycast={NO_RAYCAST}>
        <boxGeometry args={[110, 28, 10]} />
        <meshLambertMaterial color={color} />
      </mesh>
      {/* портрет героя — скан из content/heroes/images (docs/UI-3D.md «Состав сцена») */}
      <mesh position={[0, 56, 6]} raycast={NO_RAYCAST}>
        <planeGeometry args={[64, 80]} />
        <meshLambertMaterial map={portrait} />
      </mesh>
      <FloatingLabel text={`${heroNameOf(heroId)} · ${nickname}${suffix}`} position={[0, 34, 0]} />
    </group>
  );
}

/** Жизни — жетонами «3»/«1» у героя (числовой дубликат — в HUD). */
function LivesTokens({ lives, view }: { lives: number; view: PlayerView }) {
  const threes = Math.floor(Math.max(0, lives) / 3);
  const ones = Math.max(0, lives) % 3;
  const [x, y, z] = livesLocalFor(view);
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
    <mesh
      position={[x, 80 + row * 8, z]}
      rotation={[-Math.PI / 2.6, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        setUi({ zoomedCard: { cardId } });
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        e.nativeEvent.preventDefault();
        setUi({ zoomedCard: { cardId } });
      }}
    >
      <planeGeometry args={[CARD_W, CARD_H]} />
      <meshBasicMaterial map={texture} transparent opacity={0.65} />
    </mesh>
  );
}

/** Плоская текстовая плашка (canvas-спрайт) с персональным холстом и освобождением VRAM при размонтировании. */
export function FloatingLabel({ text, position }: { text: string; position: [number, number, number] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 72;
    canvasRef.current = canvas;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    textureRef.current = tex;
    return tex;
  }, []);

  useEffect(() => {
    return () => {
      textureRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 256, 72);
    ctx.fillStyle = 'rgba(16,20,28,0.75)';
    ctx.beginPath();
    ctx.roundRect(2, 2, 252, 68, 14);
    ctx.fill();
    ctx.fillStyle = '#e8edf4';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.length > 22 ? `${text.slice(0, 21)}…` : text, 128, 38, 240);
    texture.needsUpdate = true;
  }, [text, texture]);

  return (
    <sprite position={position} scale={[120, 34, 1]} raycast={NO_RAYCAST}>
      <spriteMaterial map={texture} transparent />
    </sprite>
  );
}
