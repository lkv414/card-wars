/**
 * mechanics.ts — классы игровых механик для движка Card Wars.
 *
 * Архитектура (ООП-подход):
 *   • Базовый класс Mechanic с полями trigger, actions[], conditions[], description.
 *   • Action-классы для каждого типа действия (deal_damage, stat_buff, draw, ...).
 *   • Каждая механика хранится в данных карты (json) и применяется через
 *     `applyTo(state, owner)` (см. ниже).
 *
 * Соответствие с Python парсером (scripts/parse_mechanics.py):
 *   - action.type   ↔  ActionClasses здесь
 *   - action.amount ↔  специфичные поля в подклассе
 *   - action.target ↔  Target (строка-идентификатор)
 *
 * Этот модуль в первую очередь — **типизация и контракт**.
 * Реальные хендлеры (какая именно карта в игре применяет механику,
 * с какими параметрами) реализуются постепенно.
 */

// ───────── TARGETS (цели) ─────────
//
// Строки-идентификаторы — синхронизированы с Python парсером.

export const Target = {
  // Существа
  CHOSEN_OPPONENT_CREATURE: "chosen_opponent_creature",
  CHOSEN_OPPONENT: "chosen_opponent",
  CHOSEN_CREATURE: "chosen_creature",
  CHOSEN_CREATURE_ANY: "chosen_creature_any",
  ADJACENT_CREATURE: "adjacent_creature",
  THIS_CREATURE: "this_creature",
  TRIGGER_CREATURE: "trigger_creature",
  EACH_CREATURE: "each_creature",
  EACH_CREATURE_YOURS: "each_creature_yours",
  EACH_CREATURE_OPPONENT: "each_creature_opponent",
  EACH_CREATURE_IN_LANE: "each_creature_in_lane",
  EACH_CREATURE_ADJACENT: "each_creature_adjacent",
  EACH_CREATURE_LANDSCAPE: "each_creature_landscape",
  EACH_CREATURE_NO_HAND: "each_creature_no_hand",
  EACH_OPPONENT: "each_opponent",
  // Локации
  CHOSEN_LANDSCAPE: "chosen_landscape",
  THIS_LANDSCAPE: "this_landscape",
  THIS_LANDSCAPE_PAIR: "this_landscape_pair",
  OPPONENT_LANE: "opponent_lane",
  THIS_LANE: "this_lane",
  // Колода / рука
  SELF: "self",
  DECK: "deck",
  HAND: "hand",
  DISCARD_PILE: "discard_pile",
  CHOSEN_DISCARD: "chosen_discard",
  NONE: "none",
} as const

export type TargetKey = typeof Target[keyof typeof Target]

// ───────── TRIGGERS ─────────

export const Trigger = {
  MANUAL: "manual",
  ON_PLAY: "on_enters_play",
  ON_FLIP: "on_flip",
  START_OF_TURN: "start_of_turn",
  START_OF_NEXT_TURN: "start_of_next_turn",
  END_OF_TURN: "end_of_turn",
  ON_ATTACK: "on_creature_attacks",
  ON_DAMAGE_DEALT: "on_damage_dealt",
  ON_DAMAGE_TAKEN: "on_damage_taken",
  ON_DEATH: "on_death",
  ON_DISCARD: "on_discard",
  ON_LINE_CHANGE: "on_line_change",
  ON_DRAW: "on_draw",
  PERSISTENT: "persistent",
  CONDITIONAL: "conditional",
} as const

export type TriggerKey = typeof Trigger[keyof typeof Trigger]

// ───────── ДЕЙСТВИЯ (Action) ─────────

export type Stat = "attack" | "defense" | "health"
export type StatMod =
  | { kind: "flat"; amount: number } // +N
  | { kind: "mul"; multiplier: number } // xN (для «удваивается»)

/**
 * Базовый класс действия. Все конкретные действия наследуются и задают
 * дополнительные поля (amount / count / target и т.п.).
 *
 * Применение действия в рантайме:
 *   const action = new DealDamage({ amount: 1, target: "each_creature_opponent" });
 *   action.apply(gameState, ownerCard);  // -> ApplyResult
 */
export abstract class Action {
  readonly type: string
  readonly target: TargetKey
  readonly source_text: string

  constructor(opts: { type: string; target: TargetKey; source_text?: string }) {
    this.type = opts.type
    this.target = opts.target
    this.source_text = opts.source_text ?? ""
  }

