import { cards as catalog, heroes as heroCatalog } from '@card-wars/content';
import type { PlayerView, TargetChoice } from '@card-wars/protocol';
import type { Command } from '@card-wars/protocol';

/**
 * Клиентский режим выбора целей (docs/MECHANICS-V2.md §5): цели собираются
 * по сценарию `targets` способности и уходят одной командой. Для pending
 * (триггеры, §6) каждая валидная цель отправляется отдельным resolve_choice —
 * сервер сам двигает askIndex.
 *
 * Точность подсветки: базовый landType карты; «считается …» (counts_as)
 * валидирует домен — редкий случай, клик по такой цели вернёт invalid_choice.
 */

export interface TargetAsk {
  kind: string;
  filter?: {
    ready?: boolean;
    landType?: string;
    /** Тип и стоимость карты (выбор из сброса). */
    cardType?: string;
    maxCost?: number;
    cardIds?: string[];
  };
}

export interface TargetingState {
  /** Активный режим: одна команда со всеми целями (floop/герой). */
  mode: 'active' | 'pending';
  /** active: базовая команда без targets. */
  base?: Command;
  /** pending: только текущий выбор уходит resolve_choice. */
  sourceInstanceId: string | null;
  asks: TargetAsk[];
  askIndex: number;
  collected: TargetChoice[];
  /** Человекочитаемое имя способности для баннера. */
  label: string;
}

/** Активная способность карты (один «ПРИЕМ» на карту). */
export function activeAbilityOf(cardId: string): { targets?: TargetAsk[]; text: string } | null {
  const card = catalog.find((c) => c.id === cardId);
  const ability = card?.abilities?.find((a) => a.kind === 'active');
  if (!ability) return null;
  return { targets: ability.targets, text: ability.text };
}

/** Активная способность героя. */
export function activeAbilityOfHero(heroId: string): { targets?: TargetAsk[]; text: string } | null {
  const hero = heroCatalog.find((h) => h.id === heroId);
  const ability = hero?.ability;
  if (!ability || ability.kind !== 'active') return null;
  return { targets: ability.targets, text: ability.text };
}

function isOpponent(view: PlayerView, pid: string): boolean {
  if (pid === view.me) return false;
  const me = view.players[view.me]!;
  const other = view.players[pid]!;
  if (me.teamId && other.teamId === me.teamId) return false;
  return true;
}

function laneIndex(view: PlayerView, sourceInstanceId: string | null, collected: TargetChoice[]): number | null {
  if (sourceInstanceId) {
    const me = view.players[view.me]!;
    for (const zone of me.zones) {
      if (zone.creature?.instanceId === sourceInstanceId) return me.zones.indexOf(zone);
      if (zone.building?.instanceId === sourceInstanceId) return me.zones.indexOf(zone);
    }
    // источник мог уйти из игры (on_leave_play) — фолбэк на первый выбор
  }
  const first = collected.find((c) => c.kind === 'creature');
  if (first && first.kind === 'creature') {
    for (const pid of view.order) {
      const p = view.players[pid]!;
      const idx = p.zones.findIndex((z) => z.creature?.instanceId === first.instanceId);
      if (idx >= 0) return idx;
    }
  }
  return null;
}

function fieldCreatures(view: PlayerView, pid: string): TargetChoice[] {
  return (view.players[pid]!.zones.flatMap((z) => (z.creature ? [z.creature.instanceId] : [])))
    .map((instanceId) => ({ kind: 'creature' as const, instanceId }));
}

function cardLandType(cardId: string): string | undefined {
  return catalog.find((c) => c.id === cardId)?.landType;
}

/** Тип и стоимость карты из сброса (фильтр ask'а). */
function discardCardPasses(cardId: string, filter: NonNullable<TargetAsk['filter']>): boolean {
  const card = catalog.find((c) => c.id === cardId);
  if (!card) return false;
  if (filter.cardType && card.type !== filter.cardType) return false;
  if (filter.maxCost !== undefined && card.cost > filter.maxCost) return false;
  if (filter.cardIds && !filter.cardIds.includes(cardId)) return false;
  return true;
}

