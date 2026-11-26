import type { CardCatalog, CardData, GameConfig, TargetAsk } from '@card-wars/domain';
import type { Command, PlayerView, TargetChoice } from '@card-wars/protocol';

// Server-side bot heuristic (docs/NETWORK.md «Боты»). Purely a function of the
// bot's personal view + public catalog: hidden cards of other players are never used.
// Resolves choices/targets, plays cards, floops, draws extra and goes to battle.

export interface BotDeps {
  catalog: CardCatalog;
  config: GameConfig;
}

type CardSlot = 'creature' | 'building';

function cardOf(deps: BotDeps, cardId: string): CardData | undefined {
  return deps.catalog.getCard(cardId);
}

function opponentsOfView(view: PlayerView): string[] {
  const me = view.players[view.me]!;
  return view.order.filter((pid) => {
    if (pid === view.me) return false;
    const p = view.players[pid]!;
    if (p.eliminated) return false;
    if (me.teamId && p.teamId === me.teamId) return false;
    return true;
  });
}

function cardPassesAskFilter(
  view: PlayerView,
  deps: BotDeps,
  pid: string,
  zone: number,
  card: { cardId: string; flipped: boolean },
  filter: TargetAsk['filter'],
): boolean {
  if (!filter) return true;
  if (filter.ready && card.flipped) return false;
  const meta = cardOf(deps, card.cardId);
  if (filter.landType && meta?.landType !== filter.landType && view.players[pid]?.lands[zone]?.type !== filter.landType) {
    return false;
  }
  if (filter.cardType && meta?.type !== filter.cardType) return false;
  if (filter.maxCost !== undefined && (meta?.cost ?? 99) > filter.maxCost) return false;
  if (filter.cardIds && !filter.cardIds.includes(card.cardId)) return false;
  return true;
}

function pickTargetForAsk(view: PlayerView, deps: BotDeps, ask: TargetAsk): TargetChoice | null {
  const me = view.players[view.me]!;
  const opponents = opponentsOfView(view);

  if (ask.kind === 'any_player' || ask.kind === 'opponent_player') {
    const targetPid = opponents[0] ?? view.order.find((p) => p !== view.me) ?? view.me;
    return { kind: 'player', playerId: targetPid };
  }
  if (
    ask.kind === 'any_creature' ||
    ask.kind === 'opponent_creature' ||
    ask.kind === 'lane_creature' ||
    ask.kind === 'lane_opponent_creature'
  ) {
    for (const pid of opponents) {
      const zones = view.players[pid]!.zones;
      for (let z = 0; z < zones.length; z++) {
        const c = zones[z]!.creature;
        if (c && cardPassesAskFilter(view, deps, pid, z, c, ask.filter)) {
          return { kind: 'creature', instanceId: c.instanceId };
        }
      }
    }
    if (ask.kind !== 'opponent_creature' && ask.kind !== 'lane_opponent_creature') {
      for (let z = 0; z < me.zones.length; z++) {
        const c = me.zones[z]!.creature;
        if (c && cardPassesAskFilter(view, deps, view.me, z, c, ask.filter)) {
          return { kind: 'creature', instanceId: c.instanceId };
        }
      }
    }
    return null;
  }
  if (ask.kind === 'own_creature' || ask.kind === 'adjacent_creature') {
    for (let z = 0; z < me.zones.length; z++) {
      const c = me.zones[z]!.creature;
      if (c && cardPassesAskFilter(view, deps, view.me, z, c, ask.filter)) {
        return { kind: 'creature', instanceId: c.instanceId };
      }
    }
    return null;
  }
  if (ask.kind === 'own_building') {
    for (let z = 0; z < me.zones.length; z++) {
      const b = me.zones[z]!.building;
      if (b && cardPassesAskFilter(view, deps, view.me, z, b, ask.filter)) {
        return { kind: 'card', instanceId: b.instanceId };
      }
    }
    return null;
  }
  if (ask.kind === 'opponent_building' || ask.kind === 'any_building') {
    for (const pid of opponents) {
      const zones = view.players[pid]!.zones;
      for (let z = 0; z < zones.length; z++) {
        const b = zones[z]!.building;
        if (b && cardPassesAskFilter(view, deps, pid, z, b, ask.filter)) {
          return { kind: 'card', instanceId: b.instanceId };
        }
      }
    }
    return null;
  }
  if (ask.kind === 'landscape' || ask.kind === 'own_landscape') {
    for (let z = 0; z < me.lands.length; z++) {
      const land = me.lands[z]!;
      if (ask.filter?.landType && land.type !== ask.filter.landType) continue;
      return { kind: 'landscape', player: view.me, zone: z };
    }
    return { kind: 'landscape', player: view.me, zone: 0 };
  }
  if (ask.kind === 'own_hand_card') {
    for (const c of view.myHand) {
      const meta = cardOf(deps, c.cardId);
      if (ask.filter?.cardType && meta?.type !== ask.filter.cardType) continue;
      if (ask.filter?.maxCost !== undefined && (meta?.cost ?? 99) > ask.filter.maxCost) continue;
      return { kind: 'card', instanceId: c.instanceId };
    }
    return null;
  }
  if (ask.kind === 'heal_or_damage') {
    return { kind: 'mode', mode: 'damage' };
  }
  if (ask.kind === 'choose_option') {
    return { kind: 'option', option: ask.options?.[0] ?? 'corn' };
  }
  if (ask.kind === 'amount') {
    return { kind: 'amount', value: ask.min ?? 1 };
  }
  if (
    ask.kind === 'revealed_card' ||
    ask.kind === 'visible_card' ||
    ask.kind === 'own_discard_card' ||
    ask.kind === 'any_discard_card'
  ) {
    const revealed = view.revealed[view.me];
    if (revealed && revealed.length > 0) {
      return { kind: 'card', instanceId: revealed[0]!.instanceId };
    }
    if (me.discard.length > 0) {
      return { kind: 'card', instanceId: me.discard[0]!.instanceId };
    }
    return null;
  }
  return null;
}