  /**
   * Сериализация в JSON для записи в БД / отправки клиенту.
   * Контракт: зеркально парсеру scripts/parse_mechanics.py.
   */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = { type: this.type, target: this.target }
    if (this.source_text) out.source_text = this.source_text
    // Подклассы добавляют специфичные поля
    return { ...out, ...this.params() }
  }

  /** Дополнительные параметры конкретного подкласса (для сериализации). */
  protected abstract params(): Record<string, unknown>
}

// ─── DMG / HEAL ───

export class DealDamage extends Action {
  readonly amount: number
  readonly pierce: boolean

  constructor(opts: { amount: number; target?: TargetKey; pierce?: boolean; source_text?: string }) {
    super({ type: "deal_damage", target: opts.target ?? Target.CHOSEN_OPPONENT_CREATURE, source_text: opts.source_text })
    this.amount = opts.amount
    this.pierce = opts.pierce ?? false
  }

  protected params(): Record<string, unknown> {
    return { amount: this.amount, pierce: this.pierce }
  }
}

export class AoeDamage extends Action {
  readonly amount: number
  /** "each_opponent_no_hand" | "each_creature" | "each_creature_landscape_<type>" и т.п. */
  readonly filter: string

  constructor(opts: { amount: number; filter: string; target?: TargetKey; source_text?: string }) {
    super({ type: "aoe_damage", target: opts.target ?? Target.NONE, source_text: opts.source_text })
    this.amount = opts.amount
    this.filter = opts.filter
  }

  protected params(): Record<string, unknown> {
    return { amount: this.amount, filter: this.filter }
  }
}

export class Heal extends Action {
  readonly amount: number
  /** Максимум HP карты/героя (для original AT — 25). */
  readonly cap: number

  constructor(opts: { amount: number; target?: TargetKey; cap?: number; source_text?: string }) {
    super({ type: "heal", target: opts.target ?? Target.SELF, source_text: opts.source_text })
    this.amount = opts.amount
    this.cap = opts.cap ?? 25
  }

  protected params(): Record<string, unknown> {
    return { amount: this.amount, cap: this.cap }
  }
}

// ─── DRAW / DISCARD / SEARCH ───

export class DrawCards extends Action {
  readonly count: number
  /** "deck" | "discard_pile" | "ally" */
  readonly source: string
  /** "creature" | "spell" | "any" | "building" */
  readonly filter: string

  constructor(opts: { count?: number; target?: TargetKey; source?: string; filter?: string; source_text?: string }) {
    super({ type: "draw_cards", target: opts.target ?? Target.NONE, source_text: opts.source_text })
    this.count = opts.count ?? 1
    this.source = opts.source ?? "deck"
    this.filter = opts.filter ?? ""
  }

  protected params(): Record<string, unknown> {
    const p: Record<string, unknown> = { count: this.count, source: this.source }
    if (this.filter) p.filter = this.filter
    return p
  }
}

export class DiscardCards extends Action {
  readonly count: number
  readonly source: string
  readonly random: boolean

  constructor(opts: { count?: number; target?: TargetKey; source?: string; random?: boolean; source_text?: string }) {
    super({ type: "discard_cards", target: opts.target ?? Target.NONE, source_text: opts.source_text })
    this.count = opts.count ?? 1
    this.source = opts.source ?? "hand"
    this.random = opts.random ?? false
  }

  protected params(): Record<string, unknown> {
    return { count: this.count, source: this.source, random: this.random }
  }
}

export class Search extends Action {
  /** "deck" | "discard_pile" */
  readonly source: string
  readonly count: number
  readonly filter: string
  /** Target.HAND | Target.THIS_LANE */
  readonly destination: TargetKey

  constructor(opts: { source?: string; count?: number; filter?: string; destination?: TargetKey; source_text?: string }) {
    super({ type: "search", target: opts.destination ?? Target.HAND, source_text: opts.source_text })
    this.source = opts.source ?? "deck"
    this.count = opts.count ?? 1
    this.filter = opts.filter ?? "any"
    this.destination = opts.destination ?? Target.HAND
  }

  protected params(): Record<string, unknown> {
    return { source: this.source, count: this.count, filter: this.filter, destination: this.destination }
  }
}

// ─── DESTROY / MOVE ───

export class Destroy extends Action {
  readonly count: number

