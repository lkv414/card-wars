import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerView } from '@card-wars/protocol';
import { cards as catalog } from '@card-wars/content';
import { CARD_H, CARD_T, CARD_W, HAND, myBoardTransform, overMyDiscardRay, zoneFromWorld } from './layout';
import { cardBackTexture, cardTexture } from './textures';
import { sendCommand, setUi, useGame } from '../../store';
import { pick } from '../targeting';

const DRAG_THRESHOLD_PX = 10;

/**
 * Рука — 3D-веер внизу экрана (docs/UI-3D.md «Рука (решено: 3D)»).
 * Перетаскивание: карта следует за указателем; зона — сыграть,
 * стопка сброса (или правый нижний угол) — сбросить.
 */
export function Hand({ view }: { view: PlayerView }) {
  const me = view.players[view.me]!;
  const myMain =
    view.activePlayers.includes(view.me) &&
    !me.battleReady &&
    view.status === 'running' &&
    view.phase === 'main';
  const selected = useGame((s) => s.ui.selectedHand);
  const dragging = useGame((s) => s.ui.dragging);
  const draggingFrom = useGame((s) => s.ui.draggingFrom);
  const group = useRef<THREE.Group>(null);
  const pendingDrag = useRef<{ id: string; x: number; y: number } | null>(null);

  const items = view.myHand.filter((c) => c.instanceId !== dragging);
  // Шаг веера ужинается с ростом руки и шириной экрана.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 720;
  const step =
    items.length <= 6
      ? narrow
        ? 74
        : HAND.step
      : Math.max(narrow ? 54 : 70, (narrow ? 380 : 560) / items.length);

  // Глобальное окончание перетаскивания: указатель в этот момент уже над столом,
  // поэтому решаем всё здесь — стопка сброса = сброс, зона = сыграть.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const pending = pendingDrag.current;
      if (!pending) return;
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= DRAG_THRESHOLD_PX) return;
      pendingDrag.current = null;
      setUi({
        selectedHand: pending.id,
        dragging: pending.id,
        draggingFrom: 'hand',
        draggingOverZone: null,
        draggingOverDiscard: false,
        dragPoint: null,
      });
    };

    const onUp = (event: PointerEvent) => {
      pendingDrag.current = null;
      const ui = useGame.getState().ui;
      if (!ui.dragging) return;
      const overDiscard = ui.draggingOverDiscard;
      const inCorner = event.clientX > innerWidth - 170 && event.clientY > innerHeight - 170;
      const zone = ui.draggingOverZone;
      const source = ui.draggingFrom;
      const instanceId = ui.dragging;
      setUi({ dragging: null, draggingOverZone: null, draggingOverDiscard: false, dragPoint: null });
      if (overDiscard || inCorner) {
        if (source === 'field') {
          sendCommand({ type: 'discard_from_field', player: view.me, instanceId });
        } else {
          sendCommand({ type: 'discard_from_hand', player: view.me, instanceId });
          setUi({ selectedHand: null });
        }
      } else if (zone !== null && source === 'hand') {
        sendCommand({ type: 'play_card', player: view.me, instanceId, zone });
        setUi({ selectedHand: null });
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [view.me]);

  // Выбранная карта ушла из руки (сыграна/сброшена) — снимаем выделение.
  useEffect(() => {
    if (selected && !view.myHand.some((card) => card.instanceId === selected)) {
      setUi({ selectedHand: null });
    }
  }, [selected, view.myHand]);

  // Вне своей основной фазы ввод из руки не активен — сбрасываем UI-выделение.
  useEffect(() => {
    if (myMain) return;
    const ui = useGame.getState().ui;
    if (ui.selectedHand || ui.dragging || ui.holdingFloop) {
      setUi({
        selectedHand: null,
        dragging: null,
        draggingOverZone: null,
        draggingOverDiscard: false,
        dragPoint: null,
        holdingFloop: null,
      });
    }
  }, [myMain]);

  return (
    <>
      <group ref={group}>
        {items.map((card, index) => {
          const offset = index - (items.length - 1) / 2;
          const isSelected = selected === card.instanceId;
          const meta = catalog.find((c) => c.id === card.cardId);
          return (
            <HandCard
              key={card.instanceId}
              instanceId={card.instanceId}
              cardId={card.cardId}
              offset={offset}
              step={step}
              selected={isSelected}
              playable={myMain}
              isDirect={meta?.type === 'spell' || meta?.type === 'companion'}
              view={view}
              pendingDrag={pendingDrag}
            />
          );
        })}
      </group>
      {dragging && draggingFrom === 'hand' && <DragGhost view={view} instanceId={dragging} />}
      {dragging && <DragPlane view={view} />}
    </>
  );
}