/** Валидные цели для текущего ask'а (подсветка; финально валидирует домен). */
export function validTargets(
  view: PlayerView,
  ask: TargetAsk,
  sourceInstanceId: string | null,
  collected: TargetChoice[],
): TargetChoice[] {
  const me = view.players[view.me]!;
  const allCreatures = view.order.flatMap((pid) => fieldCreatures(view, pid));
  const passes = (candidate: TargetChoice): boolean => {
    const askFilter = ask.filter;
    if (!askFilter) return true;
    if (candidate.kind !== 'creature') return true;
    const instanceId = candidate.instanceId;
    const cardId = findCardId(view, instanceId);
    if (!cardId) return true;
    if (askFilter.ready) {
      const flipped = findFlipped(view, instanceId);
      if (flipped) return false;
    }
    if (askFilter.landType && cardLandType(cardId) !== askFilter.landType) return false;
    return true;
  };

  switch (ask.kind) {
    case 'own_creature':
      return fieldCreatures(view, view.me).filter((c) => passes(c));
    case 'opponent_creature':
      return view.order.filter((pid) => isOpponent(view, pid)).flatMap((pid) => fieldCreatures(view, pid));
    case 'any_creature':
      return allCreatures;
    case 'lane_creature': {
      const lane = laneIndex(view, sourceInstanceId, collected);
      if (lane === null) return [];
      return view.order.flatMap((pid) => {
        const zone = view.players[pid]!.zones[lane];
        return zone?.creature ? [{ kind: 'creature' as const, instanceId: zone.creature.instanceId }] : [];
      });
    }
    case 'lane_opponent_creature': {
      const lane = laneIndex(view, sourceInstanceId, collected);
      if (lane === null) return [];
      return view.order
        .filter((pid) => isOpponent(view, pid))
        .flatMap((pid) => {
          const zone = view.players[pid]!.zones[lane];
          return zone?.creature ? [{ kind: 'creature' as const, instanceId: zone.creature.instanceId }] : [];
        });
    }
    case 'opponent_player':
      return view.order.filter((pid) => isOpponent(view, pid)).map((pid) => ({ kind: 'player' as const, playerId: pid }));
    case 'landscape':
      return allLands(view);
    case 'own_landscape':
      return myLands(view);
    case 'adjacent_creature': {
      const lane = laneIndex(view, sourceInstanceId, collected);
      if (lane === null) return [];
      return [lane - 1, lane + 1]
        .filter((z) => z >= 0 && z < me.zones.length)
        .flatMap((z) => (me.zones[z]!.creature ? [{ kind: 'creature' as const, instanceId: me.zones[z]!.creature!.instanceId }] : []));
    }
    case 'adjacent_any_creature': {
      const lane = laneIndex(view, sourceInstanceId, collected);
      if (lane === null) return [];
      const out: TargetChoice[] = [];
      for (const pid of view.order) {
        const p = view.players[pid]!;
        for (const z of [lane - 1, lane + 1]) {
          if (z < 0 || z >= p.zones.length) continue;
          const creature = p.zones[z]!.creature;
          if (creature) out.push({ kind: 'creature', instanceId: creature.instanceId });
        }
      }
      return out;
    }
    case 'own_building':
      return me.zones.flatMap((z) => (z.building ? [{ kind: 'creature' as const, instanceId: z.building.instanceId }] : []));
    case 'lane_building': {
      const lane = laneIndex(view, sourceInstanceId, collected);
      if (lane === null) return [];
      return view.order.flatMap((pid) => {
        const zone = view.players[pid]!.zones[lane];
        return zone?.building ? [{ kind: 'creature' as const, instanceId: zone.building.instanceId }] : [];
      });
    }
    case 'own_hand_card':
      return view.myHand.map((c) => ({ kind: 'card' as const, instanceId: c.instanceId }));
    case 'own_discard_card':
      // Сброс публичен (docs/RULES.md), но выбирать можно только свой.
      return (view.players[view.me]?.discard ?? [])
        .filter((c) => !ask.filter || discardCardPasses(c.cardId, ask.filter))
        .map((c) => ({ kind: 'card' as const, instanceId: c.instanceId }));
    case 'any_discard_card':
      return view.order.flatMap((pid) =>
        (view.players[pid]?.discard ?? [])
          .filter((c) => !ask.filter || discardCardPasses(c.cardId, ask.filter))
          .map((c) => ({ kind: 'card' as const, instanceId: c.instanceId })),
      );
    case 'visible_card':
      // Публичные карты: всё, что в игре, плюс все стопки сброса.
      return view.order.flatMap((pid) => {
        const p = view.players[pid]!;
        const onField = p.zones.flatMap((z) =>
          [z.creature?.instanceId, z.building?.instanceId].filter((id): id is string => Boolean(id)),
        );
        const cards = [
          ...onField.map((instanceId) => ({ instanceId, cardId: findCardId(view, instanceId) ?? '' })),
          ...p.discard,
        ];
        return cards
          .filter((c) => !ask.filter || discardCardPasses(c.cardId, ask.filter))
          .map((c) => ({ kind: 'card' as const, instanceId: c.instanceId }));
      });
    case 'revealed_card':
      return (view.revealed?.[view.me] ?? []).map((c) => ({ kind: 'card' as const, instanceId: c.instanceId }));
    default:
      return [];
  }
}