  constructor(opts: { target?: TargetKey; count?: number; source_text?: string }) {
    super({ type: "destroy", target: opts.target ?? Target.CHOSEN_OPPONENT_CREATURE, source_text: opts.source_text })
    this.count = opts.count ?? 1
  }

  protected params(): Record<string, unknown> {
    return { count: this.count }
  }
}

export class Move extends Action {
  /** Куда перемещаем */
  readonly destination: TargetKey
  /** Возвращается ли карта после боя */
  readonly return_after_battle: boolean

  constructor(opts: { target?: TargetKey; destination?: TargetKey; return_after_battle?: boolean; source_text?: string }) {
    super({ type: "move", target: opts.target ?? Target.CHOSEN_CREATURE, source_text: opts.source_text })
    this.destination = opts.destination ?? Target.THIS_LANE
    this.return_after_battle = opts.return_after_battle ?? false
  }

  protected params(): Record<string, unknown> {
    const p: Record<string, unknown> = { destination: this.destination }
    if (this.return_after_battle) p.return_after_battle = true
    return p
  }
}

export class ReturnFromDiscard extends Action {
  /** "self" | number (стоимость карты ≤ N) */
  readonly cost_filter: string | number | null
  /** Target.HAND | Target.THIS_LANE */
  readonly destination: TargetKey

  constructor(opts: { target?: TargetKey; cost_filter?: string | number | null; destination?: TargetKey; source_text?: string }) {
    super({ type: "return_from_discard", target: opts.target ?? Target.CHOSEN_DISCARD, source_text: opts.source_text })
    this.cost_filter = opts.cost_filter ?? null
    this.destination = opts.destination ?? Target.HAND
  }

  protected params(): Record<string, unknown> {
    const p: Record<string, unknown> = { destination: this.destination }
    if (this.cost_filter !== null) p.cost_filter = this.cost_filter
    return p
  }
}

// ─── LANDFORMS (земля) ───

export class FlipLandscape extends Action {
  /** "down" | "up" | "any" (лицом вверх или вниз) */
  readonly face: "down" | "up" | "any"

  constructor(opts: { target?: TargetKey; face?: "down" | "up" | "any"; source_text?: string }) {
    super({ type: "flip_landscape", target: opts.target ?? Target.CHOSEN_LANDSCAPE, source_text: opts.source_text })
    this.face = opts.face ?? "down"
  }

  protected params(): Record<string, unknown> {
    return { face: this.face }
  }
}

export class FreezeLandscape extends Action {
  constructor(opts: { target?: TargetKey; source_text?: string }) {
    super({ type: "freeze_landscape", target: opts.target ?? Target.CHOSEN_LANDSCAPE, source_text: opts.source_text })
  }

  protected params(): Record<string, unknown> {
    return {}
  }
}

// ─── STAT BUFF (стат-баф) ───

export class StatBuff extends Action {
  readonly stat: Stat
  readonly amount: number | string  // number: +N, string: "xN"
  readonly duration: "this_turn" | "persistent"

  constructor(opts: {
    stat: Stat
    amount: number | string
    target?: TargetKey
    duration?: "this_turn" | "persistent"
    source_text?: string
  }) {
    super({ type: "stat_buff", target: opts.target ?? Target.EACH_CREATURE_YOURS, source_text: opts.source_text })
    this.stat = opts.stat
    this.amount = opts.amount
    this.duration = opts.duration ?? "persistent"
  }

  protected params(): Record<string, unknown> {
    return { stat: this.stat, amount: this.amount, duration: this.duration }
  }
}

// ─── METADATA (control-flow без эффектов) ───

export class GainActions extends Action {
  readonly count: number
  constructor(opts: { count: number; source_text?: string }) {
    super({ type: "gain_actions", target: Target.NONE, source_text: opts.source_text })
    this.count = opts.count
  }
  protected params(): Record<string, unknown> {
    return { count: this.count }
  }
}

export class FlipAbility extends Action {
  readonly cost: number
  readonly is_free: boolean
  readonly effect: string
  constructor(opts: { cost?: number; is_free?: boolean; effect?: string; source_text?: string }) {
    super({ type: "flip_ability", target: Target.NONE, source_text: opts.source_text })
    this.cost = opts.cost ?? 0
    this.is_free = opts.is_free ?? true
    this.effect = opts.effect ?? ""
  }
  protected params(): Record<string, unknown> {
    return { cost: this.cost, is_free: this.is_free, effect: this.effect }
  }
}

