import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  cycleCameraPlayer,
  setCameraMode,
  snapCameraPlayer,
  snapCameraTop,
  useGame,
} from '../../store';
import { NO_RAYCAST, cameraTurnEase } from './layout';
import { PlayerBoard } from './PlayerBoard';
import { Hand } from './Hand';
import { AnimDriver, AnimLayer, hasActiveAnims } from './AnimLayer';
import { CombatForecastLayer } from './CombatForecast';
import { disposeAllTextures, subscribeImageLoads } from './textures';
import {
  calculateCameraAnchor,
  classifySwipe,
  easeInOutCubic,
  interpolateCameraPose,
  isTopSnap,
  resolveTargetPlayer,
} from './cameraSnap';

const CAMERA_TRANSITION_MS = 680;
const MIN_ZOOM_SCALE = 0.55; // zoom in up to ~1.8x closer
const MAX_ZOOM_SCALE = 1.65; // zoom out up to 1.65x further

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

  // Очистка всех текстур WebGL при выходе из матча (docs/UI-3D.md, threejs-textures)
  useEffect(() => {
    return () => {
      disposeAllTextures();
    };
  }, []);

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
      <mesh position={[0, -9, 0]} raycast={NO_RAYCAST}>
        <boxGeometry args={[2800, 10, 2800]} />
        <meshLambertMaterial color="#274232" />
      </mesh>
      <mesh position={[0, -2, 0]} receiveShadow={quality === 'high'} raycast={NO_RAYCAST}>
        <boxGeometry args={[2700, 2, 2700]} />
        <meshLambertMaterial color="#2e5240" />
      </mesh>

      {order.map((pid) => (
        <PlayerBoard key={pid} view={view} pid={pid} isMe={pid === view.me} />
      ))}

      <Hand view={view} />
      <CombatForecastLayer view={view} />
      <AnimDriver />
      <AnimLayer />
    </>
  );
}

/**
 * Smart Camera Snap Point & Swipe Navigation System:
 * - Snap Points:
 *   * `top`: center of table looking straight down, orientation aligned with active/selected player.
 *   * `player_<pid>`: perspective view from that player's side facing the table center.
 * - Modes:
 *   * `follow`: transitions to active player on turn change (or re-orients top-down).
 *   * `manual`: stays locked to the chosen snap point ('top', specific player, etc.).
 * - Gesture & Swipe Navigation:
 *   * Swipe DOWN: transition to top-down view.
 *   * Swipe UP: transition back to perspective view.
 *   * Swipe LEFT / RIGHT: cycle to next / previous player around table.
 * - Keyboard: Arrow keys, WASD, Space (me), F (toggle follow).
 * - Wheel: zoom in / out with demand invalidation.
 */
