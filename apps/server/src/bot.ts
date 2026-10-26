import type { CardCatalog, CardData, GameConfig } from '@card-wars/domain';
import type { Command, CommandChoices, PlayerView } from '@card-wars/protocol';

// Server-side bot heuristic (docs/NETWORK.md «Боты»). Purely a function of the
// bot's personal view + public catalog: hidden cards of other players are never used.

export interface BotDeps {
  catalog: CardCatalog;
  config: GameConfig;
}

type CardSlot = 'creature' | 'building';

function cardOf(deps: BotDeps, cardId: string): CardData | undefined {
  return deps.catalog.getCard(cardId);
}

function opponentIds(view: PlayerView): string[] {
  const me = view.players[view.me]!;
  return view.order.filter((pid) => {
    if (pid === view.me) return false;
    const p = view.players[pid]!;
    if (p.eliminated) return false;
    return me.teamId === null || p.teamId !== me.teamId;
  });
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

function enemyCreature(view: PlayerView): string | null {
  for (const pid of opponentIds(view)) {
    for (const zone of view.players[pid]!.zones) {
      if (zone.creature) return zone.creature.instanceId;
    }
  }
  return null;
}

function ownCreature(view: PlayerView): string | null {
  for (const zone of view.players[view.me]!.zones) {
    if (zone.creature) return zone.creature.instanceId;
  }
  return null;
}

function enemyLand(view: PlayerView): { player: string; zone: number } | null {
  const pid = opponentIds(view)[0];
  if (!pid) return null;
  return { player: pid, zone: 0 };
}

/** Choices for a card's first target-requiring ability; null = target missing. */
function choicesFor(card: CardData, view: PlayerView): CommandChoices | null | undefined {
  for (const ability of card.abilities) {
    const target = ability.effect && 'target' in ability.effect ? ability.effect.target : null;
    if (!target) continue;
    switch (target.kind) {
      case 'chosen_opponent_creature': {
        const instanceId = enemyCreature(view);
        return instanceId ? { creature: instanceId } : null;
      }
      case 'chosen_creature': {
        const instanceId = enemyCreature(view) ?? ownCreature(view);
        return instanceId ? { creature: instanceId } : null;
      }
      case 'chosen_opponent': {
        const pid = opponentIds(view)[0];
        return pid ? { opponent: pid } : null;
      }
      case 'chosen_landscape': {
        const land = enemyLand(view);
        return land ? { landscape: land } : null;
      }
      default:
        continue;
    }
  }
  return undefined;
}

function findPlay(view: PlayerView, deps: BotDeps): Command | null {
  const me = view.players[view.me]!;
  let best: { score: number; command: Command } | null = null;

  for (const card of view.myHand) {
    const meta = cardOf(deps, card.cardId);
    if (!meta || meta.cost > me.actions) continue;
    if (!landRequirementMet(view, meta.landType, deps.config.landRequirementPerCard)) continue;

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
      const choices = choicesFor(meta, view);
      if (choices === null) continue;
      const score = 20 + meta.cost * 10;
      if (!best || score > best.score) {
        best = {
          score,
          command: {
            type: 'play_card',
            player: view.me,
            instanceId: card.instanceId,
            ...(choices ? { choices } : {}),
          },
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

function findFloop(view: PlayerView, deps: BotDeps): Command | null {
  const me = view.players[view.me]!;
  if (me.actions <= 0) return null;
  const firstRoundNoFloop =
    view.round === 1 && (view.mode === 'teams' || view.turn === 1);
  if (firstRoundNoFloop) return null;

  const ids: string[] = [];
  for (const zone of me.zones) {
    if (zone.creature && !zone.creature.flipped) ids.push(zone.creature.instanceId);
    if (zone.building && !zone.building.flipped) ids.push(zone.building.instanceId);
  }
  if (me.companion && !me.companion.flipped) ids.push(me.companion.instanceId);

  for (const instanceId of ids) {
    const card = viewCard(view, instanceId);
    if (!card) continue;
    const meta = cardOf(deps, card.cardId);
    if (!meta) continue;
    const floops = meta.abilities.filter((a) => a.kind === 'floop');
    if (floops.length === 0) continue;
    const cost = floops.reduce((sum, a) => sum + (a.floopCost ?? 0), 0);
    if (cost > me.actions) continue;
    const choices = choicesFor(meta, view);
    if (choices === null) continue;
    return {
      type: 'floop',
      player: view.me,
      instanceId,
      ...(choices ? { choices } : {}),
    };
  }
  return null;
}

function viewCard(view: PlayerView, instanceId: string) {
  for (const pid of view.order) {
    const p = view.players[pid]!;
    for (const zone of p.zones) {
      if (zone.creature?.instanceId === instanceId) return zone.creature;
      if (zone.building?.instanceId === instanceId) return zone.building;
    }
    if (p.companion?.instanceId === instanceId) return p.companion;
  }
  return null;
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
