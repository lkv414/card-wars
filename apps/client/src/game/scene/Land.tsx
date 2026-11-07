import { useMemo } from 'react';
import * as THREE from 'three';
import { cards as catalog } from '@card-wars/content';
import type { LandType } from '@card-wars/content';
import type { LandView } from '@card-wars/protocol';
import { CARD_H, CARD_W, HALF_H, HALF_W, LAND_H, LAND_W, slotLocalZ } from './layout';
import { landTexture } from './textures';
import { useGame, setUi, sendCommand } from '../../store';
import { pick, validTargets } from '../targeting';
import type { ThreeEvent } from '@react-three/fiber';
import type { PlayerView } from '@card-wars/protocol';

/** Земля: тайл 96×188, разделён ровно пополам — половина существа (фронт) и строения (docs/UI-3D.md «Размеры»). */
export function Land({
  land,
  zone,
  isMe,
  pid,
  view,
}: {
  land: LandView;
  zone: number;
  isMe: boolean;
  pid: string;
  view: PlayerView;
}) {
  const texture = useMemo(
    () => landTexture(land.type as LandType, land.frozen, land.flipped),
    [land.type, land.frozen, land.flipped],
  );
  const dragging = useGame((s) => s.ui.dragging);
  const draggingFrom = useGame((s) => s.ui.draggingFrom);
  const hovered = useGame((s) => s.ui.draggingOverZone);
  const placeMode = dragging !== null && isMe;

  // Слот перетаскиваемой карты: подсвечивается соответствующая половина тайла.
  const draggedSlot = useMemo<'creature' | 'building' | null>(() => {
    if (!dragging || draggingFrom !== 'hand') return null;
    const handCard = view.myHand.find((c) => c.instanceId === dragging);
    const meta = handCard ? catalog.find((c) => c.id === handCard.cardId) : undefined;
    if (meta?.type === 'creature') return 'creature';
    if (meta?.type === 'building') return 'building';
    return null;
  }, [dragging, draggingFrom, view]);

  // Выбор земли как цели (docs/MECHANICS-V2.md §5) + подсветка размещения.
  const targeting = useGame((st) => st.ui.targeting);
  const currentAsk = targeting ? targeting.asks[targeting.askIndex] : undefined;
  const isLandTarget = targeting && currentAsk && currentAsk.kind.includes('landscape')
    ? validTargets(view, currentAsk, targeting.sourceInstanceId, targeting.collected)
      .some((c) => c.kind === 'landscape' && c.player === pid && c.zone === zone)
    : false;

  const zoneHovered = placeMode && hovered === zone;
  const highlightSlot = (slot: 'creature' | 'building'): boolean =>
    zoneHovered && (draggedSlot === null || draggedSlot === slot);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!targeting || !currentAsk || !isLandTarget) return;
    event.stopPropagation();
    const ui = useGame.getState().ui;
    const result = pick(view, ui.targeting!, { kind: 'landscape', player: pid, zone });
    if (!result.accepted) return;
    if (result.command) {
      sendCommand(result.command);
      setUi({ targeting: result.nextState ?? null });
    } else if (result.nextState) {
      setUi({ targeting: result.nextState });
    }
  };

  return (
    <group>
      <mesh
        position={[0, 0.6, 0]}
        onClick={handleClick}
        onPointerOver={(e) => {
          if (placeMode) {
            e.stopPropagation();
            useGame.setState((s) => ({ ui: { ...s.ui, draggingOverZone: zone } }));
          }
        }}
        onPointerOut={() => {
          useGame.setState((s) => (s.ui.draggingOverZone === zone ? { ui: { ...s.ui, draggingOverZone: null } } : {}));
        }}
      >
        <boxGeometry args={[LAND_W, 1.2, LAND_H]} />
        <meshLambertMaterial map={texture} />
      </mesh>
      {isLandTarget && (
        <mesh position={[0, 1.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[LAND_W + 8, LAND_H + 8]} />
          <meshBasicMaterial color="#7fd1ff" transparent opacity={0.35} />
        </mesh>
      )}
      {/* Подсветка половин при драге: только слот под тип карты (или обе, если тип не зональный) */}
      {highlightSlot('creature') && (
        <mesh position={[0, 1.6, -HALF_H / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[HALF_W + 6, HALF_H + 4]} />
          <meshBasicMaterial color="#48bb78" transparent opacity={0.35} />
        </mesh>
      )}
      {highlightSlot('building') && (
        <mesh position={[0, 1.6, HALF_H / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[HALF_W + 6, HALF_H + 4]} />
          <meshBasicMaterial color="#48bb78" transparent opacity={0.35} />
        </mesh>
      )}
      {/* slot guides: карточное место в каждой половине (существо ближе к фронту) */}
      <SlotGuide z={slotLocalZ('creature')} />
      <SlotGuide z={slotLocalZ('building')} />
    </group>
  );
}

function SlotGuide({ z }: { z: number }) {
  return (
    <mesh position={[0, 0.7, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[CARD_W + 6, CARD_H + 6]} />
      <meshBasicMaterial color="#ffe9a8" transparent opacity={0.1} side={THREE.DoubleSide} />
    </mesh>
  );
}