// ─── SPECIAL ABILITIES ───

export class IgnoreDamage extends Action {
  /** N — сколько урона игнорировать */
  readonly amount: number
  /** "on_self" | "all" */
  readonly source: string
  constructor(opts: { amount: number; source?: string; source_text?: string }) {
    super({ type: "ignore_damage", target: Target.NONE, source_text: opts.source_text })
    this.amount = opts.amount
    this.source = opts.source ?? "on_self"
  }
  protected params(): Record<string, unknown> {
    return { amount: this.amount, source: this.source }
  }
}

export class FaceAttack extends Action {
  constructor(opts: { source_text?: string }) {
    super({ type: "face_attack", target: Target.NONE, source_text: opts.source_text })
  }
  protected params(): Record<string, unknown> {
    return {}
  }
}

export class PlayForFree extends Action {
  /** "creature" | "any" (цель поиска) */
  readonly card_type: string
  /** null = любая стоимость, N = стоимость ≤ N */
  readonly cost_filter: number | null
  constructor(opts: { card_type?: string; cost_filter?: number | null; source_text?: string }) {
    super({ type: "play_for_free", target: Target.NONE, source_text: opts.source_text })
    this.card_type = opts.card_type ?? "any"
    this.cost_filter = opts.cost_filter ?? null
  }
  protected params(): Record<string, unknown> {
    const p: Record<string, unknown> = { card_type: this.card_type }
    if (this.cost_filter !== null) p.cost_filter = this.cost_filter
    return p
  }
}

export class CostReduction extends Action {
  /** Сколько действий/стоимости сэкономить */
  readonly amount: number
  /** "self" | "this_card" | "next_card" */
  readonly scope: string
  constructor(opts: { amount: number; scope?: string; source_text?: string }) {
    super({ type: "cost_reduction", target: Target.NONE, source_text: opts.source_text })
    this.amount = opts.amount
    this.scope = opts.scope ?? "self"
  }
  protected params(): Record<string, unknown> {
    return { amount: this.amount, scope: this.scope }
  }
}

export class Immunity extends Action {
  /** "destroy" | "damage_from_spells" | "all_damage" */
  readonly to: string
  constructor(opts: { to: string; source_text?: string }) {
    super({ type: "immunity", target: Target.NONE, source_text: opts.source_text })
    this.to = opts.to
  }
  protected params(): Record<string, unknown> {
    return { to: this.to }
  }
}

export class Imperative extends Action {
  readonly verb: string
  constructor(opts: { verb: string; target?: TargetKey; source_text?: string }) {
    super({ type: "imperative", target: opts.target ?? Target.NONE, source_text: opts.source_text })
    this.verb = opts.verb
  }
  protected params(): Record<string, unknown> {
    return { verb: this.verb }
  }
}

export class Peek extends Action {
  readonly count: number
  readonly source: string
  constructor(opts: { count?: number; source?: string; source_text?: string }) {
    super({ type: "peek", target: Target.NONE, source_text: opts.source_text })
    this.count = opts.count ?? 1
    this.source = opts.source ?? "deck"
  }
  protected params(): Record<string, unknown> {
    return { count: this.count, source: this.source }
  }
}

export class Mill extends Action {
  readonly count: number
  readonly source: string
  constructor(opts: { count?: number; source?: string; source_text?: string }) {
    super({ type: "mill", target: Target.NONE, source_text: opts.source_text })
    this.count = opts.count ?? 1
    this.source = opts.source ?? "deck"
  }
  protected params(): Record<string, unknown> {
    return { count: this.count, source: this.source }
  }
}

// ───────── МЕХАНИКА (Mechanic) ─────────

export type Condition =
  | { type: "cost_actions"; value: number }
  | { type: "prerequisite"; description: string }
  | { type: "verb"; value: string }
  | { type: "if"; description: string }
  | { type: "while"; description: string }

/**
 * Механика — это Trigger + массив Action[] + условия + описание.
 *
 * В JSON-данных карт механика выглядит так:
 * {
 *   "trigger": "manual",
 *   "actions": [{ "type": "deal_damage", "target": "...", "amount": 1, "pierce": false }],
 *   "conditions": [{ "type": "cost_actions", "value": 1 }],
 *   "description": "Нанеси 1 урон выбранному существу",
 *   "source_text": "ПРИЕМ >>> Нанеси 1 урон ..."
 * }
 *
 * На движке это будет конвертировано в инстанс Mechanic через механику
 * hydrator (см. hydrate_mechanics).
 */