function buildTargetsList(view: PlayerView, deps: BotDeps, asks: TargetAsk[] | undefined): TargetChoice[] | null {
  if (!asks || asks.length === 0) return [];
  const out: TargetChoice[] = [];
  for (const ask of asks) {
    const choice = pickTargetForAsk(view, deps, ask);
    if (!choice) return null;
    out.push(choice);
  }
  return out;
}

function resolvePendingForBot(view: PlayerView, deps: BotDeps): Command {
  const pending = view.pending!;
  if (pending.kind === 'optional') {
    return {
      type: 'resolve_choice',
      player: view.me,
      answer: { proceed: true },
    };
  }

  const me = view.players[view.me]!;
  const ability = pending.cardId
    ? cardOf(deps, pending.cardId)?.abilities?.[pending.abilityIndex ?? 0]
    : deps.catalog.getHero(me.heroId)?.ability;
  const ask = ability?.targets?.[pending.askIndex ?? 0];
  const picked = ask ? pickTargetForAsk(view, deps, ask) : null;

  return {
    type: 'resolve_choice',
    player: view.me,
    answer: picked ? { targets: [picked] } : {},
  };
}

function findFloop(view: PlayerView, deps: BotDeps): Command | null {
  const me = view.players[view.me]!;
  if (view.round === 1 && (view.mode === 'teams' || view.activePlayer === view.order[0])) {
    return null; // floop forbidden on round 1 active turn
  }
  for (let i = 0; i < me.zones.length; i++) {
    const creature = me.zones[i]!.creature;
    if (!creature || creature.flipped) continue;
    const meta = cardOf(deps, creature.cardId);
    const active = meta?.abilities?.find((a) => a.kind === 'active');
    if (!active) continue;
    const cost = active.cost ?? 0;
    if (cost <= me.actions && !active.additionalCost) {
      const targets = buildTargetsList(view, deps, active.targets);
      if (targets === null) continue;
      return targets.length > 0
        ? { type: 'floop', player: view.me, instanceId: creature.instanceId, targets }
        : { type: 'floop', player: view.me, instanceId: creature.instanceId };
    }
  }
  return null;
}

