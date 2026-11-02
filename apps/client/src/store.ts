import { create } from 'zustand';
import type { GameEvent } from '@card-wars/protocol';
import type { LobbyCommand, LobbyView, PlayerView, TimerInfo } from '@card-wars/protocol';
import type { Command } from '@card-wars/protocol';

// Client state (docs/TECH.md «Клиент»): the snapshot is the single source of
// truth for the scene; events only feed animations and the log. UI state
// (selections, pick modes, quality) lives here and never touches match state.
// Target picking returns with mechanics v2 (docs/TECH.md № 2).

export type Quality = 'low' | 'high';

export interface UiState {
  quality: Quality;
  selectedHand: string | null;
  dragging: string | null;
  draggingOverZone: number | null;
  holdingFloop: { instanceId: string; startedAt: number } | null;
  journalOpen: boolean;
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
    journalOpen: false,
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

export function sendLobbyCommand(command: LobbyCommand): void {
  useGame.getState().lobbyCommand(command);
}
