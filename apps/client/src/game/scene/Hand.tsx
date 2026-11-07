import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerView } from '@card-wars/protocol';
import { cards as catalog } from '@card-wars/content';
import { CARD_H, CARD_T, CARD_W, HAND, overMyDiscardRay, zoneFromWorld } from './layout';
import { cardBackTexture, cardTexture } from './textures';
import { sendCommand, setUi, useGame } from '../../store';
import { pick } from '../targeting';

const DRAG_THRESHOLD_PX = 10;
const sharedEdgeMat = new THREE.MeshLambertMaterial({ color: '#2a3545' });

/**
 * Hand — 3D fan attached to the camera at the bottom of the screen (docs/UI-3D.md «Рука»).
 * Follows the camera when it orbits around the table, stays above the table,
 * and lifts/scales cards on hover or selection for easy text reading.
 */
export function Hand({ view }: { view: PlayerView }) {
  const me = view.players[view.me]!;
  const myMain =
    view.activePlayers.includes(view.me) &&
    !me.battleReady &&
    view.status === 'running' &&
    view.phase === 'main';
  const selected = useGame((s) => s.ui.selectedHand);
  const hovered = useGame((s) => s.ui.hoveredHand);
  const dragging = useGame((s) => s.ui.dragging);
  const draggingFrom = useGame((s) => s.ui.draggingFrom);
  const group = useRef<THREE.Group>(null);
  const pendingDrag = useRef<{ id: string; x: number; y: number } | null>(null);
  const { camera, gl, size, invalidate } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  const items = view.myHand.filter((c) => c.instanceId !== dragging);
  // Compute exact frustum size at the hand plane so cards always sit just above
  // the bottom edge and fit within the left/right edges at any window aspect ratio.
  const aspect = size.width / Math.max(1, size.height);
  const fovDeg = camera instanceof THREE.PerspectiveCamera ? camera.fov : 43;
  const halfH = Math.abs(HAND.camZ) * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  const halfW = halfH * aspect;
  const baseScale = Math.min(1.04, Math.max(0.76, aspect * 0.86));
  const maxSpan = Math.max(60, 2 * halfW - CARD_W * baseScale - 24);
  const step =
    items.length > 1
      ? Math.min(HAND.step * baseScale, maxSpan / (items.length - 1))
      : 0;
  const baseY = -halfH + (CARD_H * baseScale) / 2 + 12;

  // Sync hand group with camera transform before paint and on every frame.
  useLayoutEffect(() => {
    if (!group.current) return;
    group.current.position.copy(camera.position);
    group.current.quaternion.copy(camera.quaternion);
  });

  useFrame(() => {
    if (!group.current) return;
    group.current.position.copy(camera.position);
    group.current.quaternion.copy(camera.quaternion);
  });

  // Global drag tracking & drop resolution using pure mathematical plane intersection
  // (zero scene mesh raycasting during drag -> smooth 60fps in Chrome & Edge).
  useEffect(() => {
    const updateDragRay = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const ray = raycaster.ray;
      const tableY = 1.6;
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
      const ui = useGame.getState().ui;
      ui.dragPoint = { x: px, z: pz };
      if (ui.draggingOverZone !== zone || ui.draggingOverDiscard !== overDiscard) {
        useGame.setState((s) => ({
          ui: {
            ...s.ui,
            dragPoint: { x: px, z: pz },
            draggingOverZone: zone,
            draggingOverDiscard: overDiscard,
          },
        }));
      }
      invalidate();
    };

    const onMove = (event: PointerEvent) => {
      const pending = pendingDrag.current;
      if (pending) {
        if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= DRAG_THRESHOLD_PX) return;
        pendingDrag.current = null;
        setUi({
          selectedHand: pending.id,
          hoveredHand: null,
          dragging: pending.id,
          draggingFrom: 'hand',
          draggingOverZone: null,
          draggingOverDiscard: false,
          dragPoint: null,
        });
        updateDragRay(event.clientX, event.clientY);
        return;
      }
      if (useGame.getState().ui.dragging) {
        updateDragRay(event.clientX, event.clientY);
      }
    };

    const onUp = (event: PointerEvent) => {
      pendingDrag.current = null;
      const ui = useGame.getState().ui;
      if (!ui.dragging) return;
      const overDiscard = ui.draggingOverDiscard;
      const inCorner =
        innerWidth > 768 && event.clientX > innerWidth - 170 && event.clientY > innerHeight - 170;
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
      invalidate();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [view, camera, gl, invalidate, raycaster, ndc]);

  // Selected card left the hand (played/discarded) — clear selection.
  useEffect(() => {
    if (selected && !view.myHand.some((card) => card.instanceId === selected)) {
      setUi({ selectedHand: null });
    }
    if (hovered && !view.myHand.some((card) => card.instanceId === hovered)) {
      setUi({ hoveredHand: null });
    }
  }, [selected, hovered, view.myHand]);

  // Outside own main phase, dragging/flooping is inactive — clear active drag/hold.
  useEffect(() => {
    if (myMain) return;
    const ui = useGame.getState().ui;
    if (ui.dragging || ui.holdingFloop) {
      setUi({
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
          const isHovered = hovered === card.instanceId;
          const meta = catalog.find((c) => c.id === card.cardId);
          return (
            <HandCard
              key={card.instanceId}
              instanceId={card.instanceId}
              cardId={card.cardId}
              index={index}
              offset={offset}
              step={step}
              baseY={baseY}
              baseScale={baseScale}
              halfW={halfW}
              selected={isSelected}
              hovered={isHovered}
              playable={myMain}
              isDirect={meta?.type === 'spell' || meta?.type === 'companion'}
              view={view}
              pendingDrag={pendingDrag}
            />
          );
        })}
      </group>
      {dragging && draggingFrom === 'hand' && <DragGhost view={view} instanceId={dragging} />}
    </>
  );
}

/** Ghost of a hand card following the pointer while dragging (docs/UI-3D.md). */
function DragGhost({ view, instanceId }: { view: PlayerView; instanceId: string }) {
  const ref = useRef<THREE.Group>(null);
  const initialized = useRef(false);
  const cardId = view.myHand.find((c) => c.instanceId === instanceId)?.cardId ?? '';
  const texture = useMemo(() => cardTexture(cardId), [cardId]);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const dragPoint = useGame.getState().ui.dragPoint;
    if (!dragPoint) {
      g.visible = false;
      initialized.current = false;
      return;
    }
    if (!initialized.current) {
      g.position.set(dragPoint.x, 42, dragPoint.z);
      g.visible = true;
      initialized.current = true;
      return;
    }
    g.position.x += (dragPoint.x - g.position.x) * 0.4;
    g.position.z += (dragPoint.z - g.position.z) * 0.4;
  });

  return (
    <group ref={ref} visible={false} position={[0, 42, 0]} rotation={[-Math.PI / 2 + 0.35, 0, 0]}>
      <mesh raycast={() => null}>
        <planeGeometry args={[CARD_W * 1.08, CARD_H * 1.08]} />
        <meshBasicMaterial map={texture} transparent opacity={0.92} />
      </mesh>
    </group>
  );
}

