import { useMemo } from 'react';
import * as THREE from 'three';
import { NO_RAYCAST, picnicPropOffsetsFor, playmatSizeFor } from './layout';
import { useGame } from '../../store';

type PropType = 'soda' | 'chips' | 'mug' | 'snail';

let cachedWoodTexture: THREE.CanvasTexture | null = null;
let cachedFeltTexture: THREE.CanvasTexture | null = null;
const propCache = new Map<PropType, THREE.CanvasTexture>();

function getFeltMatTexture(): THREE.CanvasTexture {
  if (cachedFeltTexture) return cachedFeltTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Green felt base with rounded corners
  ctx.fillStyle = '#5c7a59';
  ctx.beginPath();
  ctx.roundRect(12, 12, canvas.width - 24, canvas.height - 24, 28);
  ctx.fill();

  // Subtle woven cross-hatch fabric grain clipped inside felt
  ctx.save();
  ctx.clip();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
  for (let i = 12; i < canvas.width - 12; i += 8) {
    ctx.beginPath();
    ctx.moveTo(i, 12);
    ctx.lineTo(i, canvas.height - 12);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)';
  for (let j = 12; j < canvas.height - 12; j += 8) {
    ctx.beginPath();
    ctx.moveTo(12, j);
    ctx.lineTo(canvas.width - 12, j);
    ctx.stroke();
  }
  ctx.restore();

  // Dark ink border
  ctx.beginPath();
  ctx.roundRect(12, 12, canvas.width - 24, canvas.height - 24, 28);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#3b2921';
  ctx.stroke();

  // Dashed craft stitching border (docs/AUDIT-KIBERBUS-UIUX.md §4.3)
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(179, 204, 163, 0.9)';
  ctx.setLineDash([16, 12]);
  ctx.beginPath();
  ctx.roundRect(28, 28, 968, 968, 22);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  cachedFeltTexture = texture;
  return texture;
}

function getWoodTableTexture(): THREE.CanvasTexture {
  if (cachedWoodTexture) return cachedWoodTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  const planks = ['#7a5236', '#875c3b', '#704a30'];
  const seamColor = '#3d261a';
  const plankH = 128;

  // Draw alternating wooden planks
  for (let y = 0; y < canvas.height; y += plankH) {
    const plankIdx = Math.floor(y / plankH) % planks.length;
    ctx.fillStyle = planks[plankIdx]!;
    ctx.fillRect(0, y, canvas.width, plankH);

    // Dark seam line between planks
    ctx.fillStyle = seamColor;
    ctx.fillRect(0, y + plankH - 4, canvas.width, 4);

    // Subtle wood grain lines
    ctx.strokeStyle = 'rgba(40, 24, 15, 0.12)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      const lineY = y + 16 + i * 18;
      ctx.moveTo(0, lineY);
      for (let x = 0; x <= canvas.width; x += 40) {
        const wave = Math.sin(x * 0.015 + y * 0.05) * 5;
        ctx.lineTo(x, lineY + wave);
      }
      ctx.stroke();
    }
  }

  // Soft vignette around edges
  const grad = ctx.createRadialGradient(512, 512, 350, 512, 512, 720);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(30, 15, 8, 0.45)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  cachedWoodTexture = texture;
  return texture;
}

