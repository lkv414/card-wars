import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GameEvent, PlayerView } from '@card-wars/protocol';
import { cards as catalog } from '@card-wars/content';
import { CARD_H, CARD_W, SPRITE_SCALE, deckPos, discardPos, heroPos, rowZ, zoneX } from './layout';
import { cardTexture, textSprite, tokenTexture } from './textures';
import { useGame } from '../../store';

// Анимации-«призраки» поверх снапшота: сцена уже показывает итоговое состояние,
// призраки только проигрывают переходы (docs/UI-3D.md «Анимации по событиям»).

interface Anim {
  id: number;
  kind: 'fly' | 'tokenDrop' | 'number' | 'flash';
  cardId?: string;
  from: [number, number, number];
  to: [number, number, number];
  start: number;
  duration: number;
  color?: string;
  text?: string;
}

let animId = 0;
const anims: Anim[] = [];
const listeners = new Set<() => void>();

function pushAnim(anim: Omit<Anim, 'id' | 'start'>): void {
  anims.push({ ...anim, id: animId++, start: performance.now() });
  if (anims.length > 40) anims.splice(0, anims.length - 40);
  for (const listener of listeners) listener();
}

function positionOfInstance(view: PlayerView | null, instanceId: string | null): [number, number, number] | null {
  if (!view || !instanceId) return null;
  for (const pid of view.order) {
    const p = view.players[pid]!;
    const isMe = pid === view.me;
    const rowZValue = rowZ(isMe);
    for (let z = 0; z < p.zones.length; z++) {
      const zone = p.zones[z]!;
      if (zone.creature?.instanceId === instanceId || zone.building?.instanceId === instanceId) {
        return [zoneX(z), 3, rowZValue];
      }
    }
  }
  return null;
}

// Событие с точки зрения анимаций: поля приходят из домена как passthrough JSON.
interface AnimEvent {
  type: string;
  player?: string;
  cardId?: string;
  instanceId?: string | null;
  targetInstanceId?: string | null;
  targetPlayer?: string | null;
  amount?: number;
  delta?: number;
  zone?: number;
  change?: string;
}

/** Map incoming server events to visual ghosts. */
export function eventsToAnims(view: PlayerView | null, events: GameEvent[]): void {
  const handPos: [number, number, number] = [0, 30, 330];
  for (const raw of events) {
    const event = raw as unknown as AnimEvent;
    const zone = event.zone ?? 0;
    const amount = event.amount ?? 0;
    const instanceId = event.instanceId ?? null;
    switch (event.type) {
      case 'card_played': {
        const isMe = event.player === view?.me;
        pushAnim({
          kind: 'fly',
          cardId: event.cardId,
          from: handPos,
          to: [zoneX(zone), 4, rowZ(isMe)],
          duration: 380,
        });
        break;
      }
      case 'creature_destroyed': {
        const from = positionOfInstance(view, instanceId) ?? [0, 4, 0];
        const owner = findOwner(view, event.instanceId ?? '');
        pushAnim({ kind: 'fly', cardId: event.cardId, from, to: [...discardPos(owner)] as [number, number, number], duration: 520 });
        break;
      }
      case 'damage_dealt': {
        const target: [number, number, number] = event.targetInstanceId
          ? (positionOfInstance(view, event.targetInstanceId) ?? [0, 20, 0])
          : [...heroPos(event.targetPlayer === view?.me)] as [number, number, number];
        pushAnim({ kind: 'number', text: `-${amount}`, color: '#ff8a7a', from: [target[0], target[1] + 60, target[2]], to: [target[0], target[1] + 130, target[2]], duration: 900 });
        if (event.targetInstanceId) {
          pushAnim({ kind: 'tokenDrop', from: [target[0], 130, target[2]], to: [target[0] + 18, 8, target[2] - 12], duration: 420 });
        }
        break;
      }
      case 'creature_healed': {
        const at = positionOfInstance(view, instanceId) ?? [0, 20, 0];
        pushAnim({ kind: 'number', text: `+${amount}`, color: '#7fe0a0', from: [at[0], at[1] + 60, at[2]], to: [at[0], at[1] + 130, at[2]], duration: 900 });
        break;
      }
      case 'lives_changed': {
        const delta = event.delta ?? 0;
        if (delta < 0) break; // уже показано damage_dealt
        const at = heroPos(event.player === view?.me);
        pushAnim({ kind: 'number', text: `+${delta}`, color: '#7fe0a0', from: [at[0], 80, at[2]], to: [at[0], 140, at[2]], duration: 900 });
        break;
      }
      case 'land_changed': {
        const isMe = event.player === view?.me;
        const at: [number, number, number] = [zoneX(zone), 4, rowZ(isMe)];
        pushAnim({ kind: 'flash', color: event.change === 'frozen' ? '#9fd8ff' : '#ffe9a8', from: at, to: at, duration: 500 });
        break;
      }
      case 'card_drawn': {
        const isMe = event.player === view?.me;
        const deck = deckPos(isMe);
        pushAnim({ kind: 'fly', from: [...deck] as [number, number, number], to: handPos, duration: 340 });
        break;
      }
      case 'floop_used': {
        const at = positionOfInstance(view, instanceId);
        if (at) pushAnim({ kind: 'flash', color: '#48d9a0', from: at, to: at, duration: 420 });
        break;
      }
      default:
        break;
    }
  }
}

