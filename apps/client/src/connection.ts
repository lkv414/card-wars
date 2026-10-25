import { PROTOCOL_VERSION } from '@card-wars/protocol';
import type { ClientMessage, Command, LobbyView, PlayerView, ServerMessage, TimerInfo } from '@card-wars/protocol';

// Thin WebSocket client: sends commands, replaces the whole view on every
// snapshot (docs/TECH.md «Протокол»). No game logic lives here.

export interface ConnectionState {
  status: 'connecting' | 'lobby' | 'match' | 'closed';
  you: { playerId: string; token: string; isHost: boolean } | null;
  lobby: LobbyView | null;
  view: PlayerView | null;
  timer: TimerInfo | null;
  error: { code?: string; message: string } | null;
}

type Listener = (state: ConnectionState) => void;

export class GameConnection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private closedByUser = false;

  state: ConnectionState = {
    status: 'connecting',
    you: null,
    lobby: null,
    view: null,
    timer: null,
    error: null,
  };

  constructor(
    private code: string,
    private nickname: string,
  ) {}

  connect(): void {
    const token = sessionStorage.getItem(`cw-token-${this.code}`) ?? undefined;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?code=${this.code}`);
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'join', code: this.code, nickname: this.nickname, token, protocolVersion: PROTOCOL_VERSION });
    };
    ws.onmessage = (event) => this.handle(String(event.data));
    ws.onclose = () => {
      if (!this.closedByUser) {
        this.patch({ status: 'closed', error: { message: 'Соединение потеряно' } });
      }
    };
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendCommand(command: Command): void {
    this.send({ t: 'command', command });
  }

  start(): void {
    if (this.state.you) this.send({ t: 'start', player: this.state.you.playerId });
  }

  hurry(): void {
    if (this.state.you) this.send({ t: 'hurry', player: this.state.you.playerId });
  }

  private handle(raw: string): void {
    if (raw === 'pong') return;
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (message.t) {
      case 'joined':
        sessionStorage.setItem(`cw-token-${this.code}`, message.you.token);
        this.patch({ you: message.you, lobby: message.room, status: message.room.started ? 'match' : 'lobby', error: null });
        return;
      case 'lobby':
        this.patch({ lobby: message.room, status: message.room.started && this.state.view ? 'match' : message.room.started ? 'match' : 'lobby' });
        return;
      case 'snapshot':
        this.patch({ view: message.view, timer: message.timer, status: 'match' });
        return;
      case 'timer':
        this.patch({ timer: message.timer });
        return;
      case 'error':
        this.patch({ error: { code: message.code, message: message.message } });
        return;
      case 'events':
      case 'finished':
        return; // события видны через журнал снапшота; finished — через view
    }
  }

  private patch(part: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...part };
    for (const listener of this.listeners) listener(this.state);
  }
}
