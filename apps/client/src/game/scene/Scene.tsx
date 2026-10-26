import { useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../../store';
import { CAMERA } from './layout';
import { PlayerBoard } from './PlayerBoard';
import { Hand } from './Hand';
import { AnimDriver, AnimLayer, hasActiveAnims } from './AnimLayer';

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
      camera={{ position: [...CAMERA.position], fov: CAMERA.fov }}
      gl={{ antialias: quality === 'high' }}
    >
      <color attach="background" args={['#10141b']} />
      <SceneContent />
      <LoopController />
    </Canvas>
  );
}

function SceneContent() {
  const view = useGame((s) => s.view);
  const quality = useGame((s) => s.ui.quality);
  const three = useThree();

  useEffect(() => {
    three.camera.lookAt(new THREE.Vector3(...CAMERA.lookAt));
  }, [three.camera]);

  if (!view) return null;
  const opponentFirst = [...view.order].reverse();

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
      <mesh position={[0, -0.5, 20]} receiveShadow={quality === 'high'}>
        <boxGeometry args={[1900, 1, 1700]} />
        <meshLambertMaterial color="#274232" />
      </mesh>
      <mesh position={[0, 0.05, 20]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={quality === 'high'}>
        <planeGeometry args={[1800, 1600]} />
        <meshLambertMaterial color="#2e5240" />
      </mesh>

      {opponentFirst.map((pid) => (
        <PlayerBoard key={pid} view={view} pid={pid} isMe={pid === view.me} />
      ))}

      <Hand view={view} />
      <AnimDriver />
      <AnimLayer />
    </>
  );
}

/** demand-рендер: активен, пока есть анимации/драг/удержание/наведение. */
function LoopController() {
  useFrame(({ invalidate }) => {
    const ui = useGame.getState().ui;
    const busy = hasActiveAnims() || ui.dragging !== null || ui.holdingFloop !== null || ui.selectedHand !== null;
    if (busy) invalidate();
  });
  return null;
}