function findOwner(view: PlayerView | null, instanceId: string): boolean {
  if (!view) return true;
  for (const pid of view.order) {
    const p = view.players[pid]!;
    for (const zone of p.zones) {
      if (zone.creature?.instanceId === instanceId || zone.building?.instanceId === instanceId) {
        return pid === view.me;
      }
    }
    if (p.discard.some((d) => d.instanceId === instanceId)) return pid === view.me;
  }
  return true;
}

/** Consumes the store's event stream and feeds the anim list. */
export function AnimDriver() {
  const seq = useGame((s) => s.lastEventsSeq);
  const view = useGame((s) => s.view);
  const processed = useRef(0);
  useEffect(() => {
    const state = useGame.getState();
    const total = state.eventsLog.length;
    if (total > processed.current) {
      const fresh = state.eventsLog.slice(processed.current);
      processed.current = total;
      eventsToAnims(view, fresh as GameEvent[]);
    } else if (total < processed.current) {
      processed.current = total; // log trimmed
    }
  }, [seq, view]);
  return null;
}

export function AnimLayer() {
  const group = useRef<THREE.Group>(null);
  const version = useRef(0);
  useEffect(() => {
    const listener = () => {
      version.current++;
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useFrame(() => {
    const now = performance.now();
    for (let i = anims.length - 1; i >= 0; i--) {
      if (now - anims[i]!.start > anims[i]!.duration + 60) anims.splice(i, 1);
    }
  });
  const now = performance.now();
  const alive = anims.filter((a) => now - a.start <= a.duration + 60);
  return (
    <group ref={group}>
      {alive.map((anim) => (
        <Ghost key={anim.id} anim={anim} now={now} />
      ))}
    </group>
  );
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function Ghost({ anim, now }: { anim: Anim; now: number }) {
  const t = Math.min(1, (now - anim.start) / anim.duration);
  const e = ease(t);
  const pos: [number, number, number] = [
    anim.from[0] + (anim.to[0] - anim.from[0]) * e,
    anim.from[1] + (anim.to[1] - anim.from[1]) * e + (anim.kind === 'fly' ? Math.sin(Math.PI * t) * 90 : anim.kind === 'tokenDrop' ? 0 : 0),
    anim.from[2] + (anim.to[2] - anim.from[2]) * e,
  ];
  const opacity = anim.kind === 'number' ? 1 - t * t : 1 - Math.max(0, t - 0.8) * 5;

  if (anim.kind === 'fly') {
    const texture = anim.cardId ? cardTexture(anim.cardId) : null;
    if (!texture) return null;
    return (
      <mesh position={pos} rotation={[-Math.PI / 2 + Math.sin(t * Math.PI) * 0.7, 0, 0]}>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial map={texture} transparent opacity={opacity} />
      </mesh>
    );
  }
  if (anim.kind === 'tokenDrop') {
    // bounce at the end: small overshoot on Y
    const bounce = t > 0.85 ? Math.abs(Math.sin((t - 0.85) * Math.PI * 3)) * 8 * (1 - t) : 0;
    void bounce;
    return (
      <mesh position={[pos[0], pos[1], pos[2]]}>
        <cylinderGeometry args={[12.5, 12.5, 3, 20]} />
        <meshLambertMaterial map={tokenTexture(1)} transparent opacity={opacity} />
      </mesh>
    );
  }
  if (anim.kind === 'number') {
    return (
      <sprite position={pos} scale={[256 * SPRITE_SCALE * 2, 128 * SPRITE_SCALE * 2, 1]}>
        <spriteMaterial map={textSprite(anim.text ?? '', anim.color ?? '#ffffff')} transparent opacity={opacity} />
      </sprite>
    );
  }
  // flash
  return (
    <mesh position={[pos[0], 2, pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[130, 170]} />
      <meshBasicMaterial color={anim.color ?? '#ffffff'} transparent opacity={0.5 * (1 - t)} />
    </mesh>
  );
}

export function hasActiveAnims(): boolean {
  return anims.length > 0;
}

void catalog;
