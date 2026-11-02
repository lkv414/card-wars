import { computeEff } from '@card-wars/domain';
import type { DomainDeps, MatchState, PlayerId } from '@card-wars/domain';
import type { CardView, PendingChoiceView, PlayerPublicView, PlayerView, TeamView } from '@card-wars/protocol';

export interface ViewOptions {
  /** Journal lines accumulated by the server (already time-stamped). */
  journal?: string[];
  /** Live connection flags maintained by the Room; defaults to true. */
  connected?: Record<PlayerId, boolean>;
}

function cardView(
  deps: DomainDeps,
  state: MatchState,
  instanceId: string,
): CardView {
  const inst = state.instances[instanceId]!;
  const eff = computeEff(state, deps, instanceId);
  return {
    instanceId,
    cardId: inst.cardId,
    damage: inst.damage,
    shield: inst.shield,
    bonusAttack: inst.bonusAttack,
    bonusDefense: inst.bonusDefense,
    flipped: inst.flipped,
    effAttack: eff.attack,
    effDefense: eff.defense,
  };
}

/** Which ask of which ability is awaited (total count read from the catalog). */
function pendingView(deps: DomainDeps, state: MatchState): PendingChoiceView {
  const pending = state.pending!;
  let askCount: number | undefined;
  if (pending.ask.kind === 'target') {
    const ability = pending.current.instanceId
      ? deps.catalog.getCard(state.instances[pending.current.instanceId]!.cardId)?.abilities?.[pending.current.abilityIndex]
      : deps.catalog.getHero(state.players[pending.current.player]!.heroId)?.ability;
    askCount = ability?.targets?.length;
  }
  return {
    player: pending.player,
    kind: pending.ask.kind,
    askIndex: pending.ask.kind === 'target' ? pending.ask.askIndex : undefined,
    askCount,
  };
}

/**
 * The ONLY place a personal view of the match is built (docs/NETWORK.md).
 * Opponent hands and deck contents never leave this function: the view carries
 * counts only. Everything else is public by the rules.
 */
export function viewFor(
  deps: DomainDeps,
  state: MatchState,
  me: PlayerId,
  options: ViewOptions = {},
): PlayerView {
  const players: Record<string, PlayerPublicView> = {};
  for (const pid of state.order) {
    const p = state.players[pid]!;
    players[pid] = {
      id: p.id,
      nickname: p.nickname,
      heroId: p.heroId,
      lives: p.lives,
      maxLives: p.maxLives,
      actions: p.actions,
      connected: options.connected?.[pid] ?? true,
      lands: p.lands.map((land) => ({ type: land.type, frozen: land.frozen, flipped: land.flipped })),
      zones: p.zones.map((zone) => ({
        creature: zone.creature ? cardView(deps, state, zone.creature) : null,
        building: zone.building ? cardView(deps, state, zone.building) : null,
      })),
      deckCount: p.deck.length,
      handCount: p.hand.length,
      discard: p.discard.map((id) => ({ instanceId: id, cardId: state.instances[id]!.cardId })),
      companion: p.companion ? cardView(deps, state, p.companion) : null,
      surrendered: p.surrendered,
      eliminated: p.eliminated,
      teamId: p.teamId,
      battleReady: p.battleReady,
      mulliganDecision: state.status === 'mulligan' ? (state.mulliganDecisions[pid] ?? null) : null,
    };
  }

  const teams: Record<string, TeamView> | null = state.teams
    ? Object.fromEntries(
        Object.entries(state.teams).map(([id, team]) => [
          id,
          {
            id: team.id,
            playerIds: [...team.playerIds],
            lives: team.lives,
            maxLives: team.maxLives,
            eliminated: team.eliminated,
          },
        ]),
      )
    : null;

  const myPlayer = state.players[me];
  if (!myPlayer) throw new Error(`viewFor: unknown player ${me}`);

  return {
    status: state.status,
    phase: state.phase,
    mode: state.mode,
    teamVariant: state.teamVariant,
    teams,
    turn: state.turn,
    round: state.round,
    activePlayers: [...state.activePlayers],
    activePlayer: state.activePlayer,
    order: state.order,
    me,
    players,
    myHand: myPlayer.hand.map((id) => ({ instanceId: id, cardId: state.instances[id]!.cardId })),
    castSpells: state.castSpells.map((id) => ({
      instanceId: id,
      cardId: state.instances[id]!.cardId,
      player: state.instances[id]!.controller,
    })),
    // Fact of awaiting only — the prompt itself is rendered from catalog data.
    pending: state.pending ? pendingView(deps, state) : null,
    winners: state.winners,
    finishReason: state.finishReason,
    journal: options.journal ?? [],
  };
}
