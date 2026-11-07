import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CARD_H, CARD_W, LAND_H, LAND_W, TOKEN_D, TOKEN_T } from './layout';
import { tokenTexture } from './textures';

// Кучка жетонов урона с клиентской физсимуляцией (docs/UI-3D.md «Жетоны урона
// и жизней»): жетоны падают на центр карты, отскакивают и раскатываются,
// при тесноте выкатываются на землю-тайл. Сторона выпадения предопределена
// жадным разложением (тройки + остаток единицами): 2 урона = «1»+«1»,
// ещё 1 урона — оба «1» исчезают и падает один «3». Симуляция детерминированная:
// сид из instanceId/урона/номера жетона, фиксированный шаг интегрирования.

const GRAVITY = 3200; // мм/с²
const DT = 1 / 60; // фиксированный шаг — одинаковый у всех клиентов
const RESTITUTION = 0.38;
const LEAVING_S = 0.42;

/** Отдых на карте: верх карты + половина толщины жетона (координаты группы карты). */
const CARD_REST_Y = 1.2 / 2 + TOKEN_T / 2;
/** Отдых на земле-тайле: верх тайла на толщину карты ниже верха карты. */
const LAND_REST_Y = CARD_REST_Y - 1.2;

/** Жадное разложение урона: floor(n/3) жетонов «3» + (n mod 3) «1». */
function decomposition(damage: number): Array<{ key: string; face: 1 | 3 }> {
  const tokens: Array<{ key: string; face: 1 | 3 }> = [];
  for (let i = 0; i < Math.floor(damage / 3); i++) tokens.push({ key: `3-${i}`, face: 3 });
  for (let i = 0; i < damage % 3; i++) tokens.push({ key: `1-${i}`, face: 1 });
  return tokens;
}

function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spawnToken(t: { key: string; face: 1 | 3 }, seedBase: string): TokenState {
  const rnd = mulberry32(hashString(`${seedBase}|${t.key}`));
  return {
    key: t.key,
    face: t.face,
    x: (rnd() - 0.5) * 20,
    z: (rnd() - 0.5) * 24,
    y: 55 + rnd() * 35,
    vx: (rnd() - 0.5) * 120,
    vz: (rnd() - 0.5) * 120,
    vy: -60 - rnd() * 90,
    angle: (rnd() - 0.5) * 0.8,
    spin: (rnd() - 0.5) * 5,
    settled: false,
  };
}

interface TokenState {
  key: string;
  face: 1 | 3;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  angle: number; // визуальное вращение грани вокруг вертикали
  spin: number;
  settled: boolean;
}

interface LeavingToken {
  key: string;
  face: 1 | 3;
  x: number;
  z: number;
  y: number;
  t: number;
}

/** Один фиксированный шаг симуляции; true, если кто-то ещё движется. */
function step(tokens: TokenState[], dt: number, zOrigin: number): boolean {
  let active = false;
  // Границы тайла в координатах группы карты (группа смещена к слоту на zOrigin).
  // Если это компаньон (вне тайлов), держим жетоны на самой карте.
  const isCompanion = zOrigin < -LAND_H / 2;
  const minX = -(LAND_W / 2 - TOKEN_D / 2);
  const maxX = LAND_W / 2 - TOKEN_D / 2;
  const minZ = isCompanion ? -(CARD_H / 2 - TOKEN_D / 2) : -LAND_H / 2 - zOrigin + TOKEN_D / 2;
  const maxZ = isCompanion ? CARD_H / 2 - TOKEN_D / 2 : LAND_H / 2 - zOrigin - TOKEN_D / 2;
  for (const t of tokens) {
    if (t.settled) continue;
    t.vy -= GRAVITY * dt;
    t.x += t.vx * dt;
    t.z += t.vz * dt;
    t.y += t.vy * dt;
    t.angle += t.spin * dt;
    t.spin *= 1 - 2.2 * dt;
    if (t.x < minX || t.x > maxX) {
      t.x = Math.max(minX, Math.min(maxX, t.x));
      t.vx *= -0.3;
    }
    if (t.z < minZ || t.z > maxZ) {
      t.z = Math.max(minZ, Math.min(maxZ, t.z));
      t.vz *= -0.3;
    }
    const onCard = Math.abs(t.x) <= CARD_W / 2 && Math.abs(t.z) <= CARD_H / 2;
    const rest = onCard ? CARD_REST_Y : LAND_REST_Y;
    if (t.y <= rest) {
      t.y = rest;
      if (t.vy < -110) {
        t.vy = -t.vy * RESTITUTION;
        t.vx *= 0.55;
        t.vz *= 0.55;
      } else {
        t.vy = 0;
        t.vx *= 0.75;
        t.vz *= 0.75;
        if (Math.hypot(t.vx, t.vz) < 8) {
          t.vx = 0;
          t.vz = 0;
          t.spin = 0;
          t.settled = true;
        }
      }
    }
    if (!t.settled) active = true;
  }
  // Попарное расталкивание цилиндров Ø25: осевшиеся жетоны — препятствия.
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const a = tokens[i]!;
      const b = tokens[j]!;
      if (a.settled && b.settled) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= TOKEN_D || d === 0) continue;
      const overlap = TOKEN_D - d;
      const nx = d > 0.001 ? dx / d : 1;
      const nz = d > 0.001 ? dz / d : 0;
      if (!a.settled) {
        const share = b.settled ? overlap : overlap / 2;
        a.x -= nx * share;
        a.z -= nz * share;
      }
      if (!b.settled) {
        const share = a.settled ? overlap : overlap / 2;
        b.x += nx * share;
        b.z += nz * share;
      }
    }
  }
  return active;
}

