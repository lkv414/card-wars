import { DurableObject } from 'cloudflare:workers';
import { applyCommand, createMatch, type Command, type GameEvent, type MatchState } from '@card-wars/domain';
import { journalLines, viewFor } from '@card-wars/application';
import { ClientMessageSchema, type LobbyView, type TimerInfo } from '@card-wars/protocol';
import { catalog, deckPresets } from '@card-wars/content';
import { config } from './config';
import {
  advance,
  deadlineMs,
  expired,
  hurry as hurryTimer,
  pause as pauseTimer,
  resume as resumeTimer,
  stoppedTimer,
  type TurnTimerState,
} from './timer';

// Room Durable Object: one instance per room code (docs/TECH.md «Сервер»).
// MVP flow: join by code → first joiner is host → host starts the match →
// domain commands flow through here. Hibernation-safe: everything lives in storage.

type RoomPhase = 'lobby' | 'match' | 'finished';

interface Session {
  playerId: string;
  nickname: string;
  token: string;
  connected: boolean;
}

interface RoomState {
  phase: RoomPhase;
  hostId: string | null;
  sessions: Session[];
  nextPlayerNum: number;
  match: MatchState | null;
  journal: string[];
  timer: TurnTimerState;
  paused: boolean;
  reconnectDeadlineMs: number | null;
}

interface WsAttachment {
  playerId: string;
  token: string;
}

const domainDeps = { config, catalog };

function freshState(): RoomState {
  return {
    phase: 'lobby',
    hostId: null,
    sessions: [],
    nextPlayerNum: 1,
    match: null,
    journal: [],
    timer: stoppedTimer(),
    paused: false,
    reconnectDeadlineMs: null,
  };
}

export class Room extends DurableObject {
  private state: RoomState | null = null;
  private loaded = false;

