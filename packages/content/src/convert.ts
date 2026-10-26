import type {
  AbilityData,
  CardData,
  CardType,
  EffectSpec,
  HeroData,
  LandType,
  TargetSpec,
  TriggerKind,
} from '@card-wars/domain';

// Converter from the raw v1 OCR data (docs/data/cards_test_v1.json, docs/data/heroes_original_v1.json)
// to the canonical format (docs/CARDS.md). Pure and conservative: a mechanic is
// mapped into a structured ability ONLY when the engine supports every part of
// it; anything ambiguous stays as card text (description) and plays as vanilla.

export interface RawCondition {
  type?: string;
  value?: number;
  description?: string;
}

export interface RawAction {
  type?: string;
  target?: string;
  amount?: number;
  count?: number;
  stat?: string;
  pierce?: boolean;
  destination?: string;
  source?: string;
  [key: string]: unknown;
}

export interface RawMechanic {
  trigger?: string;
  actions?: RawAction[];
  conditions?: RawCondition[];
  description?: string;
  source_text?: string;
}

export interface RawCard {
  id: string;
  name: string;
  card_number?: number;
  card_type?: string;
  cost?: number;
  attack?: number | null;
  health?: number | null;
  land_type?: string;
  is_rainbow?: boolean;
  has_flip?: boolean;
  flip_description?: string | null;
  description?: string | null;
  mechanics?: RawMechanic[];
  image_url?: string | null;
  mechanics_status?: string;
}

export interface RawHero {
  id: string;
  name: string;
  description?: string | null;
  hero_slug?: string;
  land_type?: string | null;
  mechanics?: Array<{ type?: string; effect?: string; trigger?: string }>;
}

const LAND_TYPES: ReadonlySet<string> = new Set(['corn', 'blue', 'good', 'ice', 'sand', 'swamp', 'rainbow']);

function toLandType(raw: string | null | undefined): LandType {
  if (!raw || raw === 'any') return 'rainbow';
  return LAND_TYPES.has(raw) ? (raw as LandType) : 'rainbow';
}

function toCardType(raw: string | undefined): CardType | null {
  switch (raw) {
    case 'creature':
    case 'building':
    case 'spell':
      return raw;
    case 'special':
      // The 5 «special» cards of the v1 data are all team/companion cards (2 на 2).
      return 'companion';
    default:
      return null;
  }
}

