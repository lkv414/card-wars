import { z } from 'zod';

// Wire protocol between the client and the Room Durable Object (docs/TECH.md «Протокол»).
// Schemas are the single source of truth for the wire shapes; application and
// client use the inferred types. zod lives only here and at the adapters.

export const PROTOCOL_VERSION = 1;

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
  surrendered: z.boolean(),
  eliminated: z.boolean(),
  mulliganDecision: z.enum(['keep', 'mulligan']).nullable(),
});

export const PlayerViewSchema = z.object({
  status: z.enum(['mulligan', 'running', 'finished']),
  phase: z.enum(['draw', 'main', 'combat']),
  turn: z.number(),
  round: z.number(),
  activePlayer: z.string(),
  order: z.array(z.string()),
  me: z.string(),
  players: z.record(z.string(), PlayerPublicViewSchema),
  myHand: z.array(DiscardCardViewSchema),
  castSpells: z.array(DiscardCardViewSchema),
  winners: z.array(z.string()).nullable(),
  finishReason: z.enum(['elimination', 'surrender', 'disconnect']).nullable(),
  journal: z.array(z.string()),
});

export type LandView = z.infer<typeof LandViewSchema>;
export type CardView = z.infer<typeof CardViewSchema>;
export type ZoneView = z.infer<typeof ZoneViewSchema>;
export type DiscardCardView = z.infer<typeof DiscardCardViewSchema>;
export type PlayerPublicView = z.infer<typeof PlayerPublicViewSchema>;
export type PlayerView = z.infer<typeof PlayerViewSchema>;

// --- Commands (mirror of the domain Command union; adapter validates then forwards) ---

export const CommandChoicesSchema = z.object({
  creature: z.string().optional(),
  opponent: z.string().optional(),
  landscape: z.object({ player: z.string(), zone: z.number() }).optional(),
});

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mulligan'), player: z.string() }),
  z.object({ type: z.literal('keep_hand'), player: z.string() }),
  z.object({
    type: z.literal('play_card'),
    player: z.string(),
    instanceId: z.string(),
    zone: z.number().optional(),
    unfreezeWith: z.string().optional(),
    choices: CommandChoicesSchema.optional(),
  }),
  z.object({
    type: z.literal('floop'),
    player: z.string(),
    instanceId: z.string(),
    choices: CommandChoicesSchema.optional(),
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

// --- Lobby ---

export const LobbyPlayerSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  connected: z.boolean(),
});

export const LobbyViewSchema = z.object({
  code: z.string(),
  host: z.string().nullable(),
  players: z.array(LobbyPlayerSchema),
  started: z.boolean(),
});

export type LobbyView = z.infer<typeof LobbyViewSchema>;

// --- Timer ---

export const TimerInfoSchema = z.object({
  running: z.boolean(),
  paused: z.boolean(),
  remainingMs: z.number(),
  serverNowMs: z.number(),
});

export type TimerInfo = z.infer<typeof TimerInfoSchema>;

// --- Wire messages ---

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('join'),
    code: z.string(),
    nickname: z.string().min(1).max(20),
    token: z.string().optional(),
    protocolVersion: z.number(),
  }),
  z.object({ t: z.literal('start'), player: z.string() }),
  z.object({ t: z.literal('command'), command: CommandSchema }),
  z.object({ t: z.literal('hurry'), player: z.string() }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** Domain events travel as passthrough JSON: our server produced them, the client renders them. */
const GameEventWireSchema = z.object({ type: z.string() }).passthrough();

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