export class Mechanic {
  readonly trigger: TriggerKey
  readonly actions: Action[]
  readonly conditions: Condition[]
  readonly description: string
  readonly source_text: string
  /** Карта к которой привязана механика (заполняется при гидратации). */
  readonly owner_card_id: string | null

  constructor(opts: {
    trigger: TriggerKey
    actions: Action[]
    conditions?: Condition[]
    description?: string
    source_text?: string
    owner_card_id?: string | null
  }) {
    this.trigger = opts.trigger
    this.actions = opts.actions
    this.conditions = opts.conditions ?? []
    this.description = opts.description ?? ""
    this.source_text = opts.source_text ?? ""
    this.owner_card_id = opts.owner_card_id ?? null
  }

  toJSON(): Record<string, unknown> {
    return {
      trigger: this.trigger,
      actions: this.actions.map(a => a.toJSON()),
      conditions: this.conditions,
      description: this.description,
      source_text: this.source_text,
    }
  }

  /** Самое первое действие (для обратной совместимости). */
  get primary_action(): Action | null {
    return this.actions[0] ?? null
  }

  /** Стоимость в действиях (manual trigger → from conditions). */
  get cost_actions(): number {
    for (const c of this.conditions) {
      if (c.type === "cost_actions") return c.value
    }
    return 0
  }
}

// ───────── ГИДРАТОР: JSON → Mechanic[] ─────────

/**
 * Превращает массив механик из JSON (БД или .json файла) в массив инстансов Mechanic.
 * Контракт синхронизирован с scripts/parse_mechanics.py — те же ключи,
 * та же структура actions[].
 *
 * @param raw  массив JSON-механик (как mechanics[] в cards[i])
 * @param card_id  id карты (для обратной трассировки)
 * @returns  Mechanic[] с распарсенными Action-объектами
 */
export function hydrateMechanics(raw: unknown, card_id: string | null = null): Mechanic[] {
  if (!Array.isArray(raw)) return []
  const out: Mechanic[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const m = item as Record<string, unknown>
    const trigger = (typeof m.trigger === "string" ? m.trigger : "manual") as TriggerKey
    const actions: Action[] = []
    if (Array.isArray(m.actions)) {
      for (const a of m.actions) {
        if (!a || typeof a !== "object") continue
        actions.push(hydrateAction(a as Record<string, unknown>))
      }
    }
    out.push(new Mechanic({
      trigger,
      actions,
      conditions: Array.isArray(m.conditions) ? (m.conditions as Condition[]) : [],
      description: typeof m.description === "string" ? m.description : "",
      source_text: typeof m.source_text === "string" ? m.source_text : "",
      owner_card_id: card_id,
    }))
  }
  return out
}

/**
 * Гидрат одного Action из JSON в один из классов Actions.
 * Зеркалит Python: scripts/parse_mechanics.py — те же type, те же params.
 */
