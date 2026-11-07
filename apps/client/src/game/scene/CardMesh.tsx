import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { CardView, PlayerView } from '@card-wars/protocol';
import { CARD_H, CARD_T, CARD_W, FROST_D, TOKEN_D, TOKEN_T, slotLocalZ } from './layout';
import { cardTexture, frostTexture, tokenTexture } from './textures';
import { sendCommand, setUi, useGame } from '../../store';
import { activeAbilityOf, pick, startForActive, validTargets } from '../targeting';
import { DamagePile } from './DamagePile';

const HOLD_MS = 1000; // флюп — зажать карту на 1 с (docs/UI-3D.md «Взаимодействие»)
const DRAG_THRESHOLD_PX = 10; // движение больше порога превращает зажатие в драг
const DRAG_LIFT_Y = 34; // высота подъёма карты при перетаскивании

/** Карта на поле: бокс 63×89 со сканом; флюп = поворот на 90° против часовой. */
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
  const holder = useRef<THREE.Group>(null); // позиция: базовый слот или следование за драгом
  const group = useRef<THREE.Group>(null); // поворот флюпа
  const ring = useRef<THREE.Mesh>(null);
  const baseTarget = useMemo(() => new THREE.Vector3(), []);
  const texture = useMemo(() => cardTexture(card.cardId), [card.cardId]);
  const basePosition = useMemo<[number, number, number]>(
    () => [0, CARD_T / 2 + 0.4, slotLocalZ(slot)],
    [slot],
  );
  const myMain =
    view.activePlayers.includes(view.me) &&
    !view.players[view.me]!.battleReady &&
    view.status === 'running' &&
    view.phase === 'main';
  const hasAbility = activeAbilityOf(card.cardId) !== null;
  const canDrag = isMe && myMain; // драг с поля: сброс перетягиванием в стопку
  const canHold = canDrag && hasAbility && !card.flipped;
  const slotZ = slotLocalZ(slot);

  // Зажатие → драг: движение указателя сверх порога отменяет флюп и начинает драг.
  useEffect(() => {
    if (!canDrag) return;
    const onMove = (e: PointerEvent) => {
      const ui = useGame.getState().ui;
      const holding = ui.holdingFloop;
      if (holding?.instanceId !== card.instanceId) return;
      if (Math.hypot(e.clientX - holding.startX, e.clientY - holding.startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      setUi({
        holdingFloop: null,
        dragging: card.instanceId,
        draggingFrom: 'field',
        draggingOverZone: null,
        draggingOverDiscard: false,
        dragPoint: null,
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [canDrag, card.instanceId]);

  useFrame(() => {
    // Флюп: поворот против часовой (со стороны владельца) служит меткой состояния.
    if (group.current) {
      const targetRot = card.flipped ? Math.PI / 2 : 0;
      group.current.rotation.y += (targetRot - group.current.rotation.y) * 0.18;
    }
    const ui = useGame.getState();
    // Драг с поля: карта поднимается и следует за указателем (мировые → локальные).
    // В покое — просто базовый слот: worldToLocal применяется только к мировой
    // точке драга, локальную позицию слота искажать нельзя.
    if (holder.current) {
      const draggingMe =
        ui.ui.dragging === card.instanceId && ui.ui.draggingFrom === 'field' && ui.ui.dragPoint;
      if (draggingMe) {
        const target = new THREE.Vector3(ui.ui.dragPoint!.x, DRAG_LIFT_Y, ui.ui.dragPoint!.z);
        holder.current.parent!.worldToLocal(target);
        holder.current.position.lerp(target, 0.3);
      } else {
        holder.current.position.lerp(baseTarget.set(basePosition[0], basePosition[1], basePosition[2]), 0.3);
      }
    }
    // Кольцо прогресса зажатия; на полном круге — флюп (или таргетинг его целей).
    const holding = ui.ui.holdingFloop;
    const active = holding?.instanceId === card.instanceId;
    if (ring.current) {
      ring.current.visible = active;
      if (active) {
        const progress = Math.min(1, (performance.now() - holding!.startedAt) / HOLD_MS);
        const s = 0.4 + progress * 0.9;
        ring.current.scale.set(s, s, s);
        const material = ring.current.material as THREE.MeshBasicMaterial;
        material.opacity = 0.35 + progress * 0.6;
        if (progress >= 1) {
          setUi({ holdingFloop: null });
          const ability = activeAbilityOf(card.cardId);
          if (ability && (ability.targets?.length ?? 0) > 0) {
            const state = startForActive(view, 'floop', card.instanceId, card.cardId);
            if (state) {
              setUi({ targeting: state });
              return;
            }
          }
          sendCommand({ type: 'floop', player: view.me, instanceId: card.instanceId });
        }
      }
    }
  });

  // Режим выбора целей: клик по валидному существу отдаёт его таргетингу.
  const targeting = useGame((st) => st.ui.targeting);
  const currentAsk = targeting ? targeting.asks[targeting.askIndex] : undefined;
  const isTarget = targeting && currentAsk && currentAsk.kind.includes('creature')
    ? validTargets(view, currentAsk, targeting.sourceInstanceId, targeting.collected)
      .some((c) => c.kind === 'creature' && c.instanceId === card.instanceId)
    : false;

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!targeting || !isTarget) return;
    event.stopPropagation();
    const ui = useGame.getState().ui;
    const result = pick(view, ui.targeting!, { kind: 'creature', instanceId: card.instanceId });
    if (!result.accepted) return;
    if (result.command) {
      sendCommand(result.command);
      setUi({ targeting: result.nextState ?? null });
    } else if (result.nextState) {
      setUi({ targeting: result.nextState });
    }
  };

  const startHold = (event: ThreeEvent<PointerEvent>) => {
    if (!canDrag || useGame.getState().ui.targeting) return;
    event.stopPropagation();
    setUi({
      holdingFloop: {
        instanceId: card.instanceId,
        startedAt: performance.now(),
        startX: event.clientX,
        startY: event.clientY,
      },
      selectedHand: null,
    });
  };
  const cancelHold = () => {
    const holding = useGame.getState().ui.holdingFloop;
    if (holding?.instanceId === card.instanceId) setUi({ holdingFloop: null });
  };

  return (
    <group ref={holder} position={basePosition}>
      <group ref={group} onClick={handleClick} onPointerDown={startHold} onPointerUp={cancelHold} onPointerOut={cancelHold}>
        <mesh>
          <boxGeometry args={[CARD_W, CARD_T, CARD_H]} />
          <meshLambertMaterial map={texture} />
        </mesh>
      </group>
      {canHold && (
        <mesh ref={ring} position={[0, 16, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[46, 54, 40]} />
          <meshBasicMaterial color="#48d9a0" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
      {isTarget && (
        <mesh position={[0, 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[CARD_W + 12, CARD_H + 12]} />
          <meshBasicMaterial color="#7fd1ff" transparent opacity={0.3} />
        </mesh>
      )}
      {card.damage > 0 && <DamagePile instanceId={card.instanceId} damage={card.damage} slotZ={slotZ} />}
      {card.shield > 0 && <ShieldBadge shield={card.shield} />}
    </group>
  );
}

/** Жетон «1»/«3» (используется также для жизней героя). */
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
