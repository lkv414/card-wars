import type { CardCatalog, CardData, GameConfig } from '@card-wars/domain';
import type { Command, PlayerView } from '@card-wars/protocol';

// Server-side bot heuristic (docs/NETWORK.md «Боты»). Purely a function of the
// bot's personal view + public catalog: hidden cards of other players are never used.
// Floop targeting returns with mechanics v2 (docs/TECH.md № 2); until then the
// bot only plays cards, draws extra and goes to battle.

export interface BotDeps {
  catalog: CardCatalog;
  config: GameConfig;
}

type CardSlot = 'creature' | 'building';

function cardOf(deps: BotDeps, cardId: string): CardData | undefined {
  return deps.catalog.getCard(cardId);
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

  if (view.status !== 'running') return null;
  if (!view.activePlayers.includes(view.me)) return null;
  if (me.battleReady) return null;
  if (view.phase !== 'main') return null;

  if (me.actions > 0) {
    const play = findPlay(view, deps);
    if (play) return play;
    if (me.actions >= deps.config.extraDrawCost && me.deckCount > 5 && me.handCount < 8) {
      return { type: 'draw_extra', player: view.me };
    }
  }
  return { type: 'go_battle', player: view.me };
}
