import type { CardCatalog, CardData, GameConfig } from '@card-wars/domain';
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

  const opponents = view.order.filter((pid) => {
    if (pid === view.me) return false;
    const p = view.players[pid]!;
    if (me.teamId && p.teamId === me.teamId) return false;
    return true;
  });

  const targetChoices: TargetChoice[] = [];

  if (ask) {
    if (ask.kind === 'any_player' || ask.kind === 'opponent_player') {
      const targetPid = opponents[0] ?? view.order.find((p) => p !== view.me) ?? view.me;
      targetChoices.push({ kind: 'player', playerId: targetPid });
    } else if (
      ask.kind === 'any_creature' ||
      ask.kind === 'opponent_creature' ||
      ask.kind === 'lane_creature' ||
      ask.kind === 'lane_opponent_creature'
    ) {
      let found: string | null = null;
      for (const pid of opponents) {
        for (const z of view.players[pid]!.zones) {
          if (z.creature) {
            found = z.creature.instanceId;
            break;
          }
        }
        if (found) break;
      }
      if (!found && ask.kind !== 'opponent_creature' && ask.kind !== 'lane_opponent_creature') {
        for (const z of me.zones) {
          if (z.creature) {
            found = z.creature.instanceId;
            break;
          }
        }
      }
      if (found) targetChoices.push({ kind: 'creature', instanceId: found });
    } else if (ask.kind === 'own_creature') {
      for (const z of me.zones) {
        if (z.creature) {
          targetChoices.push({ kind: 'creature', instanceId: z.creature.instanceId });
          break;
        }
      }
    } else if (ask.kind === 'landscape') {
      targetChoices.push({ kind: 'landscape', player: view.me, zone: 0 });
    } else if (ask.kind === 'heal_or_damage') {
      targetChoices.push({ kind: 'mode', mode: 'damage' });
    } else if (ask.kind === 'choose_option') {
      const opt = ask.options?.[0] ?? 'corn';
      targetChoices.push({ kind: 'option', option: opt });
    } else if (ask.kind === 'amount') {
      targetChoices.push({ kind: 'amount', value: ask.min ?? 1 });
    } else if (
      ask.kind === 'revealed_card' ||
      ask.kind === 'visible_card' ||
      ask.kind === 'own_discard_card' ||
      ask.kind === 'any_discard_card'
    ) {
      const revealed = view.revealed[view.me];
      if (revealed && revealed.length > 0) {
        targetChoices.push({ kind: 'card', instanceId: revealed[0]!.instanceId });
      } else if (me.discard.length > 0) {
        targetChoices.push({ kind: 'card', instanceId: me.discard[0]!.instanceId });
      }
    }
  }

  return {
    type: 'resolve_choice',
    player: view.me,
    answer: targetChoices.length > 0 ? { targets: targetChoices } : {},
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
    if (cost <= me.actions) {
      return { type: 'floop', player: view.me, instanceId: creature.instanceId };
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
      const score = 20 + meta.cost * 10;
      if (!best || score > best.score) {
        best = {
          score,
          command: { type: 'play_card', player: view.me, instanceId: card.instanceId },
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