export function hydrateAction(json: Record<string, unknown>): Action {
  const type = String(json.type ?? "manual")
  const target = (typeof json.target === "string" ? json.target : Target.NONE) as TargetKey
  const source_text = typeof json.source_text === "string" ? json.source_text : ""
  const amount = typeof json.amount === "number" ? json.amount : Number(json.amount) || 0

  switch (type) {
    case "deal_damage":
      return new DealDamage({
        amount,
        target,
        pierce: json.pierce === true,
        source_text,
      })
    case "aoe_damage":
      return new AoeDamage({
        amount,
        filter: typeof json.filter === "string" ? json.filter : "",
        target,
        source_text,
      })
    case "heal":
      return new Heal({
        amount,
        target,
        cap: typeof json.cap === "number" ? json.cap : 25,
        source_text,
      })
    case "draw_cards":
      return new DrawCards({
        count: amount,
        target,
        source: typeof json.source === "string" ? json.source : "deck",
        filter: typeof json.filter === "string" ? json.filter : "",
        source_text,
      })
    case "discard_cards":
      return new DiscardCards({
        count: amount,
        target,
        source: typeof json.source === "string" ? json.source : "hand",
        random: json.random === true,
        source_text,
      })
    case "search":
      return new Search({
        source: typeof json.source === "string" ? json.source : "deck",
        count: amount || 1,
        filter: typeof json.filter === "string" ? json.filter : "any",
        destination: target,
        source_text,
      })
    case "destroy":
      return new Destroy({ target, count: amount || 1, source_text })
    case "move":
      return new Move({
        target,
        destination: typeof json.destination === "string" ? (json.destination as TargetKey) : Target.THIS_LANE,
        return_after_battle: json.return_after_battle === true,
        source_text,
      })
    case "return_from_discard":
      return new ReturnFromDiscard({
        target,
        cost_filter: json.cost_filter as (string | number | null) ?? null,
        destination: typeof json.destination === "string" ? (json.destination as TargetKey) : Target.HAND,
        source_text,
      })
    case "flip_landscape":
      return new FlipLandscape({
        target,
        face: (json.face ?? "down") as "down" | "up" | "any",
        source_text,
      })
    case "freeze_landscape":
      return new FreezeLandscape({ target, source_text })
    case "stat_buff": {
      const stat = (json.stat ?? "attack") as Stat
      const dur = (json.duration ?? "persistent") as "this_turn" | "persistent"
      // amount может быть числом ИЛИ строкой вида "x2"
      const rawAmount = json.amount
      const amount: number | string =
        typeof rawAmount === "number" ? rawAmount
        : typeof rawAmount === "string" ? rawAmount
        : 1
      return new StatBuff({
        stat,
        amount,
        target,
        duration: dur,
        source_text,
      })
    }
    case "gain_actions":
      return new GainActions({ count: amount, source_text })
    case "flip_ability":
      return new FlipAbility({
        cost: typeof json.cost === "number" ? json.cost : 0,
        is_free: json.is_free === true,
        effect: typeof json.effect === "string" ? json.effect : "",
        source_text,
      })
    case "ignore_damage":
      return new IgnoreDamage({
        amount,
        source: typeof json.source === "string" ? json.source : "on_self",
        source_text,
      })
    case "face_attack":
      return new FaceAttack({ source_text })
    case "play_for_free":
      return new PlayForFree({
        card_type: typeof json.card_type === "string" ? json.card_type : (typeof json.target === "string" ? json.target : "any"),
        cost_filter: (json.cost_filter as number | null) ?? null,
        source_text,
      })
    case "cost_reduction":
      return new CostReduction({
        amount,
        scope: typeof json.scope === "string" ? json.scope : (typeof json.target === "string" ? json.target : "self"),
        source_text,
      })
    case "immunity":
      return new Immunity({
        to: typeof json.to === "string" ? json.to : "destroy",
        source_text,
      })
    case "imperative":
      return new Imperative({
        verb: typeof json.verb === "string" ? json.verb : "",
        target,
        source_text,
      })
    case "peek":
      return new Peek({
        count: amount || 1,
        source: typeof json.source === "string" ? json.source : "deck",
        source_text,
      })
    case "mill":
      return new Mill({
        count: amount || 1,
        source: typeof json.source === "string" ? json.source : "deck",
        source_text,
      })
    default:
      // generic — храним как manual нераспознанное
      return new Imperative({ verb: type, target, source_text })
  }
}

// ───────── ХЕЛПЕР: извлечь имя цели в TargetKey ─────────

/**
 * Конвертирует строку из Target-пространства в TargetKey.
 * Используется при гидратации mechanic из старого формата (target = "self").
 */
export function toTarget(s: string | undefined | null): TargetKey {
  if (!s) return Target.NONE
  const keys = Object.values(Target) as string[]
  if (keys.includes(s)) return s as TargetKey
  return Target.NONE
}

/**
 * Утилита: вытаскивает из JSON главное действие механики в виде plain object
 * для UI (без инстансов). Обратная совместимость с has_flip + flip_description.
 */
export function mechanicSummary(json: Record<string, unknown>): {
  trigger: TriggerKey
  primary: string
  cost: number
} {
  const trigger = (typeof json.trigger === "string" ? json.trigger : "manual") as TriggerKey
  const actions = Array.isArray(json.actions) ? json.actions : []
  const primaryAction = actions[0] as Record<string, unknown> | undefined
  const primary = primaryAction
    ? `${primaryAction.type ?? "manual"}(${JSON.stringify(primaryAction).slice(0, 60)})`
    : ""
  const conds = Array.isArray(json.conditions) ? (json.conditions as Condition[]) : []
  const cost = conds.find(c => c.type === "cost_actions")?.value ?? 0
  return { trigger, primary, cost: Number(cost) }
}
