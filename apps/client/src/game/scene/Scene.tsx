import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../../store';
import { cameraOrbitFor, cameraTargetPlayer, cameraTurnEase } from './layout';
import { PlayerBoard } from './PlayerBoard';
import { Hand } from './Hand';
import { AnimDriver, AnimLayer, hasActiveAnims } from './AnimLayer';
import { subscribeImageLoads } from './textures';

const CAMERA_TURN_DURATION_MS = 920;
const MIN_PITCH = 0.24; // ~14° above table plane
const MAX_PITCH = 1.42; // ~81° almost top-down
const MIN_ZOOM_SCALE = 0.42; // zoom in up to ~2.4x closer
const MAX_ZOOM_SCALE = 1.85; // zoom out up to 1.85x further

/**
 * 3D-сцена — декларативная функция снапшота (docs/UI-3D.md): сцена строится из
 * view, анимации-призраки проигрываются поверх. Рендер по требованию:
 * когда ничего не происходит, кадры не рисуются.
 */
export function Scene() {
  const view = useGame((s) => s.view);
  const quality = useGame((s) => s.ui.quality);
  if (!view) return null;

  return (
    <Canvas
      shadows={quality === 'high'}
      dpr={quality === 'high' ? [1, 1.5] : 1}
      frameloop="demand"
      camera={{ position: [0, 540, 620], fov: 43, near: 20, far: 4500 }}
      gl={{ antialias: quality === 'high', powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#10141b']} />
      <SceneContent />
      <CameraRig />
      <LoopController />
      <ImageLoadTicker />
    </Canvas>
  );
}

/** Догрузка сканов карт асинхронна — каждый завершившийся груз перерисовывает кадр. */
function ImageLoadTicker() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => subscribeImageLoads(() => invalidate()), [invalidate]);
  return null;
}

function SceneContent() {
  const view = useGame((s) => s.view);
  const quality = useGame((s) => s.ui.quality);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  // Dev-превью (?scene=1): доступ к three-сцене из консоли для отладки раскладки.
  useEffect(() => {
    if (new URLSearchParams(location.search).has('scene')) {
      Object.assign(window as unknown as Record<string, unknown>, {
        __cwScene: scene,
        __cwCam: camera,
        __cwGl: gl,
        __cwThree: THREE,
      });
    }
  }, [scene, camera, gl]);

  if (!view) return null;
  // Мой ряд рисуется последним, чтобы быть поверх соседних досок.
  const order = [...view.order].sort((a, b) => (a === view.me ? 1 : b === view.me ? -1 : 0));

  return (
    <>
      <ambientLight intensity={1.15} />
      <directionalLight
        position={[180, 600, 320]}
        intensity={1.55}
        castShadow={quality === 'high'}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
      />
      {/* стол: разнесённые по высоте уровни без наложения плоскостей (никакого Z-fighting при вращении камеры) */}
      <mesh position={[0, -9, 0]} raycast={() => null}>
        <boxGeometry args={[2800, 10, 2800]} />
        <meshLambertMaterial color="#274232" />
      </mesh>
      <mesh position={[0, -2, 0]} receiveShadow={quality === 'high'} raycast={() => null}>
        <boxGeometry args={[2700, 2, 2700]} />
        <meshLambertMaterial color="#2e5240" />
      </mesh>

      {order.map((pid) => (
        <PlayerBoard key={pid} view={view} pid={pid} isMe={pid === view.me} />
      ))}

      <Hand view={view} />
      <AnimDriver />
      <AnimLayer />
    </>
  );
}

/**
 * Camera anchored at the table center (docs/UI-3D.md):
 * - in `follow` mode, orbits around the center to the active player's side on turn change
 *   with acceleration, sharp braking, and rollback (`cameraTurnEase`);
 * - in `self` mode, defaults to the player's own side;
 * - holding Right Mouse Button (RMB) freely rotates the camera (azimuth + pitch) around the table,
 *   and scrolling the mouse wheel zooms in and out.
 */
