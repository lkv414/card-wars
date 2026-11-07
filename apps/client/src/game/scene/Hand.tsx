import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerView } from '@card-wars/protocol';
import { cards as catalog } from '@card-wars/content';
import { CARD_H, CARD_T, CARD_W, HAND, myBoardTransform, overMyDiscardRay, zoneFromWorld } from './layout';
import { cardTexture } from './textures';
import { sendCommand, setUi, useGame } from '../../store';
import { pick } from '../targeting';

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

  const items = view.myHand.filter((c) => c.instanceId !== dragging);
  // Шаг веера ужинается с ростом руки и шириной экрана.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 720;
  const step =
    items.length <= 6
      ? narrow
        ? 74
        : HAND.step
      : Math.max(narrow ? 54 : 70, (narrow ? 380 : 560) / items.length);

  // Глобальное окончание перетаскивания: указатель в этот момент уже НЕ над
  // картой руки, поэтому решаем всё здесь — стопка сброса = сброс, зона = сыграть.
  useEffect(() => {
    const onUp = (event: PointerEvent) => {
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
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
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

  useFrame((_, delta) => {
    if (!group.current) return;
    // лёгкое покачивание веера — сцена «живая»
    group.current.position.x = Math.sin(performance.now() / 2400) * 2;
    void delta;
  });

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

/** Прозрачная (но не visible=false — рейкаст невидимых отключён) плоскость
 *  улавливания при перетаскивании: следит за указателем над всем столом.
 *  Зону и точку следования считаем на уровне стола (луч, а не хит по
 *  плоскости ловушки) — иначе параллакс уводит drop мимо стопки/зоны. */
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
}: {
  instanceId: string;
  cardId: string;
  offset: number;
  step: number;
  selected: boolean;
  playable: boolean;
  isDirect: boolean;
  view: PlayerView;
}) {
  const texture = useMemo(() => cardTexture(cardId), [cardId]);
  const mesh = useRef<THREE.Group>(null);
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
    g.position.x += (target.x - g.position.x) * 0.2;
    g.position.y += (target.y - g.position.y) * 0.2;
    g.position.z += (target.z - g.position.z) * 0.2;
    g.rotation.x += (target.rotX - g.rotation.x) * 0.2;
    g.rotation.y += (target.rotY - g.rotation.y) * 0.2;
    const s = target.scale;
    g.scale.x += (s - g.scale.x) * 0.2;
    g.scale.y += (s - g.scale.y) * 0.2;
    g.scale.z += (s - g.scale.z) * 0.2;
  });

  const handleDown = (event: ThreeEvent<PointerEvent>) => {
    if (!playable) return;
    event.stopPropagation();
    setUi({
      selectedHand: instanceId,
      dragging: instanceId,
      draggingFrom: 'hand',
      draggingOverZone: null,
      draggingOverDiscard: false,
      dragPoint: null,
    });
  };

  const handleUp = () => {
    // Отпускание над самой картой: ничего не решаем — глобальный pointerup
    // в Hand уже обработал стопку/зону (указатель ушёл с карты при перетаскивании).
    const state = useGame.getState().ui;
    if (state.dragging !== instanceId) return;
    setUi({ dragging: null, draggingOverZone: null, draggingOverDiscard: false, dragPoint: null });
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
      onPointerUp={handleUp}
      onClick={handleClick}
    >
      <mesh>
        <boxGeometry args={[CARD_W, CARD_T, CARD_H]} />
        <meshLambertMaterial map={texture} />
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
