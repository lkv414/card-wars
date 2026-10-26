import { DurableObject } from 'cloudflare:workers';
import {
  applyCommand,
  createMatch,
  type Command as DomainCommand,
  type GameEvent,
  type MatchState,
} from '@card-wars/domain';
import { journalLines, viewFor } from '@card-wars/application';
import {
  ClientMessageSchema,
  PROTOCOL_VERSION,
  type LobbyCommand,
  type LobbyMode,
  type LobbyView,
  type TimerInfo,
} from '@card-wars/protocol';
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
import { decideBotCommand } from './bot';
import { presetDeck, validateDeck, type DeckSetup } from './deck';

// Room Durable Object: one instance per room code (docs/TECH.md «Сервер»).
// Lobby (docs/NETWORK.md «Комнаты и лобби») → match → results. Everything lives
// in storage; hibernation-safe through alarms (timers, bots, reconnect waits).

type RoomPhase = 'lobby' | 'match' | 'finished';

interface Session {
  playerId: string;
  nickname: string;
  token: string;
  connected: boolean;
  isBot: boolean;
  seat: number;
  ready: boolean;
  deck: DeckSetup | null;
  disconnectedAt: number | null;
}

interface RoomState {
  /** Bumped when the persisted shape changes; incompatible rooms start fresh. */
  version: number;
  phase: RoomPhase;
  hostId: string | null;
  sessions: Session[];
  nextPlayerNum: number;
  nextBotNum: number;
  mode: LobbyMode;
  hidden: boolean;
  match: MatchState | null;
  journal: string[];
  /** Turn timers of the current active players (one in FFA, two in 2v2). */
  timers: Record<string, TurnTimerState>;
  paused: boolean;
  reconnectDeadlineMs: number | null;
  botActionAt: number | null;
  lobbyCleanupAt: number | null;
}

interface WsAttachment {
  playerId: string;
  token: string;
}

const domainDeps = { config, catalog };
const BOT_ACTION_DELAY_MS = 900;

function freshState(): RoomState {
  return {
    version: 1,
    phase: 'lobby',
    hostId: null,
    sessions: [],
    nextPlayerNum: 1,
    nextBotNum: 1,
    mode: { kind: 'ffa' },
    hidden: false,
    match: null,
    journal: [],
    timers: {},
    paused: false,
    reconnectDeadlineMs: null,
    botActionAt: null,
    lobbyCleanupAt: null,
  };
}

export class Room extends DurableObject {
  private state: RoomState | null = null;
  private loaded = false;

