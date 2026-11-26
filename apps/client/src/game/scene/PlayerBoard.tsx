import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  deckWorldTransform,
  discardWorldTransform,
  frostLocalZ,
  heroLocalFor,
  livesLocalFor,
  zoneWorldTransform,
} from './layout';
import { DECK_CARD_GEO, OPPONENT_CARD_GEO, OPPONENT_EDGE_MAT } from './sharedResources';
import { cardBackTexture, cardTexture, heroTexture } from './textures';
import { CardMesh, FrostToken, TokenMesh } from './CardMesh';
import { Land } from './Land';
import { pick, validTargets } from '../targeting';
import { sendCommand, sendTomato, setUi, showHint, useGame } from '../../store';

/** Игровое поле одного игрока: 4 земли (с их точными углами/позициями боя), колода, сброс, герой, жизни. */
export function PlayerBoard({ view, pid, isMe }: { view: PlayerView; pid: string; isMe: boolean }) {
  const p = view.players[pid]!;
  const transform = boardTransform(view, pid);
  const deckTr = deckWorldTransform(view, pid);
  const discardTr = discardWorldTransform(view, pid);
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

      {deckTr && (
        <group position={[deckTr.x, 4, deckTr.z]} rotation={[0, deckTr.rotation, 0]}>
          <DeckPile count={p.deckCount} view={view} isMe={isMe} />
        </group>
      )}

      {discardTr && (
        <group position={[discardTr.x, 4, discardTr.z]} rotation={[0, discardTr.rotation, 0]}>
          <DiscardPile view={view} pid={pid} />
        </group>
      )}

      <group position={[transform.x, 0, transform.z]} rotation={[0, transform.rotation, 0]}>
        <HeroStand
          nickname={p.nickname}
          heroId={p.heroId}
          active={active}
          ready={p.battleReady}
          teamLabel={team ? `команда ${team.id === 'team-a' ? 'A' : 'B'}` : null}
          view={view}
          pid={pid}
        />
        {(!team || team.playerIds[0] === pid) && <LivesTokens lives={p.lives} view={view} />}
        {!isMe && p.handCount > 0 && <OpponentHand count={p.handCount} view={view} />}
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
}: {
  count: number;
  view: PlayerView;
  isMe: boolean;
}) {
  const back = useMemo(() => cardBackTexture(), []);
  const deckMat = useMemo(() => new THREE.MeshLambertMaterial({ map: back }), [back]);
  const layers = Math.min(8, Math.ceil(count / 5));
  const [hovered, setHovered] = useState(false);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    return () => {
      deckMat.dispose();
    };
  }, [deckMat]);

  const me = view.players[view.me]!;
  const myTurn = view.activePlayers.includes(view.me) && view.status === 'running';
  const myMain = myTurn && view.phase === 'main' && !me.battleReady;
  const canDrawExtra = isMe && myMain && me.actions >= CONFIG.extraDrawCost && count > 0;

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || layers === 0) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < layers; i++) {
      const isTop = i === layers - 1;
      const liftY = isTop && isMe && hovered && canDrawExtra ? 5 : 0;
      dummy.position.set(0, i * 1.4 + liftY, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [layers, isMe, hovered, canDrawExtra]);

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
    <group>
      {/* Мягкое золотистое свечение под колодой, если доступен добор за действие */}
      {isMe && canDrawExtra && (
        <mesh position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
          <planeGeometry args={[CARD_W + 24, CARD_H + 24]} />
          <meshBasicMaterial color="#ffe9a8" transparent opacity={hovered ? 0.65 : 0.28} />
        </mesh>
      )}

      {layers > 0 && (
        <instancedMesh
          key={layers}
          ref={meshRef}
          args={[DECK_CARD_GEO, deckMat, layers]}
          onClick={isMe ? handleClick : undefined}
          onPointerOver={isMe ? (e) => { e.stopPropagation(); setHovered(true); } : undefined}
          onPointerOut={isMe ? (e) => { e.stopPropagation(); setHovered(false); } : undefined}
        />
      )}

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
  const top = p.discard[p.discard.length - 1];
  const texture = useMemo(() => (top ? cardTexture(top.cardId) : cardBackTexture()), [top?.cardId]);
  const isMe = pid === view.me;
  const active = isMe && useGame((s) => s.ui.dragging) !== null;
  const overDiscard = useGame((s) => s.ui.draggingOverDiscard);
  return (
    <group>
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
  pid,
}: {
  nickname: string;
  heroId: string;
  active: boolean;
  ready: boolean;
  teamLabel: string | null;
  view: PlayerView;
  pid: string;
}) {
  const [x, , z] = heroLocalFor(view);
  const color = ready ? '#4c8ee8' : active ? '#48bb78' : '#3a4250';
  const suffix = `${ready ? ' · готов' : active ? ' · ход' : ''}${teamLabel ? ` · ${teamLabel}` : ''}`;
  const portrait = useMemo(() => heroTexture(heroId), [heroId]);

  const targeting = useGame((st) => st.ui.targeting);
  const tomatoMode = useGame((st) => st.ui.tomatoMode);
  const isTomatoTarget = tomatoMode && pid !== view.me;
  const currentAsk = targeting ? targeting.asks[targeting.askIndex] : undefined;
  const isTarget =
    targeting && currentAsk && (currentAsk.kind === 'opponent_player' || currentAsk.kind === 'any_player')
      ? validTargets(view, currentAsk, targeting.sourceInstanceId, targeting.collected).some(
          (c) => c.kind === 'player' && c.playerId === pid,
        )
      : false;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.nativeEvent.button !== 0) return;
    if (isTomatoTarget) {
      e.stopPropagation();
      sendTomato(pid);
      return;
    }
    if (!isTarget) return;
    e.stopPropagation();
    const ui = useGame.getState().ui;
    if (!ui.targeting) return;
    const result = pick(view, ui.targeting, { kind: 'player', playerId: pid });
    if (!result.accepted) return;
    if (result.command) {
      sendCommand(result.command);
      setUi({ targeting: result.nextState ?? null });
    } else if (result.nextState) {
      setUi({ targeting: result.nextState });
    }
  };

  return (
    <group position={[x, 0, z]}>
      {/* Подставка */}
      <mesh position={[0, 14, 0]} raycast={isTarget ? undefined : NO_RAYCAST} onClick={isTarget ? handleClick : undefined}>
        <boxGeometry args={[110, 28, 10]} />
        <meshLambertMaterial color={isTarget ? '#dc2626' : color} />
      </mesh>
      {/* Кольцо подсветки цели при наведении/выборе */}
      {isTarget && (
        <mesh position={[0, 56, 7]} onClick={handleClick}>
          <ringGeometry args={[44, 50, 32]} />
          <meshBasicMaterial color="#ef4444" side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* портрет героя — скан из content/heroes/images (docs/UI-3D.md «Состав сцена») */}
      <mesh position={[0, 56, 6]} raycast={isTarget ? undefined : NO_RAYCAST} onClick={isTarget ? handleClick : undefined}>
        <planeGeometry args={[64, 80]} />
        <meshLambertMaterial map={portrait} />
      </mesh>
      <FloatingLabel text={`${heroNameOf(heroId)} · ${nickname}${suffix}`} position={[0, 34, 0]} />
    </group>
  );
}

