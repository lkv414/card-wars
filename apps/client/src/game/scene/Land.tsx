import { useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { LandType } from '@card-wars/content';
import type { LandView } from '@card-wars/protocol';
import { CARD_H, CARD_W, LAND_H, LAND_W, slotLocalZ } from './layout';
import { landTexture } from './textures';
import { useGame } from '../../store';

/** Земля: лежачий тайл 92×129 с двумя слотами; замороженная/перевёрнутая — оверлеи (docs/UI-3D.md). */
export function Land({
  land,
  zone,
  isMe,
  pickable,
  onPick,
}: {
  land: LandView;
  zone: number;
  isMe: boolean;
  pickable: boolean;
  onPick: (zone: number) => void;
}) {
  const texture = useMemo(
    () => landTexture(land.type as LandType, land.frozen, land.flipped),
    [land.type, land.frozen, land.flipped],
  );
  const placeMode = useGame((s) => s.ui.dragging !== null && isMe);
  const hovered = useGame((s) => s.ui.draggingOverZone);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!pickable) return;
    event.stopPropagation();
    onPick(zone);
  };

  const highlight = (placeMode && hovered === zone) || pickable;

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
      {highlight && (
        <mesh position={[0, 1.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[LAND_W + 8, LAND_H + 8]} />
          <meshBasicMaterial color={pickable ? '#7fd1ff' : '#48bb78'} transparent opacity={0.35} />
        </mesh>
      )}
      {/* slot guides: creature toward the centre line, building toward the owner */}
      <SlotGuide z={slotLocalZ('creature', isMe)} w={CARD_W} h={CARD_H} />
      <SlotGuide z={slotLocalZ('building', isMe)} w={CARD_W * 0.7} h={CARD_H * 0.7} dim />
    </group>
  );
}

function SlotGuide({ z, w, h, dim }: { z: number; w: number; h: number; dim?: boolean }) {
  return (
    <mesh position={[0, 0.7, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w + 6, h + 6]} />
      <meshBasicMaterial color={dim ? '#ffffff' : '#ffe9a8'} transparent opacity={dim ? 0.06 : 0.12} side={THREE.DoubleSide} />
    </mesh>
  );
}