function myLands(view: PlayerView): TargetChoice[] {
  return view.players[view.me]!.lands.map((land, zone) => ({ kind: 'landscape' as const, player: view.me, zone }));
}

function allLands(view: PlayerView): TargetChoice[] {
  return view.order.flatMap((pid) =>
    view.players[pid]!.lands.map((land, zone) => ({ kind: 'landscape' as const, player: pid, zone })),
  );
}

function findCardId(view: PlayerView, instanceId: string): string | undefined {
  for (const pid of view.order) {
    const p = view.players[pid]!;
    for (const zone of p.zones) {
      if (zone.creature?.instanceId === instanceId) return zone.creature.cardId;
      if (zone.building?.instanceId === instanceId) return zone.building.cardId;
    }
    if (p.companion?.instanceId === instanceId) return p.companion.cardId;
  }
  return view.myHand.find((c) => c.instanceId === instanceId)?.cardId;
}

function findFlipped(view: PlayerView, instanceId: string): boolean {
  for (const pid of view.order) {
    const p = view.players[pid]!;
    for (const zone of p.zones) {
      if (zone.creature?.instanceId === instanceId) return zone.creature.flipped;
      if (zone.building?.instanceId === instanceId) return zone.building.flipped;
    }
  }
  return false;
}

/** Собрать команду из накопленных целей. */
export function buildCommand(base: Command, collected: TargetChoice[]): Command {
  if (base.type === 'floop' || base.type === 'hero_ability' || base.type === 'play_card') {
    return { ...base, targets: collected };
  }
  return base;
}


/** Начать active-таргетинг для флюпа/героя; null — цели не нужны. */
export function startForActive(
  view: PlayerView,
  kind: 'floop' | 'hero_ability',
  instanceId: string | null,
  cardId: string,
): TargetingState | null {
  const me = view.players[view.me]!;
  const ability = kind === 'hero_ability'
    ? activeAbilityOfHero(cardId)
    : activeAbilityOf(cardId);
  if (!ability) return null;
  const asks = ability.targets ?? [];
  return {
    mode: 'active',
    base: kind === 'floop'
      ? { type: 'floop', player: view.me, instanceId: instanceId ?? '' }
      : { type: 'hero_ability', player: view.me },
    sourceInstanceId: kind === 'floop' ? instanceId : null,
    asks,
    askIndex: 0,
    collected: [],
    label: ability.text,
  };
}

/** Начать pending-таргетинг (триггерная способность, §6). */
export function startForPending(
  view: PlayerView,
  pending: NonNullable<PlayerView['pending']>,
): TargetingState | null {
  if (pending.cardId === undefined) return null;
  const card = catalog.find((c) => c.id === pending.cardId);
  const ability = card?.abilities?.[pending.abilityIndex ?? 0];
  if (!ability) return null;
  const asks = ability.targets ?? [];
  if (asks.length === 0) return null;
  return {
    mode: 'pending',
    sourceInstanceId: pending.instanceId ?? null,
    asks,
    askIndex: pending.askIndex ?? 0,
    collected: [],
    label: ability.text,
  };
}

/**
 * Обработка клика по кандидату: валидна ли цель для текущего ask'а и что
 * делать — collect (active), send (active, последняя) или resolve_choice
 * (pending, каждая цель — отдельная команда).
 */
export function pick(
  view: PlayerView,
  state: TargetingState,
  candidate: TargetChoice,
): { accepted: boolean; command?: Command; nextState?: TargetingState } {
  const ask = state.asks[state.askIndex];
  if (!ask) return { accepted: false };
  const valid = validTargets(view, ask, state.sourceInstanceId, state.collected);
  if (!valid.some((v) => JSON.stringify(v) === JSON.stringify(candidate))) return { accepted: false };

  if (state.mode === 'pending') {
    return {
      accepted: true,
      command: {
        type: 'resolve_choice',
        player: view.me,
        answer: { targets: [candidate] },
      },
    };
  }

  const collected = [...state.collected, candidate];
  if (state.askIndex + 1 < state.asks.length) {
    return {
      accepted: true,
      nextState: { ...state, askIndex: state.askIndex + 1, collected },
    };
  }
  return { accepted: true, command: buildCommand(state.base as Command, collected) };
}