  private async load(): Promise<RoomState> {
    if (!this.loaded) {
      const stored = await this.ctx.storage.get<RoomState>('room');
      const compatible = Boolean(stored && stored.version === 1);
      this.state = compatible && stored ? stored : freshState();
      this.loaded = true;
      if (!compatible) await this.persist();
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
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      this.sendTo(ws, { t: 'error', message: 'Некорректное сообщение' });
      return;
    }
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendTo(ws, { t: 'error', message: 'Некорректное сообщение' });
      return;
    }
    const msg = parsed.data;
    try {
      switch (msg.t) {
        case 'join':
          await this.handleJoin(ws, state, msg.nickname, msg.token, msg.protocolVersion, msg.create ?? false);
          return;
        case 'lobby_command':
          await this.handleLobbyCommand(state, ws, msg.command);
          return;
        case 'command':
          await this.handleCommand(state, ws, msg.command as DomainCommand);
          return;
        case 'hurry':
          await this.handleHurry(state, ws, msg.player, msg.target);
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
    const session = this.sessionOf(state, attachment.playerId);
    if (!session || !session.connected) return;

    session.connected = false;
    session.disconnectedAt = Date.now();

    if (state.phase === 'match' && state.match) {
      const player = state.match.players[session.playerId];
      // Выбывший игрок уже не влияет на партию — пауза не нужна.
      if (player && !player.eliminated) {
        // Пауза + таймер возврата от первого оборвавшегося (docs/NETWORK.md).
        if (!state.paused) {
          state.paused = true;
          state.reconnectDeadlineMs = Date.now() + config.reconnectWaitSeconds * 1000;
          for (const pid of Object.keys(state.timers)) {
            state.timers[pid] = pauseTimer(state.timers[pid]!, Date.now());
          }
        }
        this.scheduleBots(state, Date.now());
      }
      await this.persist();
      await this.scheduleAlarm(state, Date.now());
      this.broadcastSnapshots(state);
      this.broadcastTimer(state);
      this.broadcastLobbyInfo(state);
      return;
    }

    this.ensureHost(state);
    this.updateLobbyCleanup(state, Date.now());
    await this.persist();
    await this.scheduleAlarm(state, Date.now());
    this.broadcastLobbyInfo(state);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    const state = await this.load();
    const now = Date.now();
    let changed = false;

    if (state.lobbyCleanupAt !== null && now >= state.lobbyCleanupAt) {
      changed = this.cleanupLobbySessions(state, now) || changed;
    }

    if (state.reconnectDeadlineMs !== null && now >= state.reconnectDeadlineMs) {
      const gone = state.sessions
        .filter((s) => !s.isBot && !s.connected)
        .sort((a, b) => (a.disconnectedAt ?? 0) - (b.disconnectedAt ?? 0))[0];
      state.reconnectDeadlineMs = null;
      state.paused = false;
      if (gone && state.match && state.phase === 'match') {
        const res = applyCommand(
          state.match,
          { type: 'disconnect_loss', player: gone.playerId },
          domainDeps,
        );
        if (res.ok) {
          this.applyResult(state, res.state, res.events);
          this.broadcastEvents(res.events, state);
        }
      }
      changed = true;
    }

    if (state.phase === 'match' && state.match && !state.paused) {
      // Turn timer(s) expired — automatic battle per active player.
      for (const [pid, timer] of Object.entries(state.timers)) {
        if (!timer.running || !expired(timer, now)) continue;
        const before = state.match;
        const res = applyCommand(before, { type: 'time_expired', player: pid }, domainDeps);
        if (res.ok) {
          this.applyResult(state, res.state, res.events);
          this.refreshTimersAfterAction(state, before, res.state, pid);
          this.broadcastEvents(res.events, state);
        } else {
          delete state.timers[pid];
        }
        changed = true;
        break; // one timer per alarm; re-schedule immediately
      }

      if (state.phase === 'match' && state.botActionAt !== null && now >= state.botActionAt) {
        state.botActionAt = null;
        if (this.performBotAction(state)) changed = true;
      }
      this.scheduleBots(state, now);
    }

    // Persist even when only botActionAt/lobbyCleanupAt moved.
    await this.persist();
    if (changed) {
      this.broadcastSnapshots(state);
      this.broadcastLobbyInfo(state);
      this.broadcastTimer(state);
    }
    await this.scheduleAlarm(state, Date.now());
  }

  // --- join & lobby ---

  private async handleJoin(
    ws: WebSocket,
    state: RoomState,
    nickname: string,
    token: string | undefined,
    protocolVersion: number,
    create: boolean,
  ): Promise<void> {
    if (protocolVersion !== PROTOCOL_VERSION) {
      this.sendTo(ws, { t: 'error', message: 'Версия протокола устарела — обновите страницу' });
      return;
    }

    let session = token
      ? state.sessions.find((s) => s.token === token && !s.isBot)
      : undefined;
    const isReconnect = Boolean(session);

    if (!session && create && state.sessions.length > 0) {
      this.sendTo(ws, { t: 'error', code: 'room_exists', message: 'Код комнаты уже занят' });
      return;
    }

    if (session) {
      session.connected = true;
      session.disconnectedAt = null;
      if (session.nickname !== nickname) session.nickname = nickname;
    } else {
      if (state.phase !== 'lobby') {
        this.sendTo(ws, { t: 'error', message: 'Матч уже идёт — подключение возможно только по токену' });
        return;
      }
      this.cleanupLobbySessions(state, Date.now());
      let seat = this.freeSeat(state);
      if (seat === null) {
        this.evictOldestDisconnected(state);
        seat = this.freeSeat(state);
      }
      if (seat === null) {
        this.sendTo(ws, { t: 'error', message: 'Комната заполнена' });
        return;
      }
      const playerId = `p${state.nextPlayerNum++}`;
      session = {
        playerId,
        nickname,
        token: crypto.randomUUID(),
        connected: true,
        isBot: false,
        seat,
        ready: false,
        deck: presetDeck(deckPresets[seat % deckPresets.length]!),
        disconnectedAt: null,
      };
      state.sessions.push(session);
      if (!state.hostId) state.hostId = playerId;
    }

    ws.serializeAttachment({ playerId: session.playerId, token: session.token } satisfies WsAttachment);
    await this.persist();

    this.sendTo(ws, {
      t: 'joined',
      you: {
        playerId: session.playerId,
        token: session.token,
        isHost: state.hostId === session.playerId,
      },
      room: this.lobbyViewFor(state, session.playerId),
    });

    if (state.match) {
      if (isReconnect) await this.maybeResume(state);
      this.sendSnapshotTo(ws, state, session.playerId);
      this.broadcastSnapshots(state);
    }
    this.broadcastLobbyInfo(state);
    await this.persist();
    await this.scheduleAlarm(state, Date.now());
  }

  private async handleLobbyCommand(
    state: RoomState,
    ws: WebSocket,
    command: LobbyCommand,
  ): Promise<void> {
    const attachment = this.attachmentOf(ws);
    if (!attachment) {
      this.sendTo(ws, { t: 'error', message: 'Сначала войдите в комнату' });
      return;
    }
    const session = this.sessionOf(state, attachment.playerId);
    if (!session || session.isBot) {
      this.sendTo(ws, { t: 'error', message: 'Вы не участник лобби' });
      return;
    }
    if (state.phase !== 'lobby') {
      this.sendTo(ws, { t: 'error', message: 'Лобби уже закрыто' });
      return;
    }

    switch (command.type) {
      case 'ready':
        session.ready = command.ready;
        break;
      case 'set_deck': {
        const validated = validateDeck(command.deck, domainDeps);
        if (!validated.ok) {
          this.sendTo(ws, { t: 'error', message: validated.error });
          return;
        }
        session.deck = validated.deck;
        session.ready = false;
        break;
      }
      case 'set_mode':
        this.requireHost(state, session);
        state.mode = command.mode;
        break;
      case 'set_hidden':
        this.requireHost(state, session);
        state.hidden = command.hidden;
        break;
      case 'add_bot':
        this.requireHost(state, session);
        this.addBot(state);
        break;
      case 'remove_bot': {
        this.requireHost(state, session);
        const target = this.sessionOf(state, command.player);
        if (!target?.isBot) throw new Error('Это не бот');
        this.removeSession(state, target.playerId);
        break;
      }
      case 'kick': {
        this.requireHost(state, session);
        if (command.player === session.playerId) throw new Error('Нельзя кикнуть себя');
        const target = this.sessionOf(state, command.player);
        if (!target) throw new Error('Игрок не найден');
        this.removeSession(state, target.playerId);
        break;
      }
      case 'transfer_host': {
        this.requireHost(state, session);
        const target = this.sessionOf(state, command.player);
        if (!target || target.isBot) throw new Error('Хостом может стать только игрок');
        if (!target.connected) throw new Error('Игрок не в сети');
        state.hostId = target.playerId;
        break;
      }
      case 'move_player':
        this.requireHost(state, session);
        this.movePlayer(state, command.player, command.seat);
        break;
      case 'start': {
        this.requireHost(state, session);
        this.startMatch(state);
        this.scheduleBots(state, Date.now());
        await this.persist();
        this.broadcastLobbyInfo(state);
        this.broadcastSnapshots(state);
        await this.scheduleAlarm(state, Date.now());
        return;
      }
      case 'leave':
        this.removeSession(state, session.playerId);
        break;
    }

    this.updateLobbyCleanup(state, Date.now());
    await this.persist();
    await this.scheduleAlarm(state, Date.now());
    this.broadcastLobbyInfo(state);
  }

  private startMatch(state: RoomState): void {
    const seated = [...state.sessions].sort((a, b) => a.seat - b.seat);
    if (seated.length < config.minPlayers) throw new Error(`Нужно минимум ${config.minPlayers} игрока`);
    if (!seated.every((s) => s.isBot || s.connected)) throw new Error('Не все игроки в сети');
    if (!seated.every((s) => s.ready || s.isBot)) throw new Error('Не все игроки готовы');
    if (state.mode.kind === 'teams' && seated.length !== config.teamSize * 2) {
      throw new Error(`Для 2 на 2 нужно ровно ${config.teamSize * 2} игрока`);
    }
    for (const s of seated) {
      if (!s.deck) throw new Error(`У игрока ${s.nickname} не выбрана колода`);
    }

    const mode = state.mode;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const { state: match, events } = createMatch(domainDeps, {
      players: seated.map((s) => ({
        id: s.playerId,
        nickname: s.nickname,
        heroId: s.deck!.heroId,
        deck: [...s.deck!.cards],
        lands: [...s.deck!.lands],
      })),
      seed,
      mode: mode.kind === 'teams' ? 'teams' : 'ffa',
      teamVariant: mode.kind === 'teams' ? mode.variant : null,
    });

    state.match = match;
    state.phase = 'match';
    state.timers = {};
    state.paused = false;
    state.reconnectDeadlineMs = null;
    state.botActionAt = null;
    state.lobbyCleanupAt = null;
    state.journal.push(...this.stamp(journalLines(domainDeps, match, events)));
  }

  private addBot(state: RoomState): void {
    this.cleanupLobbySessions(state, Date.now());
    const seat = this.freeSeat(state);
    if (seat === null) throw new Error('Нет свободных мест');
    const num = state.nextBotNum++;
    state.sessions.push({
      playerId: `bot${num}`,
      nickname: `Бот ${num}`,
      token: crypto.randomUUID(),
      connected: true,
      isBot: true,
      seat,
      ready: true,
      deck: presetDeck(deckPresets[seat % deckPresets.length]!),
      disconnectedAt: null,
    });
  }

  private movePlayer(state: RoomState, playerId: string, seat: number): void {
    if (!Number.isInteger(seat) || seat < 0 || seat >= config.maxPlayers) {
      throw new Error('Неверный слот');
    }
    const target = this.sessionOf(state, playerId);
    if (!target) throw new Error('Игрок не найден');
    if (target.seat === seat) return;
    const occupant = state.sessions.find((s) => s.seat === seat);
    if (occupant) occupant.seat = target.seat;
    target.seat = seat;
  }

  private removeSession(state: RoomState, playerId: string): void {
    const sockets = this.socketsFor(playerId);
    state.sessions = state.sessions.filter((s) => s.playerId !== playerId);
    this.ensureHost(state);
    this.updateLobbyCleanup(state, Date.now());
    for (const ws of sockets) {
      this.sendTo(ws, { t: 'error', message: 'Вы вышли из комнаты' });
      ws.close(4000, 'removed');
    }
  }

  private freeSeat(state: RoomState): number | null {
    const used = new Set(state.sessions.map((s) => s.seat));
    for (let seat = 0; seat < config.maxPlayers; seat++) {
      if (!used.has(seat)) return seat;
    }
    return null;
  }

  private cleanupLobbySessions(state: RoomState, now: number): boolean {
    if (state.phase !== 'lobby') {
      state.lobbyCleanupAt = null;
      return false;
    }
    const limit = config.reconnectWaitSeconds * 1000;
    const before = state.sessions.length;
    state.sessions = state.sessions.filter(
      (s) => s.isBot || s.connected || s.disconnectedAt === null || now - s.disconnectedAt < limit,
    );
    this.ensureHost(state);
    this.updateLobbyCleanup(state, now);
    return state.sessions.length !== before;
  }

  private evictOldestDisconnected(state: RoomState): void {
    const gone = state.sessions
      .filter((s) => !s.isBot && !s.connected && s.disconnectedAt !== null)
      .sort((a, b) => (a.disconnectedAt ?? 0) - (b.disconnectedAt ?? 0))[0];
    if (gone) this.removeSession(state, gone.playerId);
  }

  private updateLobbyCleanup(state: RoomState, now: number): void {
    void now;
    if (state.phase !== 'lobby') {
      state.lobbyCleanupAt = null;
      return;
    }
    const limit = config.reconnectWaitSeconds * 1000;
    const deadlines = state.sessions
      .filter((s) => !s.isBot && !s.connected && s.disconnectedAt !== null)
      .map((s) => s.disconnectedAt! + limit);
    state.lobbyCleanupAt = deadlines.length > 0 ? Math.min(...deadlines) : null;
  }

  private ensureHost(state: RoomState): void {
    if (state.hostId && state.sessions.some((s) => s.playerId === state.hostId && !s.isBot)) {
      return;
    }
    const next =
      state.sessions
        .filter((s) => !s.isBot)
        .sort((a, b) => a.seat - b.seat)
        .find((s) => s.connected) ?? state.sessions.filter((s) => !s.isBot)[0];
    state.hostId = next?.playerId ?? null;
  }

  private requireHost(state: RoomState, session: Session): void {
    if (state.hostId !== session.playerId) throw new Error('Только хост может это сделать');
  }

  // --- match commands ---

  private async handleCommand(
    state: RoomState,
    ws: WebSocket,
    command: DomainCommand,
  ): Promise<void> {
    if (state.phase !== 'match' || !state.match) {
      this.sendTo(ws, { t: 'error', message: 'Матч не идёт' });
      return;
    }
    const attachment = this.attachmentOf(ws);
    if (!attachment) {
      this.sendTo(ws, { t: 'error', message: 'Сначала войдите в комнату' });
      return;
    }
    const session = this.sessionOf(state, attachment.playerId);
    if (!session || session.isBot) {
      this.sendTo(ws, { t: 'error', message: 'Вы не участник партии' });
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

    const before = state.match;
    const result = applyCommand(before, command, domainDeps);
    if (!result.ok) {
      this.sendTo(ws, { t: 'error', code: result.rejected.code, message: result.rejected.message });
      return;
    }

    this.applyResult(state, result.state, result.events);
    this.refreshTimersAfterAction(state, before, result.state, command.player);
    this.scheduleBots(state, Date.now());
    await this.persist();

    const now = Date.now();
    await this.scheduleAlarm(state, now);
    this.broadcastEvents(result.events, state);
    this.broadcastSnapshots(state);
    this.broadcastTimer(state);
    this.broadcastLobbyInfo(state);
  }

  private async handleHurry(
    state: RoomState,
    ws: WebSocket,
    player: string,
    target: string,
  ): Promise<void> {
    if (state.phase !== 'match' || !state.match || state.paused) return;
    const attachment = this.attachmentOf(ws);
    if (!attachment || player !== attachment.playerId) return;
    if (!state.match.activePlayers.includes(target)) return;
    if (target === attachment.playerId) return; // «Поторопить» — только чужой ход

    const now = Date.now();
    const current = state.timers[target] ?? stoppedTimer();
    state.timers[target] = hurryTimer(current, now, config).state;
    await this.persist();
    await this.scheduleAlarm(state, now);
    this.broadcastTimer(state);
  }

  private refreshTimersAfterAction(
    state: RoomState,
    before: MatchState,
    after: MatchState,
    playerId: string,
  ): void {
    const activeChanged =
      before.activePlayers.length !== after.activePlayers.length ||
      before.activePlayers.some((pid, i) => pid !== after.activePlayers[i]);
    if (before.turn !== after.turn || activeChanged || after.status === 'finished') {
      state.timers = {};
      return;
    }
    if (after.players[playerId]?.battleReady) {
      delete state.timers[playerId];
    }
  }

  private applyResult(state: RoomState, match: MatchState, events: GameEvent[]): void {
    state.match = match;
    state.journal.push(...this.stamp(journalLines(domainDeps, match, events)));
    if (match.status === 'finished') {
      state.phase = 'finished';
      state.timers = {};
      state.paused = false;
      state.reconnectDeadlineMs = null;
      state.botActionAt = null;
      state.lobbyCleanupAt = null;
    }
  }

  private stamp(lines: string[]): string[] {
    const time = new Date().toISOString().slice(11, 19);
    return lines.map((line) => `${time} — ${line}`);
  }

  // --- bots ---

  private botsNeedAction(state: RoomState): boolean {
    if (!state.match || state.phase !== 'match' || state.paused) return false;
    if (state.match.status === 'mulligan') {
      return state.sessions.some(
        (s) => s.isBot && state.match!.mulliganDecisions[s.playerId] === undefined,
      );
    }
    if (state.match.status !== 'running') return false;
    return state.match.activePlayers.some((pid) => {
      const session = this.sessionOf(state, pid);
      return Boolean(session?.isBot) && !state.match!.players[pid]!.battleReady;
    });
  }

  private scheduleBots(state: RoomState, now: number): void {
    if (!this.botsNeedAction(state)) {
      state.botActionAt = null;
      return;
    }
    if (state.botActionAt === null || state.botActionAt <= now) {
      state.botActionAt = now + BOT_ACTION_DELAY_MS;
    }
  }

  private performBotAction(state: RoomState): boolean {
    const match = state.match;
    if (!match || state.phase !== 'match') return false;
    const before = match;

    let botId: string | null = null;
    let command: DomainCommand | null = null;

    if (match.status === 'mulligan') {
      const bot = state.sessions.find(
        (s) => s.isBot && match.mulliganDecisions[s.playerId] === undefined,
      );
      if (!bot) return false;
      botId = bot.playerId;
      command = { type: 'keep_hand', player: botId };
    } else if (match.status === 'running') {
      for (const pid of match.activePlayers) {
        const session = this.sessionOf(state, pid);
        if (!session?.isBot || match.players[pid]!.battleReady) continue;
        botId = pid;
        const view = viewFor(domainDeps, match, pid, {
          journal: state.journal,
          connected: this.connectedMap(state),
        });
        command =
          (decideBotCommand(view, { catalog, config }) as DomainCommand | null) ??
          { type: 'go_battle', player: pid };
        break;
      }
    }
    if (!botId || !command) return false;

    let result = applyCommand(before, command, domainDeps);
    if (!result.ok && command.type !== 'go_battle') {
      result = applyCommand(before, { type: 'go_battle', player: botId }, domainDeps);
    }
    if (!result.ok) return false;

    this.applyResult(state, result.state, result.events);
    this.refreshTimersAfterAction(state, before, result.state, botId);
    this.broadcastEvents(result.events, state);
    return true;
  }

  // --- helpers ---

  private lobbyViewFor(state: RoomState, viewerId: string): LobbyView {
    const slots: Array<LobbyView['slots'][number]> = Array.from(
      { length: config.maxPlayers },
      () => null,
    );
    for (const s of state.sessions) {
      if (s.seat < 0 || s.seat >= config.maxPlayers) continue;
      const showDeck = !state.hidden || s.playerId === viewerId;
      slots[s.seat] = {
        id: s.playerId,
        nickname: s.nickname,
        connected: s.connected,
        ready: s.isBot || s.ready,
        isBot: s.isBot,
        deck:
          showDeck && s.deck
            ? {
                heroId: s.deck.heroId,
                lands: [...s.deck.lands],
                cards: [...s.deck.cards],
              }
            : null,
      };
    }
    return {
      code: this.ctx.id.name ?? '----',
      host: state.hostId,
      mode: state.mode,
      hidden: state.hidden,
      slots,
      minPlayers: config.minPlayers,
      maxPlayers: config.maxPlayers,
      started: state.phase !== 'lobby',
    };
  }

  private sessionOf(state: RoomState, playerId: string): Session | undefined {
    return state.sessions.find((s) => s.playerId === playerId);
  }

  private connectedMap(state: RoomState): Record<string, boolean> {
    return Object.fromEntries(state.sessions.map((s) => [s.playerId, s.connected]));
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
    for (const session of state.sessions) {
      if (session.isBot || !session.connected) continue;
      const message = { t: 'lobby', room: this.lobbyViewFor(state, session.playerId) };
      for (const ws of this.socketsFor(session.playerId)) this.sendTo(ws, message);
    }
  }

  private timerInfo(state: RoomState, now: number): TimerInfo {
    const timers = Object.entries(state.timers).map(([player, timer]) => {
      const remaining = state.paused ? timer.remainingMs : advance(timer, now).remainingMs;
      return {
        player,
        running: timer.running,
        remainingMs: Math.max(0, remaining),
      };
    });
    return { paused: state.paused, serverNowMs: now, timers };
  }

  private sendSnapshotTo(ws: WebSocket, state: RoomState, playerId: string): void {
    if (!state.match) return;
    const view = viewFor(domainDeps, state.match, playerId, {
      journal: state.journal,
      connected: this.connectedMap(state),
    });
    this.sendTo(ws, { t: 'snapshot', view, timer: this.timerInfo(state, Date.now()) });
  }

  private broadcastSnapshots(state: RoomState): void {
    if (!state.match) return;
    for (const session of state.sessions) {
      if (session.isBot || !session.connected) continue;
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

  private async maybeResume(state: RoomState): Promise<void> {
    if (!state.match || state.phase !== 'match' || !state.paused) return;
    const anyoneDisconnected = state.sessions.some((s) => !s.isBot && !s.connected);
    if (anyoneDisconnected) return;
    const now = Date.now();
    state.paused = false;
    state.reconnectDeadlineMs = null;
    for (const pid of Object.keys(state.timers)) {
      state.timers[pid] = resumeTimer(state.timers[pid]!, now);
    }
    this.scheduleBots(state, now);
  }

  /** Keep a single alarm at the nearest deadline. */
  private async scheduleAlarm(state: RoomState, now: number): Promise<void> {
    const deadlines: number[] = [];
    if (state.lobbyCleanupAt !== null) deadlines.push(state.lobbyCleanupAt);
    if (state.reconnectDeadlineMs !== null) deadlines.push(state.reconnectDeadlineMs);
    if (state.botActionAt !== null && state.phase === 'match' && !state.paused) {
      deadlines.push(state.botActionAt);
    }
    if (state.phase === 'match' && !state.paused) {
      for (const timer of Object.values(state.timers)) {
        const deadline = deadlineMs(timer, now);
        if (deadline !== null) deadlines.push(deadline + 50);
      }
    }
    if (deadlines.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const next = Math.min(...deadlines);
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== next) await this.ctx.storage.setAlarm(next);
  }
}

const inputSchema = ClientMessageSchema;