function CameraRig() {
  const view = useGame((s) => s.view);
  const cameraMode = useGame((s) => s.ui.cameraMode);
  const { camera, gl, size, invalidate } = useThree();

  const currentAngleRef = useRef<number | null>(null);
  const pitchOffsetRef = useRef(0);
  const zoomScaleRef = useRef(1);
  const lastTargetKeyRef = useRef<string | null>(null);
  const rmbDragRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const animRef = useRef<{
    fromAngle: number;
    deltaAngle: number;
    startAt: number;
    durationMs: number;
  } | null>(null);
  const lookAtVec = useRef(new THREE.Vector3());

  const applyCameraAtAngle = (angle: number, radius: number, height: number, lookOffset: number, fov: number) => {
    const aspect = size.width / Math.max(1, size.height);
    // Smoothly pull the camera back when the window is narrow (e.g. side-by-side split screen
    // or portrait) without changing FOV, so both browsers keep the exact same lens perspective
    // and the full board (Deck — 4 Lands — Discard) always fits horizontally.
    const fitScale = aspect < 1.35 ? Math.min(1.75, 1.35 / Math.max(0.55, aspect)) : 1;
    const baseDist = Math.hypot(radius, height) * fitScale;
    const basePitch = Math.atan2(height, radius);
    const pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, basePitch + pitchOffsetRef.current));
    const dist = baseDist * zoomScaleRef.current;

    const horizR = dist * Math.cos(pitch);
    const h = dist * Math.sin(pitch);
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    camera.position.set(horizR * sin, h, horizR * cos);
    lookAtVec.current.set(lookOffset * sin, 0, lookOffset * cos);
    camera.lookAt(lookAtVec.current);
    camera.updateMatrixWorld();
    if (camera instanceof THREE.PerspectiveCamera) {
      if (camera.fov !== fov || Math.abs(camera.aspect - aspect) > 1e-4) {
        camera.fov = fov;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
    }
  };

  // Right Mouse Button (RMB) free orbit & Mouse Wheel zoom.
  useEffect(() => {
    const dom = gl.domElement;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      e.preventDefault();
      animRef.current = null;
      rmbDragRef.current = { lastX: e.clientX, lastY: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      const drag = rmbDragRef.current;
      if (!drag) return;
      const v = useGame.getState().view;
      const mode = useGame.getState().ui.cameraMode;
      if (!v) return;
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;

      const orbit = cameraOrbitFor(v, mode);
      const basePitch = Math.atan2(orbit.height, orbit.radius);
      const nextAngle = (currentAngleRef.current ?? orbit.angle) - dx * 0.0065;
      currentAngleRef.current = nextAngle;
      pitchOffsetRef.current = Math.max(
        MIN_PITCH - basePitch,
        Math.min(MAX_PITCH - basePitch, pitchOffsetRef.current + dy * 0.0055),
      );
      applyCameraAtAngle(nextAngle, orbit.radius, orbit.height, orbit.lookOffset, orbit.fov);
      invalidate();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 2 || rmbDragRef.current) {
        rmbDragRef.current = null;
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = useGame.getState().view;
      const mode = useGame.getState().ui.cameraMode;
      if (!v) return;
      const orbit = cameraOrbitFor(v, mode);
      zoomScaleRef.current = Math.max(
        MIN_ZOOM_SCALE,
        Math.min(MAX_ZOOM_SCALE, zoomScaleRef.current * Math.exp(e.deltaY * 0.0011)),
      );
      const angle = currentAngleRef.current ?? orbit.angle;
      applyCameraAtAngle(angle, orbit.radius, orbit.height, orbit.lookOffset, orbit.fov);
      invalidate();
    };

    dom.addEventListener('contextmenu', onContextMenu);
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      dom.removeEventListener('contextmenu', onContextMenu);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [gl, size.width, size.height, invalidate]);

  useEffect(() => {
    if (!view) return;
    const orbit = cameraOrbitFor(view, cameraMode);
    const targetPid = cameraTargetPlayer(view, cameraMode);
    const targetKey = `${targetPid}|${cameraMode}`;

    if (currentAngleRef.current === null) {
      currentAngleRef.current = orbit.angle;
      lastTargetKeyRef.current = targetKey;
      applyCameraAtAngle(orbit.angle, orbit.radius, orbit.height, orbit.lookOffset, orbit.fov);
      invalidate();
      return;
    }

    // Only start an automatic turn/mode orbit transition when the target player or camera mode changed.
    if (lastTargetKeyRef.current !== targetKey) {
      lastTargetKeyRef.current = targetKey;
      const from = currentAngleRef.current;
      let delta = Math.atan2(Math.sin(orbit.angle - from), Math.cos(orbit.angle - from));
      // For an exact 180-degree turn, always orbit in a consistent circular direction.
      if (Math.abs(Math.abs(delta) - Math.PI) < 0.02) {
        delta = Math.PI;
      }

      if (Math.abs(delta) > 0.015) {
        animRef.current = {
          fromAngle: from,
          deltaAngle: delta,
          startAt: performance.now(),
          durationMs: CAMERA_TURN_DURATION_MS,
        };
        invalidate();
        return;
      }
      currentAngleRef.current = orbit.angle;
      animRef.current = null;
    }

    if (!animRef.current) {
      applyCameraAtAngle(currentAngleRef.current, orbit.radius, orbit.height, orbit.lookOffset, orbit.fov);
      invalidate();
    }
  }, [view, cameraMode, size.width, size.height, invalidate]);

  useFrame(() => {
    if (!view) return;
    const anim = animRef.current;
    if (!anim) return;
    const orbit = cameraOrbitFor(view, cameraMode);
    const elapsed = performance.now() - anim.startAt;
    const t = Math.min(1, elapsed / anim.durationMs);
    const eased = cameraTurnEase(t);
    const angle = anim.fromAngle + anim.deltaAngle * eased;
    currentAngleRef.current = angle;
    applyCameraAtAngle(angle, orbit.radius, orbit.height, orbit.lookOffset, orbit.fov);
    if (t >= 1) {
      currentAngleRef.current = orbit.angle;
      animRef.current = null;
    }
    invalidate();
  });

  return null;
}

/** demand-рендер: активен, пока есть активные анимации, драг или зажатие флюпа. */
function LoopController() {
  useFrame(({ invalidate }) => {
    const ui = useGame.getState().ui;
    const busy = hasActiveAnims() || ui.dragging !== null || ui.holdingFloop !== null;
    if (busy) invalidate();
  });
  return null;
}
