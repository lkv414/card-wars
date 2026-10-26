import { create } from 'zustand';
import type { GameEvent } from '@card-wars/protocol';
import type { LobbyView, PlayerView, TimerInfo } from '@card-wars/protocol';
import type { Command } from '@card-wars/protocol';

// Client state (docs/TECH.md «Клиент»): the snapshot is the single source of
// truth for the scene; events only feed animations and the log. UI state
// (selections, pick modes, quality) lives here and never touches match state.

export interface PendingPick {
  base: Record<string, unknown>;
  pick: 'creature' | 'landscape';
}

export type Quality = 'low' | 'high';

export interface UiState {
  quality: Quality;
  selectedHand: string | null;
  dragging: string | null;
  draggingOverZone: number | null;
  holdingFloop: { instanceId: string; startedAt: number } | null;
  pendingPick: PendingPick | null;
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
  hurry: () => void;
  start: () => void;
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
    quality: (localStorage.getItem('cw-quality') as Quality) ?? 'high',
    selectedHand: null,
    dragging: null,
    draggingOverZone: null,
    holdingFloop: null,
    pendingPick: null,
  },
  sendCommand: () => {},
  hurry: () => {},
  start: () => {},
}));

export function setConnectionSink(sink: {
  sendCommand: (command: Command) => void;
  hurry: () => void;
  start: () => void;
}): void {
  useGame.setState({ sendCommand: sink.sendCommand, hurry: sink.hurry, start: sink.start });
}

export function patchConnection(part: Partial<GameStore>): void {
  useGame.setState(part);
}

export function setUi(part: Partial<UiState>): void {
  useGame.setState((state) => ({ ui: { ...state.ui, ...part } }));
}

export function setQuality(quality: Quality): void {
  localStorage.setItem('cw-quality', quality);
  setUi({ quality });
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
