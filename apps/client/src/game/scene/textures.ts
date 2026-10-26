import * as THREE from 'three';
import { cards as catalog } from '@card-wars/content';
import type { CardData, LandType } from '@card-wars/content';

// Canvas-generated card art (docs/UI-3D.md: гибрид — фреймы из данных, сканы позже).
// All textures are cached; one texture per card id serves every copy in play.

const cardCache = new Map<string, THREE.CanvasTexture>();
const tokenCache = new Map<string, THREE.CanvasTexture>();
const spriteCache = new Map<string, THREE.CanvasTexture>();

export const LAND_COLORS: Record<LandType, { bg: string; deep: string; label: string }> = {
  corn: { bg: '#d9a441', deep: '#8a5f1e', label: 'Кукуруза' },
  blue: { bg: '#4f86d4', deep: '#2a4f86', label: 'Море' },
  good: { bg: '#e58fb1', deep: '#a3536f', label: 'Добро' },
  ice: { bg: '#9fd8e8', deep: '#4f97ad', label: 'Лёд' },
  sand: { bg: '#d8c08a', deep: '#96803f', label: 'Пески' },
  swamp: { bg: '#6f8f5a', deep: '#3f5a32', label: 'Болото' },
  rainbow: { bg: '#b48ae0', deep: '#6f4fa0', label: 'Радуга' },
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, maxLines: number, lineH: number): void {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width > maxW && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = probe;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1]!;
    while (ctx.measureText(`${last}…`).width > maxW && last.length > 1) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
}

/** Card front: 512×722 canvas (63×89 proportion), rounded, cost/name/atk/def/text. */
export function cardTexture(cardId: string): THREE.CanvasTexture {
  const cached = cardCache.get(cardId);
  if (cached) return cached;
  const card: CardData | undefined = catalog.find((c) => c.id === cardId);
  const W = 512;
  const H = 722;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const theme = LAND_COLORS[card?.landType ?? 'rainbow'];

  ctx.clearRect(0, 0, W, H);
  roundRect(ctx, 6, 6, W - 12, H - 12, 30);
  ctx.save();
  ctx.clip();

  // background
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, theme.bg);
  grad.addColorStop(1, theme.deep);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // cost
  ctx.fillStyle = '#1c2430';
  ctx.beginPath();
  ctx.arc(64, 66, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(card?.cost ?? 0), 64, 70);

  // name
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#12161d';
  const name = card?.name ?? cardId;
  ctx.fillText(name.length > 18 ? `${name.slice(0, 17)}…` : name, W / 2 + 20, 66, W - 150);

  // art area
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  roundRect(ctx, 40, 120, W - 80, 320, 22);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 150px sans-serif';
  ctx.fillText(name.slice(0, 1).toUpperCase(), W / 2, 280);
  ctx.font = '28px sans-serif';
  ctx.fillStyle = 'rgba(18,22,29,0.75)';
  const typeLabel = card?.type === 'creature' ? 'Существо' : card?.type === 'building' ? 'Строение' : card?.type === 'spell' ? 'Заклинание' : 'Парная';
  ctx.fillText(typeLabel, W / 2, 408);

  // description
  ctx.fillStyle = '#f4f6f8';
  ctx.font = '26px sans-serif';
  ctx.textAlign = 'left';
  wrapText(ctx, card?.description ?? '', 42, 490, W - 84, 5, 34);

  // attack / defense
  if (card?.type === 'creature') {
    const stat = (x: number, value: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, H - 64, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 52px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(value), x, H - 60);
    };
    stat(74, card.attack ?? 0, '#b3402f');
    stat(W - 74, card.defense ?? 0, '#2f6fb3');
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  cardCache.set(cardId, texture);
  return texture;
}

/** Card back (рубашка) for face-down cards and deck piles. */
export function cardBackTexture(): THREE.CanvasTexture {
  const key = '__back__';
  const cached = cardCache.get(key);
  if (cached) return cached;
  const W = 512;
  const H = 722;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  roundRect(ctx, 6, 6, W - 12, H - 12, 30);
  ctx.save();
  ctx.clip();
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#27384f');
  grad.addColorStop(1, '#141d2b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(140,180,230,0.35)';
  ctx.lineWidth = 6;
  for (let i = -H; i < W + H; i += 46) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(220,235,255,0.9)';
  ctx.font = 'bold 120px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CW', W / 2, H / 2);
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cardCache.set(key, texture);
  return texture;
}

/** Damage token faces: «1» and «3» (docs/UI-3D.md «Жетоны»). */
export function tokenTexture(face: 1 | 3): THREE.CanvasTexture {
  const key = `token-${face}`;
  const cached = tokenCache.get(key);
  if (cached) return cached;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = face === 1 ? '#c94b3a' : '#8f2f56';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#f3d9d2';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(face), S / 2, S / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  tokenCache.set(key, texture);
  return texture;
}

export function frostTexture(): THREE.CanvasTexture {
  const key = 'frost';
  const cached = tokenCache.get(key);
  if (cached) return cached;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = '#bfe6f5';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#5aa7d1';
  ctx.stroke();
  ctx.strokeStyle = '#7fc4e0';
  ctx.lineWidth = 3;
  for (let a = 0; a < 6; a++) {
    const angle = (a / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2);
    ctx.lineTo(S / 2 + Math.cos(angle) * (S / 2 - 10), S / 2 + Math.sin(angle) * (S / 2 - 10));
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  tokenCache.set(key, texture);
  return texture;
}

/** Floating text sprite (damage numbers, +N). */
export function textSprite(text: string, color: string): THREE.CanvasTexture {
  const key = `text-${color}-${text}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const W = 256;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, W / 2, H / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, H / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  spriteCache.set(key, texture);
  return texture;
}

export function landTexture(type: LandType, frozen: boolean, flipped: boolean): THREE.CanvasTexture {
  const key = `land-${type}-${frozen ? 1 : 0}-${flipped ? 1 : 0}`;
  const cached = tokenCache.get(key);
  if (cached) return cached;
  const W = 256;
  const H = 360;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const theme = LAND_COLORS[type];
  roundRect(ctx, 4, 4, W - 8, H - 8, 18);
  ctx.save();
  ctx.clip();
  if (flipped) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#3a4250');
    grad.addColorStop(1, '#232933');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('?', W / 2, H / 2);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, theme.bg);
    grad.addColorStop(1, theme.deep);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0, 0, W, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(theme.label, W / 2, H - 26);
  }
  if (frozen) {
    ctx.fillStyle = 'rgba(160, 220, 245, 0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo((i * W) / 5, 0);
      ctx.lineTo((i * W) / 5 + 30, H);
      ctx.stroke();
    }
  }
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  tokenCache.set(key, texture);
  return texture;
}