  private async load(): Promise<RoomState> {
    if (!this.loaded) {
      const stored = await this.ctx.storage.get<RoomState>('room');
      this.state = stored ?? freshState();
      this.loaded = true;
      if (!stored) await this.persist();
    }
    return this.state!;
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('room', this.state!);
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    if (message === 'ping') return; // handled by the auto-response pair
    const state = await this.load();
    const parsed = ClientMessageSchema.safeParse(JSON.parse(message));
    if (!parsed.success) {
      this.sendTo(ws, { t: 'error', message: 'Некорректное сообщение' });
      return;
    }
    const msg = parsed.data;
    try {
      switch (msg.t) {
        case 'join':
          await this.handleJoin(ws, state, msg.code, msg.nickname, msg.token);
          return;
        case 'start':
          await this.handleStart(state, msg.player);
          return;
        case 'command':
          await this.handleCommand(state, ws, msg.command as Command);
          return;
        case 'hurry':
          await this.handleHurry(state, msg.player);
          return;
      }
    } catch (error) {
      this.sendTo(ws, { t: 'error', message: error instanceof Error ? error.message : 'Ошибка сервера' });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const state = await this.load();
    const attachment = this.attachmentOf(ws);
    if (!attachment) return;
    const session = state.sessions.find((s) => s.playerId === attachment.playerId);
    if (!session || !session.connected) return;
    session.connected = false;

    if (state.phase === 'match') {
      // Пауза + таймер возврата от первого оборвавшегося (docs/NETWORK.md).
      const now = Date.now();
      if (!state.paused) {
        state.paused = true;
        state.reconnectDeadlineMs = now + config.reconnectWaitSeconds * 1000;
        state.timer = pauseTimer(state.timer, now);
      }
      await this.persist();
      this.scheduleAlarm(state, now);
      this.broadcastSnapshots(state);
      this.broadcastLobbyInfo(state);
      return;
    }
    if (state.phase === 'lobby' && state.hostId === attachment.playerId) {
      const nextHost = state.sessions.find((s) => s.connected);
      state.hostId = nextHost?.playerId ?? null;
    }
    await this.persist();
    this.broadcastLobbyInfo(state);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    const state = await this.load();
    const now = Date.now();

    // Ожидание возврата истекло — поражение обрывавшему (docs/NETWORK.md).
    if (state.reconnectDeadlineMs !== null && now >= state.reconnectDeadlineMs) {
      const gone = state.sessions.find((s) => !s.connected);
      state.reconnectDeadlineMs = null;
      state.paused = false;
      if (gone && state.phase === 'match' && state.match) {
        const res = applyCommand(state.match, { type: 'disconnect_loss', player: gone.playerId }, domainDeps);
        if (res.ok) {
          this.applyResult(state, res.state, res.events);
        }
      }
      await this.persist();
      this.broadcastSnapshots(state);
      return;
    }

    // Таймер хода истёк — автоматический переход в бой.
    if (state.match && state.timer.running && expired(state.timer, now)) {
      state.timer = stoppedTimer();
      const active = state.match.activePlayer;
      const res = applyCommand(state.match, { type: 'time_expired', player: active }, domainDeps);
      if (res.ok) {
        this.applyResult(state, res.state, res.events);
      }
      await this.persist();
      this.broadcastSnapshots(state);
      this.broadcastEvents([], state);
      return;
    }

    this.scheduleAlarm(state, now);
  }

  // --- handlers ---

  private async handleJoin(ws: WebSocket, state: RoomState, code: string, nickname: string, token: string | undefined): Promise<void> {
    void code; // the DO name already pins the room
    let session = token ? state.sessions.find((s) => s.token === token) : undefined;
    const isReconnect = Boolean(session && !session.connected);

    if (!session) {
      if (state.phase !== 'lobby') {
        this.sendTo(ws, { t: 'error', message: 'Матч уже идёт — подключение невозможно без токена' });
        return;
      }
      if (state.sessions.length >= config.maxPlayers) {
        this.sendTo(ws, { t: 'error', message: 'Комната заполнена' });
        return;
      }
      const playerId = `p${state.nextPlayerNum++}`;
      const newToken = crypto.randomUUID();
      session = { playerId, nickname, token: newToken, connected: true };
      state.sessions.push(session);
      if (!state.hostId) state.hostId = playerId;
    } else {
      session.connected = true;
      if (session.nickname !== nickname) session.nickname = nickname;
    }

    ws.serializeAttachment({ playerId: session.playerId, token: session.token } satisfies WsAttachment);
    await this.persist();

    this.sendTo(ws, {
      t: 'joined',
      you: { playerId: session.playerId, token: session.token, isHost: state.hostId === session.playerId },
      room: this.lobbyView(state),
    });

    if (isReconnect && state.phase === 'match') {
      const now = Date.now();
      const anyoneDisconnected = state.sessions.some((s) => !s.connected);
      if (state.paused && !anyoneDisconnected) {
        state.paused = false;
        state.reconnectDeadlineMs = null;
        state.timer = resumeTimer(state.timer, now);
        await this.persist();
        this.scheduleAlarm(state, now);
      }
      this.sendSnapshotTo(ws, state, session.playerId);
      this.broadcastLobbyInfo(state);
      return;
    }
    this.broadcastLobbyInfo(state);
  }

  private async handleStart(state: RoomState, player: string): Promise<void> {
    if (state.phase !== 'lobby') {
      throw new Error('Матч уже стартовал');
    }
    if (state.hostId !== player) {
      throw new Error('Начать матч может только хост');
    }
    const ready = state.sessions.filter((s) => s.connected);
    if (ready.length !== config.minPlayers) {
      throw new Error(`Нужно ${config.minPlayers} подключённых игрока`);
    }
    const { state: match, events } = createMatch(domainDeps, {
      players: ready.map((s, i) => ({
        id: s.playerId,
        nickname: s.nickname,
        heroId: deckPresets[i]!.heroId,
        deck: [...deckPresets[i]!.deck],
        lands: [...deckPresets[i]!.lands],
      })),
      seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
    });
    state.match = match;
    state.phase = 'match';
    state.timer = stoppedTimer();
    state.journal.push(...this.stamp(journalLines(domainDeps, match, events)));
    await this.persist();
    this.broadcastSnapshots(state);
  }

  private async handleCommand(state: RoomState, ws: WebSocket, command: Command): Promise<void> {
    if (state.phase !== 'match' || !state.match) {
      this.sendTo(ws, { t: 'error', message: 'Матч не идёт' });
      return;
    }
    const attachment = this.attachmentOf(ws);
    if (!attachment) {
      this.sendTo(ws, { t: 'error', message: 'Сначала войдите в комнату' });
      return;
    }
    if (command.player !== attachment.playerId) {
      this.sendTo(ws, { t: 'error', message: 'Нельзя посылать команды за другого игрока' });
      return;
    }
    if (state.paused) {
      this.sendTo(ws, { t: 'error', message: 'Партия на паузе — ожидание игрока' });
      return;
    }
    const result = applyCommand(state.match, command, domainDeps);
    if (!result.ok) {
      this.sendTo(ws, { t: 'error', code: result.rejected.code, message: result.rejected.message });
      return;
    }
    const beforeTurn = state.match.turn;
    this.applyResult(state, result.state, result.events);
    if (result.state.turn !== beforeTurn) {
      state.timer = stoppedTimer(); // новый ход — таймер сброшен до следующего «Поторопить»
    }
    await this.persist();
    const now = Date.now();
    this.scheduleAlarm(state, now);
    this.broadcastEvents(result.events, state);
    this.broadcastSnapshots(state);
  }

  private async handleHurry(state: RoomState, player: string): Promise<void> {
    if (state.phase !== 'match' || !state.match) return;
    if (state.paused) return;
    if (player === state.match.activePlayer) return; // «Поторопить» — только чужой ход
    const now = Date.now();
    const { state: timer } = hurryTimer(state.timer, now, config);
    state.timer = timer;
    await this.persist();
    this.scheduleAlarm(state, now);
    this.broadcastTimer(state);
  }

  // --- helpers ---

  private applyResult(state: RoomState, match: MatchState, events: GameEvent[]): void {
    state.match = match;
    state.journal.push(...this.stamp(journalLines(domainDeps, match, events)));
    if (match.status === 'finished') {
      state.phase = 'finished';
      state.timer = stoppedTimer();
      state.reconnectDeadlineMs = null;
      state.paused = false;
    }
  }

  private stamp(lines: string[]): string[] {
    const time = new Date().toISOString().slice(11, 19);
    return lines.map((line) => `${time} — ${line}`);
  }

  private lobbyView(state: RoomState): LobbyView {
    return {
      code: this.ctx.id.name ?? '----',
      host: state.hostId,
      players: state.sessions.map((s) => ({ id: s.playerId, nickname: s.nickname, connected: s.connected })),
      started: state.phase !== 'lobby',
    };
  }

  private attachmentOf(ws: WebSocket): WsAttachment | null {
    try {
      const raw = (ws as WebSocket & { deserializeAttachment?: () => unknown }).deserializeAttachment?.();
      return (raw as WsAttachment) ?? null;
    } catch {
      return null;
    }
  }

  private socketsFor(playerId: string): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => this.attachmentOf(ws)?.playerId === playerId && ws.readyState === WebSocket.OPEN);
  }

  private allSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private sendTo(ws: WebSocket, message: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  private broadcast(message: unknown): void {
    for (const ws of this.allSockets()) this.sendTo(ws, message);
  }

  private broadcastLobbyInfo(state: RoomState): void {
    this.broadcast({ t: 'lobby', room: this.lobbyView(state) });
  }

  private timerInfo(state: RoomState, now: number): TimerInfo {
    const advanced = state.paused && state.timer.running
      ? state.timer
      : advance(state.timer, now);
    return {
      running: state.timer.running,
      paused: state.paused,
      remainingMs: Math.max(0, state.paused ? state.timer.remainingMs : advanced.remainingMs),
      serverNowMs: now,
    };
  }

  private sendSnapshotTo(ws: WebSocket, state: RoomState, playerId: string): void {
    if (!state.match) return;
    const connected = Object.fromEntries(state.sessions.map((s) => [s.playerId, s.connected]));
    const view = viewFor(domainDeps, state.match, playerId, { journal: state.journal, connected });
    this.sendTo(ws, { t: 'snapshot', view, timer: this.timerInfo(state, Date.now()) });
  }

  private broadcastSnapshots(state: RoomState): void {
    if (!state.match) return;
    for (const session of state.sessions) {
      for (const ws of this.socketsFor(session.playerId)) {
        this.sendSnapshotTo(ws, state, session.playerId);
      }
    }
  }

  private broadcastEvents(events: GameEvent[], state: RoomState): void {
    void state;
    if (events.length === 0) return;
    this.broadcast({ t: 'events', events });
  }

  private broadcastTimer(state: RoomState): void {
    this.broadcast({ t: 'timer', timer: this.timerInfo(state, Date.now()) });
  }

  /** Keep a single alarm at the nearest deadline (reconnect wait or turn timer). */
  private async scheduleAlarm(state: RoomState, now: number): Promise<void> {
    const deadlines: number[] = [];
    if (state.reconnectDeadlineMs !== null) deadlines.push(state.reconnectDeadlineMs);
    const timerDeadline = state.paused ? null : deadlineMs(state.timer, now);
    if (timerDeadline !== null) deadlines.push(timerDeadline + 50);
    if (deadlines.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }
}
