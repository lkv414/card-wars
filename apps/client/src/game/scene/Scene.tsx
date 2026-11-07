import { useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../../store';
import { cameraFor } from './layout';
import { PlayerBoard } from './PlayerBoard';
import { Hand } from './Hand';
import { AnimDriver, AnimLayer, hasActiveAnims } from './AnimLayer';
import { subscribeImageLoads } from './textures';

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
      dpr={quality === 'high' ? [1, 2] : 1}
      frameloop="demand"
      camera={{ position: [0, 560, 640], fov: 46, near: 1, far: 6000 }}
      gl={{ antialias: quality === 'high' }}
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
      <ambientLight intensity={1.1} />
      <directionalLight
        position={[180, 600, 320]}
        intensity={1.6}
        castShadow={quality === 'high'}
        shadow-mapSize={[1024, 1024]}
      />
      {/* стол: с запасом за краями доски, чтобы камера не видела фон */}
      <mesh position={[0, -0.5, 20]} receiveShadow={quality === 'high'} raycast={() => null}>
        <boxGeometry args={[2200, 1, 1900]} />
        <meshLambertMaterial color="#274232" />
      </mesh>
      <mesh position={[0, 0.05, 20]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={quality === 'high'} raycast={() => null}>
        <planeGeometry args={[2100, 1800]} />
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

/** Фиксированная камера за своей стороной; дальше и выше для 3–4 игроков и «стенки». */
function CameraRig() {
  const view = useGame((s) => s.view);
  const { camera, size, invalidate } = useThree();

  useEffect(() => {
    if (!view) return;
    const config = cameraFor(view);
    const portrait = size.height > size.width;
    const distanceScale = portrait ? 1.28 : 1;
    camera.position.set(
      config.position[0],
      config.position[1] * (portrait ? 1.12 : 1),
      config.position[2] * distanceScale,
    );
    camera.lookAt(new THREE.Vector3(...config.lookAt));
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = portrait ? config.fov + 16 : config.fov;
      camera.aspect = size.width / Math.max(1, size.height);
      camera.updateProjectionMatrix();
    }
    invalidate();
  }, [view, camera, size.width, size.height, invalidate]);

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
