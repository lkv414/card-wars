import { useMemo } from 'react';
import * as THREE from 'three';
import type { LandType } from '@card-wars/content';
import type { LandView } from '@card-wars/protocol';
import { CARD_H, CARD_W, LAND_H, LAND_W, slotLocalZ } from './layout';
import { landTexture } from './textures';
import { useGame } from '../../store';
import { sendCommand, setUi } from '../../store';
import { pick, validTargets } from '../targeting';
import type { ThreeEvent } from '@react-three/fiber';
import type { PlayerView } from '@card-wars/protocol';

/** Земля: лежачий тайл 92×129 с двумя слотами; замороженная/перевёрнутая — оверлеи (docs/UI-3D.md). */
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
  const placeMode = useGame((s) => s.ui.dragging !== null && isMe);
  const hovered = useGame((s) => s.ui.draggingOverZone);

  // Выбор земли как цели (docs/MECHANICS-V2.md §5) + подсветка размещения.
  const targeting = useGame((st) => st.ui.targeting);
  const currentAsk = targeting ? targeting.asks[targeting.askIndex] : undefined;
  const isLandTarget = targeting && currentAsk && currentAsk.kind.includes('landscape')
    ? validTargets(view, currentAsk, targeting.sourceInstanceId, targeting.collected)
      .some((c) => c.kind === 'landscape' && c.player === pid && c.zone === zone)
    : false;
  const highlight = (placeMode && hovered === zone) || isLandTarget;

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
      {highlight && (
        <mesh position={[0, 1.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[LAND_W + 8, LAND_H + 8]} />
          <meshBasicMaterial color="#48bb78" transparent opacity={0.35} />
        </mesh>
      )}
      {/* slot guides: creature toward the centre line, building toward the owner */}
      <SlotGuide z={slotLocalZ('creature')} w={CARD_W} h={CARD_H} />
      <SlotGuide z={slotLocalZ('building')} w={CARD_W * 0.7} h={CARD_H * 0.7} dim />
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
