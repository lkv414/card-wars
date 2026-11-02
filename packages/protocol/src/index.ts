import { z } from 'zod';

export { CONFIG } from './config';

// Wire protocol between the client and the Room Durable Object (docs/TECH.md «Протокол»).
// Schemas are the single source of truth for the wire shapes; application and
// client use the inferred types. zod lives only here and at the adapters.
// Rule constants (deck size, copy limit, …) are validated on the server against
// CONFIG, not duplicated in these schemas.

export const PROTOCOL_VERSION = 2;

// --- Personal view (docs/NETWORK.md «Персональный вид состояния») ---

export const LandViewSchema = z.object({
  type: z.string(),
  frozen: z.boolean(),
  flipped: z.boolean(),
});

export const CardViewSchema = z.object({
  instanceId: z.string(),
  cardId: z.string(),
  damage: z.number(),
  shield: z.number(),
  bonusAttack: z.number(),
  bonusDefense: z.number(),
  flipped: z.boolean(),
  effAttack: z.number(),
  effDefense: z.number(),
});

export const ZoneViewSchema = z.object({
  creature: CardViewSchema.nullable(),
  building: CardViewSchema.nullable(),
});

export const DiscardCardViewSchema = z.object({
  instanceId: z.string(),
  cardId: z.string(),
});

export const SpellViewSchema = z.object({
  instanceId: z.string(),
  cardId: z.string(),
  player: z.string(),
});

export const TeamViewSchema = z.object({
  id: z.string(),
  playerIds: z.array(z.string()),
  lives: z.number(),
  maxLives: z.number(),
  eliminated: z.boolean(),
});

export const PlayerPublicViewSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  heroId: z.string(),
  lives: z.number(),
  maxLives: z.number(),
  actions: z.number(),
  connected: z.boolean(),
  lands: z.array(LandViewSchema),
  zones: z.array(ZoneViewSchema),
  deckCount: z.number(),
  handCount: z.number(),
  discard: z.array(DiscardCardViewSchema),
  companion: CardViewSchema.nullable(),
  surrendered: z.boolean(),
  eliminated: z.boolean(),
  teamId: z.string().nullable(),
  battleReady: z.boolean(),
  mulliganDecision: z.enum(['keep', 'mulligan']).nullable(),
});

export const PlayerViewSchema = z.object({
  status: z.enum(['mulligan', 'running', 'finished']),
  phase: z.enum(['draw', 'main', 'combat']),
  mode: z.enum(['ffa', 'teams']),
  teamVariant: z.enum(['neighbors', 'wall']).nullable(),
  teams: z.record(z.string(), TeamViewSchema).nullable(),
  turn: z.number(),
  round: z.number(),
  activePlayers: z.array(z.string()),
  activePlayer: z.string(),
  order: z.array(z.string()),
  me: z.string(),
  players: z.record(z.string(), PlayerPublicViewSchema),
  myHand: z.array(DiscardCardViewSchema),
  castSpells: z.array(SpellViewSchema),
  winners: z.array(z.string()).nullable(),
  finishReason: z.enum(['elimination', 'surrender', 'disconnect']).nullable(),
  journal: z.array(z.string()),
});

export type LandView = z.infer<typeof LandViewSchema>;
export type CardView = z.infer<typeof CardViewSchema>;
export type ZoneView = z.infer<typeof ZoneViewSchema>;
export type DiscardCardView = z.infer<typeof DiscardCardViewSchema>;
export type SpellView = z.infer<typeof SpellViewSchema>;
export type TeamView = z.infer<typeof TeamViewSchema>;
export type PlayerPublicView = z.infer<typeof PlayerPublicViewSchema>;
export type PlayerView = z.infer<typeof PlayerViewSchema>;

// --- Match commands (mirror of the domain Command union; adapter validates then forwards) ---

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mulligan'), player: z.string() }),
  z.object({ type: z.literal('keep_hand'), player: z.string() }),
  z.object({
    type: z.literal('play_card'),
    player: z.string(),
    instanceId: z.string(),
    zone: z.number().optional(),
    unfreezeWith: z.string().optional(),
  }),
  z.object({
    type: z.literal('floop'),
    player: z.string(),
    instanceId: z.string(),
  }),
  z.object({ type: z.literal('draw_extra'), player: z.string() }),
  z.object({
    type: z.literal('discard_from_hand'),
    player: z.string(),
    instanceId: z.string(),
    unfreezeZone: z.number().optional(),
  }),
  z.object({
    type: z.literal('discard_from_field'),
    player: z.string(),
    instanceId: z.string(),
  }),
  z.object({ type: z.literal('go_battle'), player: z.string() }),
  z.object({ type: z.literal('time_expired'), player: z.string() }),
  z.object({ type: z.literal('surrender'), player: z.string() }),
]);