/** Рука соперника в 3D: рубашка с обеих сторон, чтобы содержимое было полностью скрыто. */
function OpponentHand({ count, view }: { count: number; view: PlayerView }) {
  const back = useMemo(() => cardBackTexture(), []);
  const backMat = useMemo(() => new THREE.MeshLambertMaterial({ map: back }), [back]);
  const materials = useMemo(
    () => [OPPONENT_EDGE_MAT, OPPONENT_EDGE_MAT, backMat, backMat, OPPONENT_EDGE_MAT, OPPONENT_EDGE_MAT],
    [backMat],
  );
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    return () => {
      backMat.dispose();
    };
  }, [backMat]);

  const [, , hz] = heroLocalFor(view);
  const shown = Math.min(10, count);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || shown <= 0) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < shown; i++) {
      const offset = i - (shown - 1) / 2;
      const x = offset * 28;
      const z = Math.abs(offset) * 3;
      const fanAngle = offset * 0.08;
      dummy.position.set(x, i * 0.6, z);
      dummy.rotation.set(-1.05, 0, -fanAngle);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [shown]);

  return (
    <group position={[0, 48, hz + 56]} raycast={NO_RAYCAST}>
      {shown > 0 && (
        <instancedMesh
          key={shown}
          ref={meshRef}
          args={[OPPONENT_CARD_GEO, materials, shown]}
          raycast={NO_RAYCAST}
        />
      )}
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