function CameraRig() {
  const view = useGame((s) => s.view);
  const cameraMode = useGame((s) => s.ui.cameraMode);
  const cameraSnap = useGame((s) => s.ui.cameraSnap);
  const { camera, gl, size, invalidate } = useThree();

  const currentAngleRef = useRef<number | null>(null);
  const currentURef = useRef<number>(0); // 0 = perspective, 1 = top
  const zoomScaleRef = useRef<number>(1);
  const lastTargetKeyRef = useRef<string | null>(null);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    pointerId: number;
    triggered: boolean;
  } | null>(null);

  const animRef = useRef<{
    fromAngle: number;
    deltaAngle: number;
    fromU: number;
    deltaU: number;
    startAt: number;
    durationMs: number;
  } | null>(null);

  const applyCameraPose = (angle: number, u: number) => {
    if (!view) return;
    const aspect = size.width / Math.max(1, size.height);
    const pose = interpolateCameraPose(view, angle, u, aspect, zoomScaleRef.current);

    camera.position.copy(pose.position);
    camera.up.copy(pose.up);
    camera.lookAt(pose.lookAt);
    camera.updateMatrixWorld();

    if (camera instanceof THREE.PerspectiveCamera) {
      if (camera.fov !== pose.fov || Math.abs(camera.aspect - aspect) > 1e-4) {
        camera.fov = pose.fov;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
    }
  };

  const handleSwipeGesture = (direction: 'down' | 'up' | 'left' | 'right') => {
    const v = useGame.getState().view;
    if (!v) return;
    const snap = useGame.getState().ui.cameraSnap;
    const isTop = isTopSnap(snap, useGame.getState().ui.cameraMode);
    const targetPid = resolveTargetPlayer(v, useGame.getState().ui.cameraMode, snap);

    if (direction === 'down' || direction === 'up') {
      // Toggle altitude:
      // - In top-down view: lowers camera to that player's perspective ("опустить камеру")
      // - In perspective view: raises camera to top-down view
      if (isTop) {
        snapCameraPlayer(targetPid);
      } else {
        snapCameraTop(targetPid);
      }
    } else if (direction === 'right') {
      // Swipe left-to-right (dx > 0): user pulls in the player on the left
      cycleCameraPlayer('next');
    } else if (direction === 'left') {
      // Swipe right-to-left (dx < 0): user pulls in the player on the right
      cycleCameraPlayer('prev');
    }
  };

  // Pointer swipe / drag gestures and mouse wheel zoom
  useEffect(() => {
    const dom = gl.domElement;

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onPointerDown = (e: PointerEvent) => {
      const ui = useGame.getState().ui;
      if (ui.dragging !== null || ui.targeting !== null || ui.holdingFloop !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;

      gestureRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTime: performance.now(),
        pointerId: e.pointerId,
        triggered: false,
      };
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.triggered) return;
      if (e.pointerId !== gesture.pointerId) return;

      const ui = useGame.getState().ui;
      if (ui.dragging !== null || ui.targeting !== null || ui.holdingFloop !== null) {
        gestureRef.current = null;
        return;
      }

      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      const swipe = classifySwipe(dx, dy, 32);
      if (swipe) {
        gesture.triggered = true;
        handleSwipeGesture(swipe);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const gesture = gestureRef.current;
      if (gesture && e.pointerId === gesture.pointerId) {
        try {
          dom.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        if (!gesture.triggered) {
          const dx = e.clientX - gesture.startX;
          const dy = e.clientY - gesture.startY;
          const dt = performance.now() - gesture.startTime;
          const minDistance = dt < 450 ? 24 : 32;
          const swipe = classifySwipe(dx, dy, minDistance);
          if (swipe) {
            handleSwipeGesture(swipe);
          }
        }
      }
      gestureRef.current = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomScaleRef.current = Math.max(
        MIN_ZOOM_SCALE,
        Math.min(MAX_ZOOM_SCALE, zoomScaleRef.current * Math.exp(e.deltaY * 0.0011)),
      );
      if (currentAngleRef.current !== null) {
        applyCameraPose(currentAngleRef.current, currentURef.current);
      }
      invalidate();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const targetTag = (document.activeElement?.tagName || '').toUpperCase();
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return;

      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        handleSwipeGesture('down');
      } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        handleSwipeGesture('up');
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        cycleCameraPlayer('next');
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        cycleCameraPlayer('prev');
      } else if (e.key === 'f' || e.key === 'F') {
        const cur = useGame.getState().ui.cameraMode;
        setCameraMode(cur === 'follow' ? 'manual' : 'follow');
      } else if (e.key === ' ') {
        e.preventDefault();
        const v = useGame.getState().view;
        if (v) snapCameraPlayer(v.me);
      }
    };

    dom.addEventListener('contextmenu', onContextMenu);
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      dom.removeEventListener('contextmenu', onContextMenu);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [gl, size.width, size.height, invalidate]);

  // Synchronize target camera anchor with store state
  useEffect(() => {
    if (!view) return;
    const aspect = size.width / Math.max(1, size.height);
    const targetPid = resolveTargetPlayer(view, cameraMode, cameraSnap);
    const isTop = isTopSnap(cameraSnap, cameraMode);
    const anchor = calculateCameraAnchor(view, targetPid, isTop, aspect, zoomScaleRef.current);
    const targetKey = `${targetPid}|${isTop ? 'top' : 'persp'}|${cameraMode}`;

    if (currentAngleRef.current === null) {
      currentAngleRef.current = anchor.angle;
      currentURef.current = anchor.u;
      lastTargetKeyRef.current = targetKey;
      applyCameraPose(anchor.angle, anchor.u);
      invalidate();
      return;
    }

    if (lastTargetKeyRef.current !== targetKey) {
      lastTargetKeyRef.current = targetKey;
      const fromAngle = currentAngleRef.current;
      const fromU = currentURef.current;

      let deltaAngle = Math.atan2(
        Math.sin(anchor.angle - fromAngle),
        Math.cos(anchor.angle - fromAngle),
      );
      if (Math.abs(Math.abs(deltaAngle) - Math.PI) < 0.02) {
        deltaAngle = Math.PI;
      }
      const deltaU = anchor.u - fromU;

      if (Math.abs(deltaAngle) > 0.015 || Math.abs(deltaU) > 0.015) {
        animRef.current = {
          fromAngle,
          deltaAngle,
          fromU,
          deltaU,
          startAt: performance.now(),
          durationMs: CAMERA_TRANSITION_MS,
        };
        invalidate();
        return;
      }

      currentAngleRef.current = anchor.angle;
      currentURef.current = anchor.u;
      animRef.current = null;
    }

    if (!animRef.current) {
      applyCameraPose(currentAngleRef.current, currentURef.current);
      invalidate();
    }
  }, [view, cameraMode, cameraSnap, size.width, size.height, invalidate]);

  // Interpolate camera pose frame by frame during transition
  useFrame(() => {
    if (!view) return;
    const anim = animRef.current;
    if (!anim) return;

    const elapsed = performance.now() - anim.startAt;
    const t = Math.min(1, elapsed / anim.durationMs);
    const isAngleOnly = Math.abs(anim.deltaU) < 0.02;
    const tAngle = isAngleOnly ? cameraTurnEase(t) : easeInOutCubic(t);
    const tU = easeInOutCubic(t);

    const angle = anim.fromAngle + anim.deltaAngle * tAngle;
    const u = anim.fromU + anim.deltaU * tU;
    currentAngleRef.current = angle;
    currentURef.current = u;
    applyCameraPose(angle, u);

    if (t >= 1) {
      const aspect = size.width / Math.max(1, size.height);
      const targetPid = resolveTargetPlayer(view, cameraMode, cameraSnap);
      const isTop = isTopSnap(cameraSnap, cameraMode);
      const anchor = calculateCameraAnchor(view, targetPid, isTop, aspect, zoomScaleRef.current);
      currentAngleRef.current = anchor.angle;
      currentURef.current = anchor.u;
      animRef.current = null;
      applyCameraPose(anchor.angle, anchor.u);
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