/** Призрак карты руки следует за указателем при перетаскивании (docs/UI-3D.md «Взаимодействие»). */
function DragGhost({ view, instanceId }: { view: PlayerView; instanceId: string }) {
  const dragPoint = useGame((s) => s.ui.dragPoint);
  const ref = useRef<THREE.Group>(null);
  const cardId = view.myHand.find((c) => c.instanceId === instanceId)?.cardId ?? '';
  const texture = useMemo(() => cardTexture(cardId), [cardId]);

  useFrame(() => {
    if (!ref.current || !dragPoint) return;
    ref.current.position.x += (dragPoint.x - ref.current.position.x) * 0.35;
    ref.current.position.z += (dragPoint.z - ref.current.position.z) * 0.35;
  });

  if (!dragPoint) return null;
  return (
    <group ref={ref} position={[dragPoint.x, 42, dragPoint.z]} rotation={[-Math.PI / 2 + 0.55, 0, 0]}>
      <mesh>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial map={texture} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

/** Прозрачная плоскость улавливания при перетаскивании: следит за указателем над всем столом. */
function DragPlane({ view }: { view: PlayerView }) {
  const origin = myBoardTransform(view);
  return (
    <mesh
      position={[origin.x, 45, origin.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(event) => {
        event.stopPropagation();
        const ray = event.ray;
        const tableY = 1.6; // верх карт на поле
        const tTable = Math.abs(ray.direction.y) > 1e-6 ? (tableY - ray.origin.y) / ray.direction.y : 0;
        const px = ray.origin.x + ray.direction.x * tTable;
        const pz = ray.origin.z + ray.direction.z * tTable;
        const zone = zoneFromWorld(view, px, pz);
        const overDiscard = overMyDiscardRay(
          view,
          ray.origin.x,
          ray.origin.y,
          ray.origin.z,
          ray.direction.x,
          ray.direction.y,
          ray.direction.z,
        );
        useGame.setState((s) => ({
          ui: {
            ...s.ui,
            dragPoint: { x: px, z: pz },
            draggingOverZone: zone,
            draggingOverDiscard: overDiscard,
          },
        }));
      }}
    >
      <planeGeometry args={[2800, 1800]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function HandCard({
  instanceId,
  cardId,
  offset,
  step,
  selected,
  playable,
  isDirect,
  view,
  pendingDrag,
}: {
  instanceId: string;
  cardId: string;
  offset: number;
  step: number;
  selected: boolean;
  playable: boolean;
  isDirect: boolean;
  view: PlayerView;
  pendingDrag: MutableRefObject<{ id: string; x: number; y: number } | null>;
}) {
  const texture = useMemo(() => cardTexture(cardId), [cardId]);
  const back = useMemo(() => cardBackTexture(), []);
  const edgeMat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#2a3545' }), []);
  const materials = useMemo(
    () => [
      edgeMat, // +x
      edgeMat, // -x
      new THREE.MeshLambertMaterial({ map: texture }), // +y (лицо)
      new THREE.MeshLambertMaterial({ map: back }), // -y (рубашка)
      edgeMat, // +z
      edgeMat, // -z
    ],
    [texture, back, edgeMat],
  );

  const mesh = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const target = useMemo(
    () => ({
      x: offset * step,
      y: selected ? HAND.liftY : HAND.y,
      z: HAND.z + Math.abs(offset) * 10 - (selected ? 42 : 0),
      rotX: selected ? -0.12 : HAND.rotX,
      rotY: selected ? 0 : -offset * 0.07,
      scale: selected ? 1.16 : 1,
    }),
    [offset, step, selected],
  );

  useFrame(() => {
    const g = mesh.current;
    if (!g) return;
    const dx = target.x - g.position.x;
    const dy = target.y - g.position.y;
    const dz = target.z - g.position.z;
    const drx = target.rotX - g.rotation.x;
    const dry = target.rotY - g.rotation.y;
    const ds = target.scale - g.scale.x;
    const moving =
      Math.abs(dx) > 0.1 ||
      Math.abs(dy) > 0.1 ||
      Math.abs(dz) > 0.1 ||
      Math.abs(drx) > 0.005 ||
      Math.abs(dry) > 0.005 ||
      Math.abs(ds) > 0.005;

    if (moving) {
      g.position.x += dx * 0.2;
      g.position.y += dy * 0.2;
      g.position.z += dz * 0.2;
      g.rotation.x += drx * 0.2;
      g.rotation.y += dry * 0.2;
      const s = target.scale;
      g.scale.x += (s - g.scale.x) * 0.2;
      g.scale.y += (s - g.scale.y) * 0.2;
      g.scale.z += (s - g.scale.z) * 0.2;
      invalidate();
    } else {
      g.position.set(target.x, target.y, target.z);
      g.rotation.set(target.rotX, target.rotY, 0);
      g.scale.set(target.scale, target.scale, target.scale);
    }
  });

  const handleDown = (event: ThreeEvent<PointerEvent>) => {
    if (!playable) return;
    event.stopPropagation();
    pendingDrag.current = { id: instanceId, x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // Режим выбора целей: рука отдаётся как own_hand_card.
    const targeting = useGame.getState().ui.targeting;
    if (targeting) {
      const ask = targeting.asks[targeting.askIndex];
      if (ask && ask.kind === 'own_hand_card') {
        const result = pick(view, targeting, { kind: 'card', instanceId });
        if (result.accepted && result.command) {
          sendCommand(result.command);
          setUi({ targeting: result.nextState ?? null });
        } else if (result.accepted && result.nextState) {
          setUi({ targeting: result.nextState });
        }
      }
      return;
    }
    if (!playable) return;
    if (event.delta > 8) return; // это завершение драга, а не клик
    if (isDirect) {
      sendCommand({ type: 'play_card', player: view.me, instanceId });
      setUi({ selectedHand: null });
      return;
    }
    setUi({ selectedHand: useGame.getState().ui.selectedHand === instanceId ? null : instanceId });
  };

  return (
    <group
      ref={mesh}
      position={[offset * step, HAND.y, HAND.z + Math.abs(offset) * 10]}
      rotation={[HAND.rotX, -offset * 0.07, 0]}
      onPointerDown={handleDown}
      onClick={handleClick}
    >
      <mesh material={materials}>
        <boxGeometry args={[CARD_W, CARD_T, CARD_H]} />
      </mesh>
      {/* Прозрачная плоскость хитбокса над картой: надёжный клик даже при тонком боксе */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, CARD_T + 0.2, 0]}>
        <planeGeometry args={[CARD_W + 12, CARD_H + 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected && (
        <mesh position={[0, 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[CARD_W + 10, CARD_H + 10]} />
          <meshBasicMaterial color="#48bb78" transparent opacity={0.35} />
        </mesh>
      )}
    </group>
  );
}