/**
 * Кучка жетонов урона на карте: новые падают с физикой, исчезнувшие
 * (пересчёт 1+1 → 3, лечение) взлетают и растворяются.
 */
export function DamagePile({
  instanceId,
  damage,
  slotZ,
}: {
  instanceId: string;
  damage: number;
  slotZ: number;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const [tokens, setTokens] = useState<TokenState[]>([]);
  const [leaving, setLeaving] = useState<LeavingToken[]>([]);
  const simRef = useRef<Map<string, TokenState>>(new Map());
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const leavingMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const accRef = useRef(0);

  // Дифф разложения: спавн новых жетонов, уход исчезнувших (1+1 → 3 и т.п.).
  useEffect(() => {
    const next = decomposition(damage);
    const nextKeys = new Set(next.map((t) => t.key));
    for (const t of next) {
      if (!simRef.current.has(t.key)) {
        simRef.current.set(t.key, spawnToken(t, `${instanceId}|${damage}`));
      }
    }
    const gone: LeavingToken[] = [];
    for (const [key, st] of simRef.current) {
      if (!nextKeys.has(key)) {
        gone.push({ key, face: st.face, x: st.x, y: st.y, z: st.z, t: 0 });
        simRef.current.delete(key);
      }
    }
    setTokens([...simRef.current.values()]);
    if (gone.length > 0) setLeaving((l) => [...l, ...gone].slice(-8));
  }, [damage, instanceId]);

  useFrame((_, delta) => {
    const now = [...simRef.current.values()];
    let moving = false;
    accRef.current += Math.min(delta, 0.1);
    while (accRef.current >= DT) {
      accRef.current -= DT;
      moving = step(now, DT, slotZ) || moving;
    }
    for (const t of now) {
      const mesh = meshesRef.current.get(t.key);
      if (!mesh) continue;
      mesh.position.set(t.x, t.y, t.z);
      const tiltX = t.settled ? 0 : Math.max(-0.28, Math.min(0.28, -t.vz * 0.004));
      const tiltZ = t.settled ? 0 : Math.max(-0.28, Math.min(0.28, t.vx * 0.004));
      mesh.rotation.set(tiltX, t.angle, tiltZ);
    }
    let leavingDone = false;
    for (const l of leaving) {
      l.t += delta;
      l.y += 170 * delta;
      const mesh = leavingMeshesRef.current.get(l.key);
      if (mesh) {
        mesh.position.set(l.x, l.y, l.z);
        const material = mesh.material as THREE.MeshLambertMaterial;
        material.opacity = Math.max(0, 1 - l.t / LEAVING_S);
      }
      if (l.t > LEAVING_S) leavingDone = true;
    }
    if (leavingDone) setLeaving((l) => l.filter((t) => t.t <= LEAVING_S));
    if (moving || leaving.length > 0) invalidate();
  });

  return (
    <group>
      {tokens.map((t) => (
        <mesh
          key={t.key}
          ref={(m) => {
            if (m) meshesRef.current.set(t.key, m);
            else meshesRef.current.delete(t.key);
          }}
          position={[t.x, t.y, t.z]}
          raycast={() => null}
        >
          <cylinderGeometry args={[TOKEN_D / 2, TOKEN_D / 2, TOKEN_T, 20]} />
          <meshLambertMaterial map={tokenTexture(t.face)} />
        </mesh>
      ))}
      {leaving.map((l) => (
        <mesh
          key={l.key}
          ref={(m) => {
            if (m) leavingMeshesRef.current.set(l.key, m);
            else leavingMeshesRef.current.delete(l.key);
          }}
          position={[l.x, l.y, l.z]}
          raycast={() => null}
        >
          <cylinderGeometry args={[TOKEN_D / 2, TOKEN_D / 2, TOKEN_T, 20]} />
          <meshLambertMaterial map={tokenTexture(l.face)} transparent />
        </mesh>
      ))}
    </group>
  );
}