function toTargetSpec(raw: string | undefined): TargetSpec | null {
  switch (raw) {
    case 'this_creature':
    case 'this_landscape':
    case 'this_lane':
    case 'this_landscape_pair':
      return { kind: 'this_lane_creature' };
    case 'adjacent_creature':
    case 'each_creature_adjacent':
      return { kind: 'adjacent_creature' };
    case 'each_creature_yours':
      return { kind: 'each_creature_yours' };
    case 'each_creature_opponent':
      return { kind: 'each_creature_opponent' };
    case 'each_creature':
      return { kind: 'each_creature' };
    case 'chosen_creature':
      return { kind: 'chosen_creature' };
    case 'chosen_opponent_creature':
      return { kind: 'chosen_opponent_creature' };
    case 'chosen_opponent':
      return { kind: 'chosen_opponent' };
    case 'chosen_landscape':
      return { kind: 'chosen_landscape' };
    case 'self':
      return { kind: 'self' };
    default:
      return null; // none/unparsed targets cannot be mapped safely
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Map a single structured action; null when any part is unsupported. */
function toEffect(action: RawAction): EffectSpec | null {
  switch (action.type) {
    case 'deal_damage': {
      const amount = num(action.amount);
      const target = toTargetSpec(action.target);
      if (amount === null || !target) return null;
      return { op: 'deal_damage', target, amount, pierce: Boolean(action.pierce) };
    }
    case 'heal': {
      const amount = num(action.amount);
      const target = toTargetSpec(action.target);
      if (amount === null || !target) return null;
      return { op: 'heal', target, amount };
    }
    case 'draw_cards': {
      const count = num(action.count);
      if (count === null || count < 1) return null;
      return { op: 'draw_cards', count };
    }
    case 'discard_cards': {
      // «верхняя карта колоды в сброс» maps to discard_top; discards from hand
      // involve choices the engine does not express yet.
      if (action.source !== 'deck') return null;
      const count = num(action.count);
      if (count === null || count < 1) return null;
      return { op: 'discard_top', count };
    }
    case 'stat_buff': {
      const target = toTargetSpec(action.target);
      const amount = num(action.amount);
      const stat = action.stat === 'health' ? 'defense' : action.stat === 'attack' ? 'attack' : null;
      if (!target || amount === null || !stat) return null;
      return { op: 'stat_buff', target, stat, amount };
    }
    case 'freeze_landscape': {
      const target = toTargetSpec(action.target);
      if (!target) return null;
      return { op: 'freeze_landscape', target };
    }
    default:
      return null; // imperative/passive/move/mill/cost_reduction/… — text only
  }
}

function toTrigger(raw: string | undefined): { kind: 'floop' } | { kind: 'passive'; trigger: TriggerKind } | null {
  switch (raw) {
    case 'manual':
      return { kind: 'floop' };
    case 'persistent':
      return { kind: 'passive', trigger: 'persistent' };
    case 'on_enters_play':
      return { kind: 'passive', trigger: 'on_enters_play' };
    case 'start_of_turn':
      return { kind: 'passive', trigger: 'start_of_turn' };
    case 'on_death':
      return { kind: 'passive', trigger: 'on_death' };
    default:
      return null;
  }
}

function toAbility(mechanic: RawMechanic): AbilityData | null {
  const triggerInfo = toTrigger(mechanic.trigger);
  if (!triggerInfo) return null;

  // Extra costs / conditions (prerequisite, verb, if, while) change semantics —
  // such mechanics stay text-only. cost_actions is the paid-floop price.
  let floopCost = 0;
  for (const condition of mechanic.conditions ?? []) {
    if (condition.type === 'cost_actions' && typeof condition.value === 'number') {
      floopCost = condition.value;
      continue;
    }
    return null;
  }

  const actions = mechanic.actions ?? [];
  if (actions.length !== 1) return null; // multi-action mechanics involve costs/sequences
  const effect = toEffect(actions[0]!);
  if (!effect) return null;

  const text = mechanic.source_text ?? mechanic.description ?? '';
  if (triggerInfo.kind === 'floop') {
    return { kind: 'floop', trigger: 'floop', floopCost, effect, text };
  }
  return { kind: 'passive', trigger: triggerInfo.trigger, effect, text };
}

export interface ConversionStats {
  total: number;
  converted: number;
  abilitiesMapped: number;
  skippedUnknownType: number;
}

export function convertRawCards(raw: RawCard[]): { cards: CardData[]; stats: ConversionStats } {
  const cards: CardData[] = [];
  const stats: ConversionStats = { total: raw.length, converted: 0, abilitiesMapped: 0, skippedUnknownType: 0 };
  for (const item of raw) {
    const type = toCardType(item.card_type);
    if (!type) {
      stats.skippedUnknownType++;
      continue;
    }
    const abilities: AbilityData[] = [];
    for (const mechanic of item.mechanics ?? []) {
      const mapped = toAbility(mechanic);
      if (mapped) {
        abilities.push(mapped);
        stats.abilitiesMapped++;
      }
    }
    cards.push({
      id: item.id,
      name: item.name,
      type,
      cost: item.cost ?? 0,
      landType: toLandType(item.land_type),
      attack: type === 'creature' ? (item.attack ?? undefined) : undefined,
      defense: type === 'creature' ? (item.health ?? undefined) : undefined,
      image: item.image_url ?? undefined,
      description: item.description ?? '',
      abilities,
    });
    stats.converted++;
  }
  return { cards, stats };
}

export interface HeroOverride {
  ability: AbilityData;
}

/**
 * Convert heroes. Implemented abilities come from the v3 docs (RULES.md examples)
 * — the docs are the source of truth, the raw data provides names and texts.
 */
export function convertRawHeroes(
  raw: RawHero[],
  overrides: Record<string, HeroOverride> = {},
): HeroData[] {
  return raw.map((hero) => {
    const slug = hero.hero_slug ?? hero.id;
    const text = hero.description ?? '';
    const override = overrides[slug];
    return {
      id: `hero-${slug}`,
      name: hero.name,
      ability: override?.ability ?? { kind: 'passive', text },
      text,
    };
  });
}

/** Deterministic MVP preset builder: 10 distinct cards × 4 copies around a land theme. */
export function buildPreset(
  cards: CardData[],
  id: string,
  heroId: string,
  theme: LandType,
): { id: string; heroId: string; lands: LandType[]; deck: string[] } {
  const pool = cards
    .filter((c) => c.type !== 'companion' && (c.landType === theme || c.landType === 'rainbow'))
    // theme cards first so two different themes produce different decks
    .sort(
      (a, b) =>
        Number(a.landType !== theme) - Number(b.landType !== theme) ||
        a.cost - b.cost ||
        a.id.localeCompare(b.id),
    );
  const chosen: string[] = [];
  const addType = (type: CardType, count: number): void => {
    let added = 0;
    for (const card of pool) {
      if (added >= count) break;
      if (card.type === type && !chosen.includes(card.id)) {
        chosen.push(card.id);
        added++;
      }
    }
  };
  addType('creature', 6);
  addType('building', 2);
  addType('spell', 2);
  for (const card of pool) {
    if (chosen.length >= 10) break;
    if (!chosen.includes(card.id)) chosen.push(card.id);
  }
  const deck: string[] = [];
  for (let copy = 0; copy < 4; copy++) deck.push(...chosen.slice(0, 10));
  return { id, heroId, lands: [theme, theme, theme, 'rainbow'], deck };
}