function HandCard({
  instanceId,
  cardId,
  index,
  offset,
  step,
  baseY,
  baseScale,
  halfW,
  selected,
  hovered,
  playable,
  isDirect,
  view,
  pendingDrag,
}: {
  instanceId: string;
  cardId: string;
  index: number;
  offset: number;
  step: number;
  baseY: number;
  baseScale: number;
  halfW: number;
  selected: boolean;
  hovered: boolean;
  playable: boolean;
  isDirect: boolean;
  view: PlayerView;
  pendingDrag: MutableRefObject<{ id: string; x: number; y: number } | null>;
}) {
  const texture = useMemo(() => cardTexture(cardId), [cardId]);
  const back = useMemo(() => cardBackTexture(), []);
  const materials = useMemo(
    () => [
      sharedEdgeMat, // +x
      sharedEdgeMat, // -x
      new THREE.MeshBasicMaterial({ map: texture }), // +y (face — unlit so card text is bright & crisp)
      new THREE.MeshLambertMaterial({ map: back }), // -y (back)
      sharedEdgeMat, // +z
      sharedEdgeMat, // -z
    ],
    [texture, back],
  );

  useEffect(() => {
    return () => {
      materials[2]?.dispose();
      materials[3]?.dispose();
    };
  }, [materials]);

  const mesh = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const elevated = selected || hovered;

  const target = useMemo(() => {
    const rawX = offset * step;
    const elevScale = Math.min(1.28, baseScale * 1.32);
    const maxX = Math.max(0, halfW * (Math.abs(HAND.camLiftZ) / Math.abs(HAND.camZ)) - (CARD_W * elevScale) / 2 - 8);
    const clampedX = elevated ? Math.max(-maxX, Math.min(maxX, rawX)) : rawX;
    return {
      x: clampedX,
      y: elevated ? baseY + 34 : baseY - Math.abs(offset) * 2.5,
      z: elevated ? HAND.camLiftZ : HAND.camZ + index * 0.6,
      rotX: elevated ? Math.PI / 2 : Math.PI / 2 - 0.12,
      rotY: 0,
      rotZ: elevated ? 0 : -offset * 0.038,
      scale: elevated ? elevScale : baseScale,
    };
  }, [offset, step, index, elevated, baseY, baseScale, halfW]);

  useFrame(() => {
    const g = mesh.current;
    if (!g) return;
    const dx = target.x - g.position.x;
    const dy = target.y - g.position.y;
    const dz = target.z - g.position.z;
    const drx = target.rotX - g.rotation.x;
    const dry = target.rotY - g.rotation.y;
    const drz = target.rotZ - g.rotation.z;
    const ds = target.scale - g.scale.x;
    const moving =
      Math.abs(dx) > 0.1 ||
      Math.abs(dy) > 0.1 ||
      Math.abs(dz) > 0.1 ||
      Math.abs(drx) > 0.004 ||
      Math.abs(dry) > 0.004 ||
      Math.abs(drz) > 0.004 ||
      Math.abs(ds) > 0.004;

    if (moving) {
      g.position.x += dx * 0.24;
      g.position.y += dy * 0.24;
      g.position.z += dz * 0.24;
      g.rotation.x += drx * 0.24;
      g.rotation.y += dry * 0.24;
      g.rotation.z += drz * 0.24;
      const s = g.scale.x + ds * 0.24;
      g.scale.set(s, s, s);
      invalidate();
    } else {
      g.position.set(target.x, target.y, target.z);
      g.rotation.set(target.rotX, target.rotY, target.rotZ);
      g.scale.set(target.scale, target.scale, target.scale);
    }
  });

  const handleDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    if (!playable) return;
    event.stopPropagation();
    pendingDrag.current = { id: instanceId, x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
  };

  const handleOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (useGame.getState().ui.dragging) return;
    if (useGame.getState().ui.hoveredHand !== instanceId) {
      setUi({ hoveredHand: instanceId });
      invalidate();
    }
  };

  const handleOut = () => {
    if (useGame.getState().ui.hoveredHand === instanceId) {
      setUi({ hoveredHand: null });
      invalidate();
    }
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    // Target selection mode: hand card is passed as own_hand_card.
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
    if (event.delta > 8) return; // drag release, not a click
    if (playable && isDirect) {
      sendCommand({ type: 'play_card', player: view.me, instanceId });
      setUi({ selectedHand: null });
      return;
    }
    setUi({ selectedHand: useGame.getState().ui.selectedHand === instanceId ? null : instanceId });
    invalidate();
  };

  return (
    <group
      ref={mesh}
      position={[offset * step, baseY - Math.abs(offset) * 2.5, HAND.camZ + index * 0.6]}
      rotation={[Math.PI / 2 - 0.12, 0, -offset * 0.038]}
      scale={[baseScale, baseScale, baseScale]}
      onPointerDown={handleDown}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
      onClick={handleClick}
    >
      <mesh material={materials}>
        <boxGeometry args={[CARD_W, CARD_T, CARD_H]} />
      </mesh>
      {/* Transparent hitbox plane above the card for reliable clicking on thin box */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, CARD_T + 0.2, 0]}>
        <planeGeometry args={[CARD_W + 8, CARD_H + 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected && (
        <mesh position={[0, 1.4, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <planeGeometry args={[CARD_W + 8, CARD_H + 8]} />
          <meshBasicMaterial color="#48bb78" transparent opacity={0.35} />
        </mesh>
      )}
    </group>
  );
}
