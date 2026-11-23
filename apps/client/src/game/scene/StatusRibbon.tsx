import { useMemo } from 'react';
import * as THREE from 'three';
import { NO_RAYCAST } from './layout';

const ribbonCache = new Map<string, THREE.CanvasTexture>();

function getRibbonTexture(text: string, bgColor: string, borderColor: string): THREE.CanvasTexture {
  const key = `${text}:${bgColor}:${borderColor}`;
  const cached = ribbonCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d')!;

  // Background box with rounded corners
  const r = 16;
  const w = 256;
  const h = 72;
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, h - 8, r);
  ctx.fill();

  // Dark ink border
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#3b2921';
  ctx.stroke();

  // Dashed stitch border inside
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = borderColor;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.roundRect(10, 10, w - 20, h - 20, r - 4);
  ctx.stroke();

  // Bold Russian text
  ctx.setLineDash([]);
  ctx.font = '900 34px "Balsamiq Sans", cursive, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Ink drop shadow
  ctx.fillStyle = '#3b2921';
  ctx.fillText(text, w / 2 + 2, h / 2 + 2);

  // Text fill
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, w / 2, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  ribbonCache.set(key, texture);
  return texture;
}

/**
 * 3D Status Ribbon ("ФЛЮП", "АТАКОВАЛ") rendered above turned/flooped creatures.
 * (docs/AUDIT-KIBERBUS-UIUX.md §3.2, §5.1, §8 Этап 4).
 */
export function StatusRibbon({ status }: { status: 'floop' | 'attack' }) {
  const isAttack = status === 'attack';
  const text = isAttack ? 'АТАКОВАЛ' : 'ФЛЮП';
  const bgColor = isAttack ? '#e34538' : '#45ad54';
  const stitchColor = isAttack ? '#fca5a5' : '#bbf7d0';

  const texture = useMemo(() => getRibbonTexture(text, bgColor, stitchColor), [text, bgColor, stitchColor]);

  return (
    <group position={[0, 16, 0]} rotation={[-Math.PI / 4, 0, 0]} raycast={NO_RAYCAST}>
      <mesh>
        <planeGeometry args={[48, 14]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
