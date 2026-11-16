import { create } from 'zustand';
import type { GameEvent } from '@card-wars/protocol';
import type { LobbyCommand, LobbyView, PlayerView, TimerInfo } from '@card-wars/protocol';
import type { Command } from '@card-wars/protocol';
import type { TargetingState } from './game/targeting';

// Client state (docs/TECH.md «Клиент»): the snapshot is the single source of
// truth for the scene; events only feed animations and the log. UI state
// (selections, pick modes, quality) lives here and never touches match state.
// Target picking returns with mechanics v2 (docs/TECH.md № 2).

export type Quality = 'low' | 'high';
export type CameraMode = 'follow' | 'self' | 'top' | 'opponents' | 'manual';
export type CameraSnap = 'top' | 'self' | 'opponents' | 'follow' | `player_${string}` | string;

export interface EmoteToast {
  id: string;
  sender: string;
  text: string;
  emoji?: string;
  at: number;
}

export interface ZoomedCardInfo {
  cardId: string;
  instanceId?: string;
  damage?: number;
  shield?: number;
  flipped?: boolean;
}

export interface UiState {
  quality: Quality;
  cameraMode: CameraMode;
  cameraSnap?: CameraSnap;
  activeEmote?: EmoteToast | null;
  sidebarCollapsed?: boolean;
  selectedHand: string | null;
  hoveredHand: string | null;
  dragging: string | null;
  draggingFrom: 'hand' | 'field';
  draggingOverZone: number | null;
  draggingOverDiscard: boolean;
  /** World coordinates of the pointer while dragging (raycast on table plane). */
  dragPoint: { x: number; z: number } | null;
  holdingFloop: { instanceId: string; startedAt: number; startX: number; startY: number } | null;
  targeting: TargetingState | null;
  journalOpen: boolean;
  zoomedCard: ZoomedCardInfo | null;
  combatForecastHover: boolean;
  hoveredCreatureInstanceId: string | null;
  unfreezePrompt: { instanceId: string; zone: number } | null;
}

interface GameStore {
  // connection mirror
  status: 'connecting' | 'lobby' | 'match' | 'closed';
  you: { playerId: string; token: string; isHost: boolean } | null;
  lobby: LobbyView | null;
  view: PlayerView | null;
  timer: TimerInfo | null;
  error: { code?: string; message: string } | null;
  eventsLog: GameEvent[];
  lastEventsSeq: number;
  // ui
  ui: UiState;
  // commands are injected by the connection owner
  sendCommand: (command: Command) => void;
  lobbyCommand: (command: LobbyCommand) => void;
  hurry: (target: string) => void;
}

function safeGetItem(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {}
}

export const useGame = create<GameStore>(() => ({
  status: 'connecting',
  you: null,
  lobby: null,
  view: null,
  timer: null,
  error: null,
  eventsLog: [],
  lastEventsSeq: 0,
  ui: {
    quality: (safeGetItem('cw-quality') as Quality) ?? 'high',
    cameraMode: (safeGetItem('cw-camera-mode') as CameraMode) === 'self' ? 'self' : 'follow',
    cameraSnap: (safeGetItem('cw-camera-snap') as CameraSnap) ?? 'follow',
    activeEmote: null,
    sidebarCollapsed: false,
    selectedHand: null,
    hoveredHand: null,
    dragging: null,
    draggingFrom: 'hand',
    draggingOverZone: null,
    draggingOverDiscard: false,
    dragPoint: null,
    holdingFloop: null,
    targeting: null,
    journalOpen: false,
    zoomedCard: null,
    combatForecastHover: false,
    hoveredCreatureInstanceId: null,
    unfreezePrompt: null,
  },
  sendCommand: () => {},
  lobbyCommand: () => {},
  hurry: () => {},
}));

export function setConnectionSink(sink: {
  sendCommand: (command: Command) => void;
  lobbyCommand: (command: LobbyCommand) => void;
  hurry: (target: string) => void;
}): void {
  useGame.setState({ sendCommand: sink.sendCommand, lobbyCommand: sink.lobbyCommand, hurry: sink.hurry });
}

export function patchConnection(part: Partial<GameStore>): void {
  useGame.setState(part);
}

export function setUi(part: Partial<UiState>): void {
  useGame.setState((state) => ({ ui: { ...state.ui, ...part } }));
}

export function setQuality(quality: Quality): void {
  safeSetItem('cw-quality', quality);
  setUi({ quality });
}

export function setCameraMode(cameraMode: CameraMode): void {
  safeSetItem('cw-camera-mode', cameraMode);
  setUi({ cameraMode, cameraSnap: cameraMode as CameraSnap });
}

export function setCameraSnap(snap: CameraSnap): void {
  safeSetItem('cw-camera-snap', snap);
  if (snap === 'follow' || snap === 'self' || snap === 'top' || snap === 'opponents') {
    setUi({ cameraSnap: snap, cameraMode: snap });
  } else {
    setUi({ cameraSnap: snap, cameraMode: 'manual' });
  }
}