function landRequirementMet(view: PlayerView, landType: string, required: number): boolean {
  const me = view.players[view.me]!;
  let count = 0;
  for (const land of me.lands) {
    if (land.flipped) continue;
    if (landType === 'rainbow' || land.type === 'rainbow' || land.type === landType) count++;
  }
  return count >= required;
}

function emptyZone(view: PlayerView, slot: CardSlot): number | null {
  const me = view.players[view.me]!;
  for (let i = 0; i < me.zones.length; i++) {
    if (me.zones[i]![slot] !== null) continue;
    if (me.lands[i]?.frozen) continue; // играть можно только после разморозки
    return i;
  }
  return null;
}

function findPlay(view: PlayerView, deps: BotDeps): Command | null {
  const me = view.players[view.me]!;
  let best: { score: number; command: Command } | null = null;

  for (const card of view.myHand) {
    const meta = cardOf(deps, card.cardId);
    if (!meta || meta.cost > me.actions) continue;
    if (!view.anyLand && !landRequirementMet(view, meta.landType, deps.config.landRequirementPerCard)) continue;

    if (meta.type === 'companion') {
      if (view.mode !== 'teams') continue;
      if (me.companion) continue;
      const score = 5 + meta.cost;
      if (!best || score > best.score) {
        best = { score, command: { type: 'play_card', player: view.me, instanceId: card.instanceId } };
      }
      continue;
    }

    if (meta.type === 'spell') {
      const castAbility = meta.abilities?.find((a) => a.trigger === 'on_cast');
      if (castAbility?.additionalCost) continue;
      const targets = buildTargetsList(view, deps, castAbility?.targets);
      if (targets === null) continue;
      const score = 20 + meta.cost * 10;
      if (!best || score > best.score) {
        best = {
          score,
          command:
            targets.length > 0
              ? { type: 'play_card', player: view.me, instanceId: card.instanceId, targets }
              : { type: 'play_card', player: view.me, instanceId: card.instanceId },
        };
      }
      continue;
    }

    const slot: CardSlot = meta.type === 'creature' ? 'creature' : 'building';
    const zone = emptyZone(view, slot);
    if (zone === null) continue;
    const score = (meta.attack ?? 0) + (meta.defense ?? 0) + meta.cost * 10 + (slot === 'creature' ? 5 : 0);
    if (!best || score > best.score) {
      best = {
        score,
        command: { type: 'play_card', player: view.me, instanceId: card.instanceId, zone },
      };
    }
  }
  return best?.command ?? null;
}

function shouldMulligan(view: PlayerView, deps: BotDeps): boolean {
  const cheap = view.myHand.filter((card) => {
    const meta = cardOf(deps, card.cardId);
    return meta ? meta.cost <= 2 : false;
  }).length;
  return cheap < 2;
}

/** One command for a bot that needs to act, or null when it should wait. */
export function decideBotCommand(view: PlayerView, deps: BotDeps): Command | null {
  const me = view.players[view.me]!;

  if (view.status === 'mulligan') {
    if (me.mulliganDecision !== null) return null;
    return shouldMulligan(view, deps)
      ? { type: 'mulligan', player: view.me }
      : { type: 'keep_hand', player: view.me };
  }

  // Answer pending choice if awaiting this bot
  if (view.pending && view.pending.player === view.me) {
    return resolvePendingForBot(view, deps);
  }

  // Match-start word choice for hero ability
  const heroSetup = deps.catalog.getHero(me.heroId)?.wordSetup;
  if (view.status === 'running' && heroSetup && !view.myWord) {
    const word = 'карта'.slice(0, Math.max(heroSetup.min, 5));
    return { type: 'choose_word', player: view.me, word };
  }

  if (view.status !== 'running') return null;
  if (!view.activePlayers.includes(view.me)) return null;
  if (me.battleReady) return null;
  if (view.phase !== 'main') return null;

  if (me.actions > 0) {
    const play = findPlay(view, deps);
    if (play) return play;

    const floop = findFloop(view, deps);
    if (floop) return floop;

    if (me.actions >= deps.config.extraDrawCost && me.deckCount > 5 && me.handCount < 8) {
      return { type: 'draw_extra', player: view.me };
    }
  }
  return { type: 'go_battle', player: view.me };
}
