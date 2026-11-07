import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { CardView, PlayerView } from '@card-wars/protocol';
import { cards as catalog } from '@card-wars/content';
import { CARD_H, CARD_T, CARD_W, FROST_D, TOKEN_D, TOKEN_T, slotLocalZ } from './layout';
import { cardBackTexture, cardTexture, frostTexture, tokenTexture } from './textures';
import { sendCommand, setUi, showHint, useGame } from '../../store';
import { activeAbilityOf, pick, startForActive, validTargets } from '../targeting';
import { DamagePile } from './DamagePile';

const HOLD_MS = 1000; // floop — hold the card for 1s (docs/UI-3D.md)
const HINT_HOLD_MS = 450; // quick feedback when holding a card that cannot floop
const FLIP_ANIM_MS = 480; // 3D jump + turn animation when card floops/unfloops
const DRAG_THRESHOLD_PX = 10; // movement past threshold turns hold into drag
const DRAG_LIFT_Y = 34; // card lift height while dragging
const sharedEdgeMat = new THREE.MeshLambertMaterial({ color: '#2a3545' });

/** Field card: 63×89 box with scan and back; floop = 90° counter-clockwise rotation with 3D lift. */
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
  const holder = useRef<THREE.Group>(null); // position: base slot or following drag
  const group = useRef<THREE.Group>(null); // floop rotation & 3D hop
  const ring = useRef<THREE.Mesh>(null);
  const pendingPress = useRef<{ startX: number; startY: number } | null>(null);
  const prevFlipped = useRef<boolean>(card.flipped);
  const flipAnimStart = useRef<number | null>(null);
  const baseTarget = useMemo(() => new THREE.Vector3(), []);
  const texture = useMemo(() => cardTexture(card.cardId), [card.cardId]);
  const back = useMemo(() => cardBackTexture(), []);
  const materials = useMemo(
    () => [
      sharedEdgeMat, // +x
      sharedEdgeMat, // -x
      new THREE.MeshLambertMaterial({ map: texture }), // +y (face)
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

  const basePosition = useMemo<[number, number, number]>(
    () => [0, CARD_T / 2 + 0.4, slotLocalZ(slot)],
    [slot],
  );
  const me = view.players[view.me]!;
  const myMain =
    view.activePlayers.includes(view.me) &&
    !me.battleReady &&
    view.status === 'running' &&
    view.phase === 'main';

  const cardMeta = useMemo(() => catalog.find((c) => c.id === card.cardId), [card.cardId]);
  const activeMeta = useMemo(() => cardMeta?.abilities?.find((a) => a.kind === 'active') ?? null, [cardMeta]);
  const ability = activeAbilityOf(card.cardId);
  const hasAbility = ability !== null;
  const abilityCost = activeMeta?.cost ?? 0;
  const firstRoundForbidden =
    view.round === 1 && (view.mode === 'teams' || view.activePlayer === view.order[0]);

  const canDrag = isMe && myMain; // drag from field: discard by dragging to the discard pile
  const canHold = canDrag && hasAbility && !card.flipped && !firstRoundForbidden && me.actions >= abilityCost;
  const slotZ = slotLocalZ(slot);
  const invalidate = useThree((s) => s.invalidate);

  // Trigger 3D hop + spin animation whenever `card.flipped` changes.
  useEffect(() => {
    if (prevFlipped.current !== card.flipped) {
      prevFlipped.current = card.flipped;
      flipAnimStart.current = performance.now();
      invalidate();
    }
  }, [card.flipped, invalidate]);

  // Hold -> drag: pointer movement past the threshold cancels floop and starts drag;
  // releasing the pointer anywhere cancels the hold.
  useEffect(() => {
    if (!canDrag) return;
    const onMove = (e: PointerEvent) => {
      const press = pendingPress.current;
      if (!press) return;
      if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      pendingPress.current = null;
      setUi({
        holdingFloop: null,
        dragging: card.instanceId,
        draggingFrom: 'field',
        draggingOverZone: null,
        draggingOverDiscard: false,
        dragPoint: null,
      });
    };
    const onUp = () => {
      pendingPress.current = null;
      const holding = useGame.getState().ui.holdingFloop;
      if (holding?.instanceId === card.instanceId) {
        setUi({ holdingFloop: null });
      }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [canDrag, card.instanceId]);

  useFrame(() => {
    const now = performance.now();
    const ui = useGame.getState();
    const holding = ui.ui.holdingFloop;
    const isHoldingMe = holding?.instanceId === card.instanceId;
    const holdElapsed = isHoldingMe ? now - holding!.startedAt : 0;
    const holdProgress = isHoldingMe ? Math.min(1, holdElapsed / HOLD_MS) : 0;

    // Floop: counter-clockwise 90° rotation + 3D hop animation when flipping/unflipping.
    if (group.current) {
      const targetRot = card.flipped ? Math.PI / 2 : 0;
      const diffRot = targetRot - group.current.rotation.y;

      let hopY = 0;
      let tiltX = 0;
      let tiltZ = 0;
      if (flipAnimStart.current !== null) {
        const ft = Math.min(1, (now - flipAnimStart.current) / FLIP_ANIM_MS);
        hopY = Math.sin(ft * Math.PI) * 32;
        tiltX = -Math.sin(ft * Math.PI) * 0.28;
        tiltZ = Math.sin(ft * Math.PI * 2) * 0.32;
        if (ft >= 1) flipAnimStart.current = null;
        invalidate();
      } else if (isHoldingMe && canHold) {
        // Subtle lift while charging floop
        hopY = holdProgress * 12;
        tiltX = -holdProgress * 0.1;
      }

      group.current.position.y = hopY;
      group.current.rotation.x = tiltX;
      group.current.rotation.z = tiltZ;

      if (Math.abs(diffRot) > 0.004) {
        group.current.rotation.y += diffRot * 0.22;
        invalidate();
      } else {
        group.current.rotation.y = targetRot;
      }
    }

    // Drag from field: card lifts and follows the pointer (world -> local).
    if (holder.current) {
      const draggingMe =
        ui.ui.dragging === card.instanceId && ui.ui.draggingFrom === 'field' && ui.ui.dragPoint;
      if (draggingMe) {
        const target = new THREE.Vector3(ui.ui.dragPoint!.x, DRAG_LIFT_Y, ui.ui.dragPoint!.z);
        holder.current.parent!.worldToLocal(target);
        if (holder.current.position.distanceTo(target) > 0.1) {
          holder.current.position.lerp(target, 0.35);
          invalidate();
        }
      } else {
        baseTarget.set(basePosition[0], basePosition[1], basePosition[2]);
        if (holder.current.position.distanceTo(baseTarget) > 0.1) {
          holder.current.position.lerp(baseTarget, 0.3);
          invalidate();
        } else {
          holder.current.position.copy(baseTarget);
        }
      }
    }

    // Hold progress ring; at full circle — trigger floop (or explain why floop is unavailable).
    if (ring.current) {
      ring.current.visible = isHoldingMe;
      if (isHoldingMe) {
        const material = ring.current.material as THREE.MeshBasicMaterial;
        if (canHold) {
          material.color.set('#48d9a0');
          const s = 0.4 + holdProgress * 0.9;
          ring.current.scale.set(s, s, s);
          material.opacity = 0.4 + holdProgress * 0.55;
          invalidate();
          if (holdProgress >= 1) {
            pendingPress.current = null;
            setUi({ holdingFloop: null });
            if (ability && (ability.targets?.length ?? 0) > 0) {
              const state = startForActive(view, 'floop', card.instanceId, card.cardId);
              if (state) {
                setUi({ targeting: state });
                return;
              }
            }
            sendCommand({ type: 'floop', player: view.me, instanceId: card.instanceId });
          }
        } else {
          material.color.set('#f6ad55');
          const p = Math.min(1, holdElapsed / HINT_HOLD_MS);
          const s = 0.4 + p * 0.55;
          ring.current.scale.set(s, s, s);
          material.opacity = 0.45 + p * 0.4;
          invalidate();
          if (holdElapsed >= HINT_HOLD_MS) {
            pendingPress.current = null;
            setUi({ holdingFloop: null });
            if (card.flipped) {
              showHint('Эта карта уже флипнута в этом ходу');
            } else if (!hasAbility) {
              showHint(`У карты «${cardMeta?.name ?? card.cardId}» нет активного Флюпа («ПРИЕМ») — её способность пассивная`);
            } else if (firstRoundForbidden) {
              showHint('По правилам первого круга первый игрок не может делать Флюп');
            } else if (me.actions < abilityCost) {
              showHint(`Недостаточно действий для Флюпа (нужно: ${abilityCost})`);
            }
          }
        }
      }
    }
  });

  // Target selection mode: clicking a valid creature passes it to targeting.
  const targeting = useGame((st) => st.ui.targeting);
  const currentAsk = targeting ? targeting.asks[targeting.askIndex] : undefined;
  const isTarget =
    targeting && currentAsk && currentAsk.kind.includes('creature')
      ? validTargets(view, currentAsk, targeting.sourceInstanceId, targeting.collected).some(
          (c) => c.kind === 'creature' && c.instanceId === card.instanceId,
        )
      : false;

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
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
    if (event.nativeEvent.button !== 0) return;
    if (!canDrag || useGame.getState().ui.targeting) return;
    event.stopPropagation();
    pendingPress.current = { startX: event.nativeEvent.clientX, startY: event.nativeEvent.clientY };
    setUi({
      holdingFloop: {
        instanceId: card.instanceId,
        startedAt: performance.now(),
        startX: event.nativeEvent.clientX,
        startY: event.nativeEvent.clientY,
      },
      selectedHand: null,
    });
  };

  const cancelHold = () => {
    pendingPress.current = null;
    const holding = useGame.getState().ui.holdingFloop;
    if (holding?.instanceId === card.instanceId) setUi({ holdingFloop: null });
  };

  return (
    <group ref={holder} position={basePosition}>
      <group ref={group} onClick={handleClick} onPointerDown={startHold} onPointerUp={cancelHold}>
        <mesh material={materials}>
          <boxGeometry args={[CARD_W, CARD_T, CARD_H]} />
        </mesh>
        {/* Hitbox plane above tokens so holding/clicking the center of a damaged card never misses */}
        <mesh position={[0, CARD_T + TOKEN_T + 1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[CARD_W + 6, CARD_H + 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      {canDrag && (
        <mesh ref={ring} position={[0, 18, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false} raycast={() => null}>
          <ringGeometry args={[42, 52, 36]} />
          <meshBasicMaterial color="#48d9a0" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
      {isTarget && (
        <mesh position={[0, 2, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <planeGeometry args={[CARD_W + 12, CARD_H + 12]} />
          <meshBasicMaterial color="#7fd1ff" transparent opacity={0.3} />
        </mesh>
      )}
      {card.damage > 0 && <DamagePile instanceId={card.instanceId} damage={card.damage} slotZ={slotZ} />}
      {card.shield > 0 && <ShieldBadge shield={card.shield} />}
    </group>
  );
}

/** "1"/"3" token mesh (also used for hero lives). */
function TokenMesh({ face, y }: { face: 1 | 3; y: number }) {
  return (
    <mesh position={[0, y, 0]} raycast={() => null}>
      <cylinderGeometry args={[TOKEN_D / 2, TOKEN_D / 2, TOKEN_T, 20]} />
      <meshLambertMaterial map={tokenTexture(face)} />
    </mesh>
  );
}
export { TokenMesh };

/** Frost token on a land. */
export function FrostToken() {
  return (
    <mesh position={[0, 6, 0]} raycast={() => null}>
      <cylinderGeometry args={[FROST_D / 2, FROST_D / 2, TOKEN_T, 20]} />
      <meshLambertMaterial map={frostTexture()} />
    </mesh>
  );
}

function ShieldBadge({ shield }: { shield: number }) {
  void shield;
  return (
    <mesh position={[-CARD_W / 2 + 8, 6, -CARD_H / 2 + 12]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <circleGeometry args={[11, 20]} />
      <meshBasicMaterial color="#7fd1ff" transparent opacity={0.9} />
    </mesh>
  );
}