function createPropTexture(type: PropType): THREE.CanvasTexture {
  const cached = propCache.get(type);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  if (type === 'soda') {
    // Total Soda can
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.roundRect(32, 20, 64, 88, 12);
    ctx.fill();
    ctx.strokeStyle = '#3b2921';
    ctx.lineWidth = 3;
    ctx.stroke();

    // White diagonal banner
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(32, 52, 64, 24);
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TOTAL', 64, 69);
  } else if (type === 'chips') {
    // Crunch Chips bag
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(28, 24);
    ctx.lineTo(100, 24);
    ctx.lineTo(92, 104);
    ctx.lineTo(36, 104);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3b2921';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#b45309';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CRUNCH', 64, 68);
  } else if (type === 'mug') {
    // Cool Guy mug
    ctx.fillStyle = '#f3f4f6';
    ctx.beginPath();
    ctx.roundRect(36, 32, 56, 72, 8);
    ctx.fill();
    ctx.strokeStyle = '#3b2921';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Mug handle
    ctx.beginPath();
    ctx.arc(92, 68, 14, -Math.PI / 2, Math.PI / 2);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = '#3b2921';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Sunglasses doodle
    ctx.fillStyle = '#111827';
    ctx.fillRect(48, 56, 14, 10);
    ctx.fillRect(66, 56, 14, 10);
    ctx.fillRect(60, 58, 8, 3);
  } else if (type === 'snail') {
    // The iconic Adventure Time waving snail
    ctx.fillStyle = '#84cc16';
    // Snail body
    ctx.beginPath();
    ctx.ellipse(64, 84, 28, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // Snail shell
    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.arc(54, 68, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Snail head and waving hand
    ctx.fillStyle = '#84cc16';
    ctx.beginPath();
    ctx.arc(88, 72, 11, 0, Math.PI * 2);
    ctx.fill();

    // Cute eyes
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(92, 70, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Waving paw
    ctx.fillStyle = '#84cc16';
    ctx.beginPath();
    ctx.arc(98, 62, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  propCache.set(type, texture);
  return texture;
}

/**
 * Wooden Tabletop and Picnic Prop Billboards around the battlefield.
 * (docs/AUDIT-KIBERBUS-UIUX.md §1, §3.2, §8 Этап 4).
 */
export function TableMesh() {
  const matSize = useGame((s) => playmatSizeFor(s.view));
  const { x: propX, z: propZ } = picnicPropOffsetsFor(matSize);

  const woodTexture = useMemo(() => getWoodTableTexture(), []);
  const feltTexture = useMemo(() => getFeltMatTexture(), []);
  const sodaTexture = useMemo(() => createPropTexture('soda'), []);
  const chipsTexture = useMemo(() => createPropTexture('chips'), []);
  const mugTexture = useMemo(() => createPropTexture('mug'), []);
  const snailTexture = useMemo(() => createPropTexture('snail'), []);

  return (
    <group position={[0, -2, 0]} raycast={NO_RAYCAST}>
      {/* Wooden Table Base Plane (visible around the felt mat) */}
      <mesh position={[0, -7, 0]} receiveShadow>
        <boxGeometry args={[3200, 10, 3200]} />
        <meshLambertMaterial map={woodTexture} />
      </mesh>

      {/* Craft Stitched Green Felt Playmat Mat enclosing card lanes & decks */}
      <mesh position={[0, -1, 0]} receiveShadow>
        <boxGeometry args={[matSize, 2, matSize]} />
        <meshLambertMaterial map={feltTexture} transparent />
      </mesh>

      {/* Picnic Props positioned at table corners/perimeters outside card lanes */}
      {/* Total Soda Can - Top Left */}
      <group position={[-propX, 32, -propZ]}>
        <mesh rotation={[-Math.PI / 4, 0, 0]}>
          <planeGeometry args={[70, 70]} />
          <meshBasicMaterial map={sodaTexture} transparent side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Crunch Chips Bag - Bottom Left */}
      <group position={[-propX, 32, propZ]}>
        <mesh rotation={[-Math.PI / 4, 0, 0]}>
          <planeGeometry args={[75, 75]} />
          <meshBasicMaterial map={chipsTexture} transparent side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Cool Guy Mug - Top Right */}
      <group position={[propX, 32, -propZ]}>
        <mesh rotation={[-Math.PI / 4, 0, 0]}>
          <planeGeometry args={[72, 72]} />
          <meshBasicMaterial map={mugTexture} transparent side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Waving Snail Easter Egg - Bottom Right Corner */}
      <group position={[propX, 28, propZ]}>
        <mesh rotation={[-Math.PI / 4, 0, 0]}>
          <planeGeometry args={[65, 65]} />
          <meshBasicMaterial map={snailTexture} transparent side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}