export function snapCameraTop(pid?: string): void {
  const v = useGame.getState().view;
  if (!v) {
    setCameraSnap('top');
    return;
  }
  const currentSnap = useGame.getState().ui.cameraSnap;
  let targetPid = pid;
  if (!targetPid && currentSnap) {
    if (currentSnap.startsWith('player_')) {
      targetPid = currentSnap.slice(7);
    } else if (currentSnap.startsWith('top_')) {
      targetPid = currentSnap.slice(4);
    } else if (currentSnap === 'follow') {
      targetPid = v.activePlayers.includes(v.me) ? v.me : (v.activePlayers[0] ?? v.me);
    }
  }
  const p = targetPid ? v.players[targetPid] : null;
  if (targetPid && p && !p.eliminated) {
    setCameraSnap(targetPid === v.me ? 'top' : `top_${targetPid}`);
  } else {
    setCameraSnap('top');
  }
}

export function snapCameraPlayer(pid?: string): void {
  const v = useGame.getState().view;
  if (!v) return;
  const currentSnap = useGame.getState().ui.cameraSnap;
  let target = pid;
  if (!target && currentSnap) {
    if (currentSnap.startsWith('top_')) {
      target = currentSnap.slice(4);
    } else if (currentSnap.startsWith('player_')) {
      target = currentSnap.slice(7);
    } else if (currentSnap === 'follow') {
      target = v.activePlayers.includes(v.me) ? v.me : (v.activePlayers[0] ?? v.me);
    }
  }
  target = target ?? v.me ?? 'me';
  setCameraSnap(target === v.me ? 'self' : `player_${target}`);
}

export function cycleCameraPlayer(direction: 'next' | 'prev' = 'next'): void {
  const v = useGame.getState().view;
  if (!v) return;
  const alive = v.order.filter((id) => !v.players[id]?.eliminated);
  if (alive.length === 0) return;
  const meIndex = alive.indexOf(v.me);
  const ordered = meIndex >= 0 ? [...alive.slice(meIndex), ...alive.slice(0, meIndex)] : alive;

  const currentSnap = useGame.getState().ui.cameraSnap ?? 'self';
  const isTop = currentSnap === 'top' || currentSnap.startsWith('top_');

  let currentPid = v.me;
  if (currentSnap.startsWith('player_')) {
    const raw = currentSnap.slice(7);
    if (v.players[raw]) currentPid = raw;
  } else if (currentSnap.startsWith('top_')) {
    const raw = currentSnap.slice(4);
    if (v.players[raw]) currentPid = raw;
  } else if (currentSnap === 'opponents') {
    const enemies = ordered.filter((id) => id !== v.me);
    currentPid = enemies[0] ?? v.me;
  } else if (currentSnap === 'follow') {
    currentPid = v.activePlayers.includes(v.me) ? v.me : (v.activePlayers[0] ?? v.me);
  }

  const idx = ordered.indexOf(currentPid);
  const nextIdx =
    idx < 0
      ? 0
      : direction === 'next'
        ? (idx + 1) % ordered.length
        : (idx - 1 + ordered.length) % ordered.length;
  const nextPid = ordered[nextIdx]!;

  if (isTop) {
    setCameraSnap(nextPid === v.me ? 'top' : `top_${nextPid}`);
  } else {
    setCameraSnap(nextPid === v.me ? 'self' : `player_${nextPid}`);
  }
}

let emoteTimeout: ReturnType<typeof setTimeout> | null = null;
export function emitEmote(sender: string, text: string, emoji?: string): void {
  if (emoteTimeout) clearTimeout(emoteTimeout);
  const toast: EmoteToast = {
    id: String(Date.now()),
    sender,
    text,
    emoji,
    at: Date.now(),
  };
  setUi({ activeEmote: toast });
  emoteTimeout = setTimeout(() => {
    if (useGame.getState().ui.activeEmote?.id === toast.id) {
      setUi({ activeEmote: null });
    }
  }, 4200);
}

let hintTimeout: ReturnType<typeof setTimeout> | null = null;
export function showHint(message: string): void {
  if (hintTimeout) clearTimeout(hintTimeout);
  useGame.setState({ error: { message } });
  hintTimeout = setTimeout(() => {
    if (useGame.getState().error?.message === message) {
      useGame.setState({ error: null });
    }
  }, 3200);
}

export function pushEvents(events: GameEvent[]): void {
  if (events.length === 0) return;
  useGame.setState((state) => ({
    eventsLog: [...state.eventsLog.slice(-60), ...events],
    lastEventsSeq: state.lastEventsSeq + events.length,
  }));
}

export function sendCommand(command: Command): void {
  useGame.getState().sendCommand(command);
}

export function sendLobbyCommand(command: LobbyCommand): void {
  useGame.getState().lobbyCommand(command);
}