export type Command = z.infer<typeof CommandSchema>;

// --- Lobby (docs/COMMANDS.md «Лобби») ---

export const LobbyDeckSchema = z.object({
  heroId: z.string(),
  lands: z.array(z.string()).max(16),
  cards: z.array(z.string()).max(200),
});

export const LobbyModeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ffa') }),
  z.object({ kind: z.literal('teams'), variant: z.enum(['neighbors', 'wall']) }),
]);

export const LobbySlotSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  connected: z.boolean(),
  ready: z.boolean(),
  isBot: z.boolean(),
  deck: LobbyDeckSchema.nullable(),
});

export const LobbyViewSchema = z.object({
  code: z.string(),
  host: z.string().nullable(),
  mode: LobbyModeSchema,
  hidden: z.boolean(),
  slots: z.array(LobbySlotSchema.nullable()),
  minPlayers: z.number(),
  maxPlayers: z.number(),
  started: z.boolean(),
});

export type LobbyDeck = z.infer<typeof LobbyDeckSchema>;
export type LobbyMode = z.infer<typeof LobbyModeSchema>;
export type LobbySlot = z.infer<typeof LobbySlotSchema>;
export type LobbyView = z.infer<typeof LobbyViewSchema>;

export const LobbyCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), ready: z.boolean() }),
  z.object({ type: z.literal('set_deck'), deck: LobbyDeckSchema }),
  z.object({ type: z.literal('set_mode'), mode: LobbyModeSchema }),
  z.object({ type: z.literal('set_hidden'), hidden: z.boolean() }),
  z.object({ type: z.literal('add_bot') }),
  z.object({ type: z.literal('remove_bot'), player: z.string() }),
  z.object({ type: z.literal('kick'), player: z.string() }),
  z.object({ type: z.literal('transfer_host'), player: z.string() }),
  z.object({ type: z.literal('move_player'), player: z.string(), seat: z.number() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('leave') }),
]);

export type LobbyCommand = z.infer<typeof LobbyCommandSchema>;

// --- Timer (per active player in 2v2 — docs/NETWORK.md «Таймеры») ---

export const TimerSlotSchema = z.object({
  player: z.string(),
  running: z.boolean(),
  remainingMs: z.number(),
});

export const TimerInfoSchema = z.object({
  paused: z.boolean(),
  serverNowMs: z.number(),
  timers: z.array(TimerSlotSchema),
});

export type TimerSlotInfo = z.infer<typeof TimerSlotSchema>;
export type TimerInfo = z.infer<typeof TimerInfoSchema>;

// --- Wire messages ---

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('join'),
    code: z.string(),
    nickname: z.string().min(1).max(20),
    token: z.string().optional(),
    protocolVersion: z.number(),
    /** «Создать лобби»: сервер откажет, если комната с таким кодом уже существует. */
    create: z.boolean().optional(),
  }),
  z.object({ t: z.literal('lobby_command'), command: LobbyCommandSchema }),
  z.object({ t: z.literal('command'), command: CommandSchema }),
  z.object({ t: z.literal('hurry'), player: z.string(), target: z.string() }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** Domain events travel as passthrough JSON: our server produced them, the client renders them. */
export const GameEventWireSchema = z.object({ type: z.string() }).passthrough();
export type GameEvent = z.infer<typeof GameEventWireSchema>;

export const ServerMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('joined'),
    you: z.object({ playerId: z.string(), token: z.string(), isHost: z.boolean() }),
    room: LobbyViewSchema,
  }),
  z.object({ t: z.literal('lobby'), room: LobbyViewSchema }),
  z.object({
    t: z.literal('snapshot'),
    view: PlayerViewSchema,
    timer: TimerInfoSchema.nullable(),
  }),
  z.object({ t: z.literal('events'), events: z.array(GameEventWireSchema) }),
  z.object({ t: z.literal('error'), message: z.string(), code: z.string().optional() }),
  z.object({ t: z.literal('timer'), timer: TimerInfoSchema }),
  z.object({
    t: z.literal('finished'),
    winners: z.array(z.string()),
    reason: z.enum(['elimination', 'surrender', 'disconnect']),
  }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
