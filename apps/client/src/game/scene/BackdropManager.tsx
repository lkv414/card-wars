import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { NO_RAYCAST } from './layout';

interface OooBackdrop {
  id: string;
  name: string;
  skyColor: string;
  horizonColor: string;
}

export const OOO_BACKDROPS: OooBackdrop[] = [
  { id: 'tree_fort', name: 'Дом на дереве', skyColor: '#1a365d', horizonColor: '#276749' },
  { id: 'daisies', name: 'Поляна маргариток', skyColor: '#2b2d42', horizonColor: '#4f772d' },
  { id: 'giant_tree', name: 'Гигантский дуб', skyColor: '#0f382c', horizonColor: '#1b4332' },
  { id: 'moon_lake', name: 'Лунное озеро', skyColor: '#0b132b', horizonColor: '#1c2541' },
  { id: 'starry_night', name: 'Звёздная ночь Ууу', skyColor: '#0a091a', horizonColor: '#1d1135' },
  { id: 'fireflies', name: 'Роща светлячков', skyColor: '#211510', horizonColor: '#4a2810' },
  { id: 'earth', name: 'Конфетный закат', skyColor: '#361527', horizonColor: '#5c1d38' },
];

/**
 * Dynamic Ooo Landscapes Backdrop Manager (docs/AUDIT-KIBERBUS-UIUX.md §2, §8 Этап 4).
 * Rotates through 7 authentic Land of Ooo backdrops with smooth 2.5s crossfades.
 */
export function BackdropManager() {
  const { scene, invalidate } = useThree();
  const currentIndexRef = useRef(0);
  const nextIndexRef = useRef(0);
  const fadeProgressRef = useRef(1); // 1 = fully current

  const currentColor = useRef(new THREE.Color(OOO_BACKDROPS[0]!.skyColor));
  const currentHorizon = useRef(new THREE.Color(OOO_BACKDROPS[0]!.horizonColor));
  const fromScratch = useRef(new THREE.Color());
  const toScratch = useRef(new THREE.Color());
  const domeMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useEffect(() => {
    scene.background = currentColor.current;
    invalidate();
  }, [scene, invalidate]);

  // Rotate backdrops every 20 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      nextIndexRef.current = (currentIndexRef.current + 1) % OOO_BACKDROPS.length;
      fadeProgressRef.current = 0;
      invalidate();
    }, 20000);
    return () => clearInterval(timer);
  }, [invalidate]);

  useFrame((_, delta) => {
    if (fadeProgressRef.current < 1) {
      const nextProgress = Math.min(1, fadeProgressRef.current + delta / 2.5); // 2.5s transition
      fadeProgressRef.current = nextProgress;

      const cur = OOO_BACKDROPS[currentIndexRef.current]!;
      const nxt = OOO_BACKDROPS[nextIndexRef.current]!;

      fromScratch.current.set(cur.skyColor);
      toScratch.current.set(nxt.skyColor);
      currentColor.current.copy(fromScratch.current).lerp(toScratch.current, nextProgress);

      fromScratch.current.set(cur.horizonColor);
      toScratch.current.set(nxt.horizonColor);
      currentHorizon.current.copy(fromScratch.current).lerp(toScratch.current, nextProgress);

      if (domeMatRef.current) {
        domeMatRef.current.color.copy(currentHorizon.current);
      }

      // Apply to Three.js scene background
      scene.background = currentColor.current;
      invalidate();

      if (nextProgress >= 1) {
        currentIndexRef.current = nextIndexRef.current;
      }
    }
  });

  return (
    <group raycast={NO_RAYCAST}>
      {/* Distant curved panorama dome */}
      <mesh position={[0, -200, 0]}>
        <cylinderGeometry args={[2900, 2900, 1600, 32, 1, true]} />
        <meshBasicMaterial
          ref={domeMatRef}
          color={currentHorizon.current}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
