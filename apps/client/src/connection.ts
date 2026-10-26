import { PROTOCOL_VERSION } from '@card-wars/protocol';
import type { ClientMessage, Command, LobbyCommand, ServerMessage } from '@card-wars/protocol';
import { patchConnection, pushEvents, setConnectionSink, useGame } from './store';
import { makeRoomCode } from './roomCode';

// Thin WebSocket client: sends commands, replaces the whole view on every
// snapshot (docs/TECH.md «Протокол»). No game logic lives here.

export class GameConnection {
  private ws: WebSocket | null = null;
  private closedByUser = false;

  constructor(
    private code: string,
    private nickname: string,
    private create = false,
  ) {}

  connect(): void {
    const token = sessionStorage.getItem(`cw-token-${this.code}`) ?? undefined;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?code=${this.code}`);
    this.ws = ws;
    ws.onopen = () => {
      this.send({
        t: 'join',
        code: this.code,
        nickname: this.nickname,
        token,
        protocolVersion: PROTOCOL_VERSION,
        ...(this.create ? { create: true } : {}),
      });
    };
    ws.onmessage = (event) => this.handle(String(event.data));
    ws.onclose = () => {
      if (!this.closedByUser) {
        patchConnection({ status: 'closed', error: { message: 'Соединение потеряно' } });
      }
    };
    setConnectionSink({
      sendCommand: (command: Command) => this.send({ t: 'command', command }),
      lobbyCommand: (command: LobbyCommand) => this.send({ t: 'lobby_command', command }),
      hurry: (target: string) => this.send({ t: 'hurry', player: this.safePlayerId(), target }),
    });
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  private safePlayerId(): string {
    return useGame.getState().you?.playerId ?? '';
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
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
        if (this.create) {
          this.create = false;
          history.replaceState(null, '', `/play/${this.code}`);
        }
        patchConnection({
          you: message.you,
          lobby: message.room,
          status: message.room.started ? 'match' : 'lobby',
          error: null,
        });
        return;
      case 'lobby':
        patchConnection({ lobby: message.room, status: message.room.started ? 'match' : 'lobby', error: null });
        return;
      case 'snapshot':
        patchConnection({ view: message.view, timer: message.timer, status: 'match', error: null });
        return;
      case 'timer':
        patchConnection({ timer: message.timer });
        return;
      case 'error':
        if (message.code === 'room_exists' && this.create) {
          this.create = false;
          location.replace(`/play/${makeRoomCode()}?create=1`);
          return;
        }
        patchConnection({ error: { code: message.code, message: message.message } });
        return;
      case 'events':
        pushEvents(message.events);
        return;
      case 'finished':
        return; // финал виден через снапшот
    }
  }
}
