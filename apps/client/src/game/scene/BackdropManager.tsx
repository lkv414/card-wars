import { useEffect, useRef, useState } from 'react';
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextIndex, setNextIndex] = useState(1);
  const [fadeProgress, setFadeProgress] = useState(1); // 1 = fully current

  const currentColor = useRef(new THREE.Color(OOO_BACKDROPS[0]!.skyColor));
  const targetColor = useRef(new THREE.Color(OOO_BACKDROPS[0]!.skyColor));
  const currentHorizon = useRef(new THREE.Color(OOO_BACKDROPS[0]!.horizonColor));
  const targetHorizon = useRef(new THREE.Color(OOO_BACKDROPS[0]!.horizonColor));
  const domeMatRef = useRef<THREE.MeshBasicMaterial>(null);

  // Rotate backdrops every 20 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setNextIndex((prev) => (prev + 1) % OOO_BACKDROPS.length);
      setFadeProgress(0);
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  useFrame((_, delta) => {
    if (fadeProgress < 1) {
      const nextProgress = Math.min(1, fadeProgress + delta / 2.5); // 2.5s transition
      setFadeProgress(nextProgress);

      const fromSky = new THREE.Color(OOO_BACKDROPS[currentIndex]!.skyColor);
      const toSky = new THREE.Color(OOO_BACKDROPS[nextIndex]!.skyColor);
      currentColor.current.copy(fromSky).lerp(toSky, nextProgress);

      const fromHoriz = new THREE.Color(OOO_BACKDROPS[currentIndex]!.horizonColor);
      const toHoriz = new THREE.Color(OOO_BACKDROPS[nextIndex]!.horizonColor);
      currentHorizon.current.copy(fromHoriz).lerp(toHoriz, nextProgress);

      if (domeMatRef.current) {
        domeMatRef.current.color.copy(currentHorizon.current);
      }

      // Apply to Three.js scene background and fog
      scene.background = currentColor.current;
      invalidate();

      if (nextProgress >= 1) {
        setCurrentIndex(nextIndex);
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
