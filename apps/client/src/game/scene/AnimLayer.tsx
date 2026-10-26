import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GameEvent, PlayerView } from '@card-wars/protocol';
import {
  CARD_H,
  CARD_W,
  HAND,
  SPRITE_SCALE,
  boardTransform,
  localToWorld,
  worldOfCompanion,
  worldOfDeck,
  worldOfDiscard,
  worldOfHero,
  worldOfSlot,
  zoneX,
} from './layout';
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
    for (let z = 0; z < p.zones.length; z++) {
      const zone = p.zones[z]!;
      if (zone.creature?.instanceId === instanceId) return worldOfSlot(view, pid, z, 'creature');
      if (zone.building?.instanceId === instanceId) return worldOfSlot(view, pid, z, 'building');
    }
    if (p.companion?.instanceId === instanceId) return worldOfCompanion(view, pid);
  }
  return null;
}

function ownerOf(view: PlayerView | null, instanceId: string): string | null {
  if (!view) return null;
  for (const pid of view.order) {
    const p = view.players[pid]!;
    for (const zone of p.zones) {
      if (zone.creature?.instanceId === instanceId || zone.building?.instanceId === instanceId) return pid;
    }
    if (p.companion?.instanceId === instanceId) return pid;
    if (p.discard.some((card) => card.instanceId === instanceId)) return pid;
  }
  return null;
}

function heroAt(view: PlayerView | null, pid: string | null | undefined): [number, number, number] {
  if (!view || !pid) return [0, 20, 0];
  return worldOfHero(view, pid) ?? [0, 20, 0];
}

function deckAt(view: PlayerView | null, pid: string | null | undefined): [number, number, number] {
  if (!view || !pid) return [0, 4, 0];
  return worldOfDeck(view, pid) ?? [0, 4, 0];
}

function discardAt(view: PlayerView | null, pid: string | null | undefined): [number, number, number] {
  if (!view || !pid) return [0, 4, 0];
  return worldOfDiscard(view, pid) ?? [0, 4, 0];
}

function landAt(view: PlayerView | null, pid: string | null | undefined, zone: number): [number, number, number] {
  if (!view || !pid) return [0, 4, 0];
  const transform = boardTransform(view, pid);
  if (!transform) return [0, 4, 0];
  const world = localToWorld(transform, zoneX(zone), 0);
  return [world.x, 4, world.z];
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
  slot?: 'creature' | 'building';
  change?: string;
}

/** Map incoming server events to visual ghosts. */
export function eventsToAnims(view: PlayerView | null, events: GameEvent[]): void {
  if (!view) return;
  const handPos: [number, number, number] = [0, 30, HAND.z];
  for (const raw of events) {
    const event = raw as unknown as AnimEvent;
    const zone = event.zone ?? 0;
    const amount = event.amount ?? 0;
    const instanceId = event.instanceId ?? null;
    const fromHand = event.player === view?.me ? handPos : heroAt(view, event.player);
    switch (event.type) {
      case 'card_played': {
        const to = worldOfSlot(view!, event.player!, zone, event.slot ?? 'creature') ?? [0, 4, 0];
        pushAnim({ kind: 'fly', cardId: event.cardId, from: fromHand, to, duration: 380 });
        break;
      }
      case 'companion_played': {
        const to = worldOfCompanion(view!, event.player!) ?? [0, 8, 0];
        pushAnim({ kind: 'fly', cardId: event.cardId, from: fromHand, to, duration: 380 });
        break;
      }
      case 'creature_destroyed': {
        const from = positionOfInstance(view, instanceId) ?? heroAt(view, ownerOf(view, instanceId ?? ''));
        const to = discardAt(view, ownerOf(view, instanceId ?? ''));
        pushAnim({ kind: 'fly', cardId: event.cardId, from, to, duration: 520 });
        break;
      }
      case 'damage_dealt': {
        const target: [number, number, number] = event.targetInstanceId
          ? (positionOfInstance(view, event.targetInstanceId) ?? [0, 20, 0])
          : heroAt(view, event.targetPlayer);
        pushAnim({
          kind: 'number',
          text: `-${amount}`,
          color: '#ff8a7a',
          from: [target[0], target[1] + 60, target[2]],
          to: [target[0], target[1] + 130, target[2]],
          duration: 900,
        });
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
        const at = heroAt(view, event.player);
        pushAnim({ kind: 'number', text: `+${delta}`, color: '#7fe0a0', from: [at[0], 80, at[2]], to: [at[0], 140, at[2]], duration: 900 });
        break;
      }
      case 'land_changed': {
        const at = landAt(view, event.player, zone);
        pushAnim({ kind: 'flash', color: event.change === 'frozen' ? '#9fd8ff' : '#ffe9a8', from: at, to: at, duration: 500 });
        break;
      }
      case 'card_drawn': {
        const to = event.player === view?.me ? handPos : heroAt(view, event.player);
        pushAnim({ kind: 'fly', from: deckAt(view, event.player), to, duration: 340 });
        break;
      }
      case 'floop_used': {
        const at = positionOfInstance(view, instanceId);
        if (at) pushAnim({ kind: 'flash', color: '#48d9a0', from: at, to: at, duration: 420 });
        break;
      }
      case 'battle_ready': {
        const at = heroAt(view, event.player);
        pushAnim({ kind: 'flash', color: '#4c8ee8', from: at, to: at, duration: 520 });
        break;
      }
      case 'spell_cast': {
        const at = landAt(view, event.player, 1);
        pushAnim({ kind: 'flash', color: '#b48cff', from: [at[0], 25, at[2]], to: [at[0], 25, at[2]], duration: 500 });
        break;
      }
      default:
        break;
    }
  }
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
    anim.from[1] + (anim.to[1] - anim.from[1]) * e + (anim.kind === 'fly' ? Math.sin(Math.PI * t) * 90 : 0),
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
