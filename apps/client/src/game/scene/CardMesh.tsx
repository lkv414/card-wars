import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { CardView, PlayerView } from '@card-wars/protocol';
import { CARD_H, CARD_T, CARD_W, FROST_D, TOKEN_D, TOKEN_T, slotLocalZ } from './layout';
import { cardTexture, frostTexture, tokenTexture } from './textures';
import { sendCommand, setUi, useGame } from '../../store';

const HOLD_MS = 1500; // флюп — зажать карту на 1,5 секунды (docs/UI-3D.md «Взаимодействие»)

/** Карта на поле: бокс 63×89 с canvas-текстурой; флюп = поворот на бок. */
export function CardMesh({
  card,
  view,
  isMe,
  slot,
}: {
  card: CardView;
  view: PlayerView;
  isMe: boolean;
  slot: 'creature' | 'building' | 'companion';
}) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const texture = useMemo(() => cardTexture(card.cardId), [card.cardId]);
  const myMain =
    view.activePlayers.includes(view.me) &&
    !view.players[view.me]!.battleReady &&
    view.status === 'running' &&
    view.phase === 'main';
  const canHold = isMe && myMain && !card.flipped;
  const pendingPick = useGame((s) => s.ui.pendingPick);
  const pickable = pendingPick?.pick === 'creature';

  useFrame(() => {
    if (group.current) {
      const targetRot = card.flipped ? Math.PI / 2 : 0;
      group.current.rotation.y += (targetRot - group.current.rotation.y) * 0.18;
    }
    if (ring.current) {
      const holding = useGame.getState().ui.holdingFloop;
      const active = holding?.instanceId === card.instanceId;
      ring.current.visible = active;
      if (active) {
        const progress = Math.min(1, (performance.now() - holding!.startedAt) / HOLD_MS);
        const s = 0.4 + progress * 0.9;
        ring.current.scale.set(s, s, s);
        const material = ring.current.material as THREE.MeshBasicMaterial;
        material.opacity = 0.35 + progress * 0.6;
        if (progress >= 1) {
          setUi({ holdingFloop: null });
          sendCommand({ type: 'floop', player: view.me, instanceId: card.instanceId });
        }
      }
    }
  });

  const startHold = (event: ThreeEvent<PointerEvent>) => {
    if (!canHold) return;
    event.stopPropagation();
    setUi({ holdingFloop: { instanceId: card.instanceId, startedAt: performance.now() } });
  };
  const cancelHold = () => {
    const holding = useGame.getState().ui.holdingFloop;
    if (holding?.instanceId === card.instanceId) setUi({ holdingFloop: null });
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!pendingPick || slot === 'companion') return;
    event.stopPropagation();
    const choices = { ...((pendingPick.base.choices as object) ?? {}), creature: card.instanceId };
    sendCommand({ ...pendingPick.base, choices } as never);
    setUi({ pendingPick: null });
  };

  return (
    <group position={[0, CARD_T / 2 + 0.4, slotLocalZ(slot)]}>
      <group ref={group} onClick={handleClick} onPointerDown={startHold} onPointerUp={cancelHold} onPointerOut={cancelHold}>
        <mesh>
          <boxGeometry args={[CARD_W, CARD_T, CARD_H]} />
          <meshLambertMaterial map={texture} />
        </mesh>
        {pickable && (
          <mesh position={[0, 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[CARD_W + 12, CARD_H + 12]} />
            <meshBasicMaterial color="#7fd1ff" transparent opacity={0.3} />
          </mesh>
        )}
      </group>
      {canHold && (
        <mesh ref={ring} position={[0, 16, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[46, 54, 40]} />
          <meshBasicMaterial color="#48d9a0" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
      {card.damage > 0 && <DamageTokens damage={card.damage} />}
      {card.shield > 0 && <ShieldBadge shield={card.shield} />}
    </group>
  );
}

/** Кучка жетонов урона: жадно «тройками» + остаток «единицами» (docs/UI-3D.md). */
export function DamageTokens({ damage }: { damage: number }) {
  const tokens: Array<1 | 3> = [
    ...Array.from({ length: Math.floor(damage / 3) }, () => 3 as const),
    ...Array.from({ length: damage % 3 }, () => 1 as const),
  ];
  return (
    <group position={[CARD_W / 2 - 10, 0, -CARD_H / 2 + 14]}>
      {tokens.slice(0, 8).map((face, i) => (
        <TokenMesh key={i} face={face} y={2 + i * (TOKEN_T + 0.4)} />
      ))}
    </group>
  );
}

function TokenMesh({ face, y }: { face: 1 | 3; y: number }) {
  return (
    <mesh position={[0, y, 0]}>
      <cylinderGeometry args={[TOKEN_D / 2, TOKEN_D / 2, TOKEN_T, 24]} />
      <meshLambertMaterial map={tokenTexture(face)} />
    </mesh>
  );
}
export { TokenMesh };

/** Жетон мороза на земле. */
export function FrostToken() {
  return (
    <mesh position={[0, 6, 0]}>
      <cylinderGeometry args={[FROST_D / 2, FROST_D / 2, TOKEN_T, 24]} />
      <meshLambertMaterial map={frostTexture()} />
    </mesh>
  );
}

function ShieldBadge({ shield }: { shield: number }) {
  void shield;
  return (
    <mesh position={[-CARD_W / 2 + 8, 6, -CARD_H / 2 + 12]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[11, 24]} />
      <meshBasicMaterial color="#7fd1ff" transparent opacity={0.9} />
    </mesh>
  );
}
