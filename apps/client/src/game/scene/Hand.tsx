import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerView } from '@card-wars/protocol';
import { cards as catalog } from '@card-wars/content';
import { CARD_H, CARD_T, CARD_W, HAND, ROW_LEN, zoneX } from './layout';
import { cardTexture } from './textures';
import { sendCommand, setUi, useGame } from '../../store';

/**
 * Рука — 3D-веер внизу экрана (docs/UI-3D.md «Рука (решено: 3D)»).
 * Клик выбирает карту; для существа/строения появляется режим размещения —
 * клик по своей зоне играет карту; перетаскивание в правый нижний угол — сброс.
 */
export function Hand({ view }: { view: PlayerView }) {
  const myMain = view.activePlayer === view.me && view.status === 'running' && view.phase === 'main';
  const selected = useGame((s) => s.ui.selectedHand);
  const dragging = useGame((s) => s.ui.dragging);
  const group = useRef<THREE.Group>(null);

  const items = view.myHand.filter((c) => c.instanceId !== dragging);
  // Шаг веера ужинается с ростом руки, чтобы крайние карты не уходили за кадр.
  const step = items.length <= 6 ? HAND.step : Math.max(70, 560 / items.length);

  // Глобальное окончание перетаскивания: указатель в этот момент уже НЕ над
  // картой руки, поэтому решаем всё здесь — зона = сыграть, угол = сброс.
  useEffect(() => {
    const onUp = (event: PointerEvent) => {
      const ui = useGame.getState().ui;
      if (!ui.dragging) return;
      const inCorner = event.clientX > innerWidth - 170 && event.clientY > innerHeight - 170;
      const zone = ui.draggingOverZone;
      setUi({ dragging: null, draggingOverZone: null });
      if (inCorner) {
        sendCommand({ type: 'discard_from_hand', player: view.me, instanceId: ui.dragging });
        setUi({ selectedHand: null });
      } else if (zone !== null) {
        sendCommand({ type: 'play_card', player: view.me, instanceId: ui.dragging, zone });
        setUi({ selectedHand: null });
      }
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, [view.me]);

  useFrame((_, delta) => {
    if (!group.current) return;
    // лёгкое покачивание веера — сцена «живая»
    group.current.position.x = Math.sin(performance.now() / 2400) * 2;
    void delta;
  });

  return (
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
            isSpell={meta?.type === 'spell'}
            view={view}
          />
        );
      })}
      {dragging && <DragPlane />}
      {dragging && <CornerHint instanceId={dragging} />}
    </group>
  );
}

/** Подсказка зоны сброса в правом нижнем углу при перетаскивании (docs/UI-3D.md). */
function CornerHint({ instanceId }: { instanceId: string }) {
  const texture = useMemo(() => cardTexture(useGame.getState().view?.myHand.find((c) => c.instanceId === instanceId)?.cardId ?? ''), [instanceId]);
  return (
    <mesh position={[-600, 40, 250]} rotation={[0.5, 0.6, 0]}>
      <planeGeometry args={[CARD_W, CARD_H]} />
      <meshBasicMaterial map={texture} transparent opacity={0.25} />
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
  isSpell,
  view,
}: {
  instanceId: string;
  cardId: string;
  offset: number;
  step: number;
  selected: boolean;
  playable: boolean;
  isSpell: boolean;
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
    setUi({ selectedHand: instanceId, dragging: instanceId, draggingOverZone: null });
  };

  const handleUp = () => {
    // Отпускание над самой картой: ничего не решаем — глобальный pointerup
    // в Hand уже обработал зону/угол (указатель ушёл с карты при перетаскивании).
    const state = useGame.getState().ui;
    if (state.dragging !== instanceId) return;
    setUi({ dragging: null, draggingOverZone: null });
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!playable) return;
    if (isSpell) {
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

/** Прозрачная (но не visible=false — рейкаст невидимых отключён) плоскость
 *  улавливания при перетаскивании: подсвечивает зоны. */
function DragPlane() {
  return (
    <mesh
      position={[0, 45, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(event) => {
        event.stopPropagation();
        const { x, z } = event.point;
        if (z > 0 && Math.abs(x) < ROW_LEN / 2 + 20) {
          const zone = THREE.MathUtils.clamp(Math.round((x - zoneX(0)) / (zoneX(1) - zoneX(0))), 0, 3);
          useGame.setState((s) => ({ ui: { ...s.ui, draggingOverZone: zone } }));
        } else {
          useGame.setState((s) => (s.ui.draggingOverZone !== null ? { ui: { ...s.ui, draggingOverZone: null } } : {}));
        }
      }}
    >
      <planeGeometry args={[1200, 900]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
