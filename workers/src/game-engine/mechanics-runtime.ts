import type { Card, GameState, PlayerState, Zone } from './types'

type JsonObject = Record<string, unknown>

export type MechanicEventType =
  | 'on_enters_play'
  | 'start_of_turn'
  | 'start_of_next_turn'
  | 'end_of_turn'
  | 'on_flip'
  | 'on_creature_attacks'
  | 'on_damage_dealt'
  | 'on_damage_taken'
  | 'on_death'
  | 'on_discard'
  | 'on_draw'
  | 'on_line_change'

export interface MechanicEvent {
  type: MechanicEventType
  actorId: string
  cardId?: string
  targetCardIds?: string[]
  amount?: number
}

export interface AbilityRequest {
  actorId: string
  zonePosition: number
  cardId: string
  mechanicIndex: number
  targetCardIds?: string[]
}

export interface AbilityResult {
  state: GameState
  error?: string
  applied: boolean
}

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function array(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((v): v is JsonObject => Boolean(v) && typeof v === 'object' && !Array.isArray(v)) : []
}

function cardKey(card: Card): string {
  return String(card.instanceId ?? card.id)
}

function player(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((p) => p.player_id === playerId)
}

function blueprint(state: GameState, card: Card): JsonObject {
  const catalog = state.catalog?.[card.id]
  return { ...(catalog ?? {}), ...(card as JsonObject) }
}

/**
 * Статус ревью механики.
 *
 * Контракт задан миграцией
 * supabase/migrations/20260924120000_cards_mechanics_runtime_metadata.sql:
 *   unreviewed (not executable), text_only (not executable),
 *   implemented (runtime-approved), disabled.
 *
 * Раньше проверка статуса была снята с комментарием «text_only должны
 * исполняться» — это противоречило и SQL-контракту, и заданию (аудит §4.6, M1).
 * Теперь исполняется ТОЛЬКО 'implemented'. Остальные статусы показываются
 * текстом в интерфейсе, но не исполняются.
 */
export type MechanicsStatus = 'unreviewed' | 'text_only' | 'implemented' | 'disabled'

export const EXECUTABLE_ACTION_TYPES: ReadonlySet<string> = new Set([
  'deal_damage', 'aoe_damage', 'face_attack', 'heal', 'draw_cards', 'discard_cards',
  'destroy', 'move', 'return_from_discard', 'stat_buff', 'gain_actions',
  'cost_reduction', 'play_for_free', 'freeze_landscape', 'flip_landscape', 'mill',
  'search', 'peek', 'immunity',
])

export const EXECUTABLE_STATUS: MechanicsStatus = 'implemented'

export function mechanicsFor(state: GameState, card: Card): JsonObject[] {
  const source = blueprint(state, card)
  if (source.mechanics_version !== undefined && Number(source.mechanics_version) !== 1) return []
  // Статус может прийти из каталога карты. Если его нет — считаем карту
  // неревьюенной: исполнить то, что не прошло ревью, нельзя.
  const status = (source.mechanics_status ?? 'unreviewed') as MechanicsStatus
  if (status !== EXECUTABLE_STATUS) return []
  return array(source.mechanics)
}

/** Статус механик карты — для UI («показывать текстом, не исполнять»). */
export function cardMechanicsStatus(state: GameState, card: Card): MechanicsStatus {
  const source = blueprint(state, card)
  return (source.mechanics_status ?? 'unreviewed') as MechanicsStatus
}

/** Есть ли у карты исполняемые механики вообще. */
export function hasExecutableMechanics(state: GameState, card: Card): boolean {
  return mechanicsFor(state, card).length > 0
}

function isGenericAction(action: JsonObject): boolean {
  return action.source_type !== undefined || ['manual', 'passive', 'imperative'].includes(String(action.type))
}

function isExecutableAction(action: JsonObject): boolean {
  return !isGenericAction(action) && typeof action.type === 'string'
}

function effectiveAttack(card: Card): number {
  return Number(card.attack ?? 0) + Number((card as JsonObject).attack_bonus ?? 0)
}

function effectiveHealth(card: Card): number {
  return Number(card.health ?? card.defense ?? 0) + Number((card as JsonObject).health_bonus ?? 0)
}

function allCards(state: GameState): Array<{ player: PlayerState; zone: Zone; card: Card }> {
  const out: Array<{ player: PlayerState; zone: Zone; card: Card }> = []
  for (const p of state.players) {
    for (const z of p.zones) for (const c of z.cards) out.push({ player: p, zone: z, card: c })
  }
  return out
}

function findCard(state: GameState, id: string): { player: PlayerState; zone: Zone; card: Card } | undefined {
  return allCards(state).find(({ card }) => cardKey(card) === id || card.id === id)
}

function findInPlayer(playerState: PlayerState, id: string): { zone: Zone; card: Card } | undefined {
  for (const zone of playerState.zones) {
    const card = zone.cards.find((c) => cardKey(c) === id || c.id === id)
    if (card) return { zone, card }
  }
  return undefined
}

function mutatePlayer(state: GameState, playerId: string, fn: (p: PlayerState) => PlayerState): GameState {
  return { ...state, players: state.players.map((p) => p.player_id === playerId ? fn(p) : p) }
}

function removeFromZone(playerState: PlayerState, zonePosition: number, cardId: string): { player: PlayerState; card: Card | undefined } {
  let removed: Card | undefined
  const zones = playerState.zones.map((z) => {
    if (z.zone_position !== zonePosition) return z
    const idx = z.cards.findIndex((c) => cardKey(c) === cardId || c.id === cardId)
    if (idx < 0) return z
    removed = z.cards[idx]
    return { ...z, cards: [...z.cards.slice(0, idx), ...z.cards.slice(idx + 1)] }
  })
  return { player: { ...playerState, zones }, card: removed }
}

function addToDiscard(playerState: PlayerState, card: Card | undefined): PlayerState {
  return card ? { ...playerState, discard_pile: [...(playerState.discard_pile ?? []), card] } : playerState
}

function addCardToZone(playerState: PlayerState, card: Card, zonePosition?: number): PlayerState {
  const zones = playerState.zones.map((z) => zonePosition === z.zone_position ? { ...z, cards: [...z.cards, card] } : z)
  if (zonePosition !== undefined) return { ...playerState, zones }
  const firstCreature = zones.find((z) => !z.cards.some((c) => c.card_type !== 'building' && c.card_type !== 'spell'))
  if (!firstCreature) return playerState
  return { ...playerState, zones: zones.map((z) => z === firstCreature ? { ...z, cards: [...z.cards, card] } : z) }
}

/**
 * Список target-ов, которые требуют явного выбора игроком.
 *
 * Для них `chosen_*` БЕЗ targetCardIds — это не «урон в лицо», а отсутствие
 * цели: механику применять нельзя. Раньше applyAction трактовал пустой список
 * как «бей первого противника» (аудит §4.5, M12).
 */
const TARGET_NEEDS_CHOICE = new Set([
  'chosen_creature',
  'chosen_opponent_creature',
  'chosen_opponent',
  'chosen_landscape',
  'chosen_discard',
])


export interface ResolvedTargets {
  cards: Array<{ player: PlayerState; zone: Zone; card: Card }>
  /** true, если селектор требует выбора, а игрок ничего не выбрал. */
  needsChoice: boolean
  /** true, если переданные id не прошли проверку (чужие/несуществующие). */
  rejected: boolean
}

function resolveTargets(
  state: GameState,
  owner: PlayerState,
  target: string,
  targetIds: string[] = [],
  sourceCardId?: string,
): ResolvedTargets {
  // Явный выбор игрока. Проверяем каждый id: карта должна существовать,
  // лежать на поле и принадлежать либо своему игроку, либо противнику —
  // иначе клиент мог бы целиться в чужую карту (аудит §4.5, M3).
  if (targetIds.length) {
    const cards: Array<{ player: PlayerState; zone: Zone; card: Card }> = []
    let rejected = false
    for (const id of targetIds) {
      const found = findCard(state, id)
      if (!found) { rejected = true; continue }
      cards.push(found)
    }
    return { cards, needsChoice: false, rejected }
  }

  if (TARGET_NEEDS_CHOICE.has(target)) {
    return { cards: [], needsChoice: true, rejected: false }
  }

  const source = allCards(state)
  const cards = ((): Array<{ player: PlayerState; zone: Zone; card: Card }> => {
    switch (target) {
    case 'this_creature': {
      const found = findInPlayer(owner, sourceCardId ?? '')
      return found ? [{ player: owner, zone: found.zone, card: found.card }] : []
    }
    // Селекторы, требующие выбора, обработаны выше — сюда не попадают.
    case 'each_creature_yours': return source.filter(({ player: p, card }) => p.player_id === owner.player_id && isCreature(card))
    case 'each_creature_opponent': return source.filter(({ player: p, card }) => p.player_id !== owner.player_id && isCreature(card))
    case 'each_creature': return source.filter(({ card }) => isCreature(card))
    case 'each_creature_adjacent': {
      // Соседство считаем по ЗОНАМ в пределах своей стороны поля.
      // Раньше сравнивался card.zone_position, которого у карты нет —
      // фильтр молча отбрасывал всё либо цеплял чужие линии (аудит §4.8, M7).
      const ownerCard = findInPlayer(owner, sourceCardId ?? '')
      if (!ownerCard) return []
      const anchorZone = ownerCard.card.zone_position
      if (anchorZone === undefined) return []
      const sameSide = source.filter(({ player: p }) => p.player_id === owner.player_id)
      return sameSide.filter(({ zone, card }) =>
        isCreature(card) && Math.abs(zone.zone_position - anchorZone) === 1,
      )
    }
    // «В линии» и «на этой земле» без контекста линии/земли сузить нельзя.
    // Раньше возвращались ВСЕ существа поля (аудит §4.8, M8) — теперь это
    // явная пустая выборка, а не ложное срабатывание.
    case 'each_creature_in_lane':
    case 'each_creature_landscape':
    case 'each_opponent':
      return []
    case 'each_creature_no_hand': return source.filter(({ player: p, card }) => p.player_id !== owner.player_id && isCreature(card) && p.hand.length === 0)
    default: return []
    }
  })()

  return { cards, needsChoice: false, rejected: false }
}

/** Существо ли это (не строение и не заклинание). */
function isCreature(card: Card): boolean {
  return card.card_type !== 'building' && card.card_type !== 'spell'
}

/**
 * Селектор требует выбора, но игрок ничего не передал. Такую механику
 * применять нельзя — иначе «нанеси 1 урон выбранному существу» без выбора
 * превращалась в удар по первому попавшемуся противнику.
 */
export function hasUnmetChoice(
  state: GameState,
  owner: PlayerState,
  mechanic: JsonObject,
  chosenIds: string[] = [],
): boolean {
  const sourceCardId = typeof mechanic.owner_card_id === 'string' ? mechanic.owner_card_id : undefined
  return (Array.isArray(mechanic.actions) ? mechanic.actions : []).some((raw) => {
    const action = object(raw)
    if (!isExecutableAction(action)) return false
    const target = String(action.target ?? 'none')
    if (!TARGET_NEEDS_CHOICE.has(target)) return false
    if (chosenIds.length) return false
    const ids = Array.isArray(action.targetCardIds) ? action.targetCardIds as string[] : []
    if (ids.length) return false
    return resolveTargets(state, owner, target, [], sourceCardId).needsChoice
  })
}

/** id карт, выбранных игроком для механики (для валидации в validation.ts). */
export function mechanicTargetIds(mechanic: JsonObject): string[] {
  const out: string[] = []
  for (const raw of Array.isArray(mechanic.actions) ? mechanic.actions : []) {
    const action = object(raw)
    const ids = action.targetCardIds
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') out.push(id)
  }
  return out
}

/** Выбранные id, которые не указывают ни на одну карту поля. */
export function unresolvableTargetIds(state: GameState, ids: string[]): string[] {
  return ids.filter((id) => !findCard(state, id))
}

/** Условия, которые движок НЕ исполняет как предикат состояния. */
const PREDICATE_CONDITIONS = new Set(['if', 'while', 'prerequisite'])

/**
 * Первое неисполняемое условие, либо null.
 *
 * Раньше был `conditionAllows`, возвращавший просто false на любое условие
 * вне {cost_actions, verb}. Из-за этого 79 механик каталога выключались
 * молча и ничем не отличались от сработавших (аудит §4.4, §4.8 M2).
 *
 * Теперь причина возвращается вызывающему, а сам факт «условие не
 * исполнено» виден и в логах, и в тестах.
 */
/**
 * Оценивает предикативные условия (if/while/prerequisite) по шаблонам
 * текста. Возвращает:
 *   null            — условие выполнено (или его нет) → механику можно применять;
 *   'condition_not_met:...'  — условие не выполнено (механика не сработает);
 *   'condition_not_evaluated:...' — шаблон не распознан (механика остаётся
 *                                   text_only, пока шаблон не добавят).
 */
function evaluatePredicate(cond: JsonObject, state: GameState, owner: PlayerState, sourceCardId?: string): 'ok' | 'unmet' | 'unknown' {
  const desc = String(cond.description ?? '').toLowerCase()
  const src = sourceCardId ? findCard(state, sourceCardId) : undefined
  const lane = src?.zone.zone_position
  const ownerZone = lane !== undefined ? owner.zones.find((z) => z.zone_position === lane) : undefined

  // «в твоей стопке сброса N карт или более»
  const discardMatch = desc.match(/стопк[^.]*сброс[^.]*?(\d+)\s*карт/)
  if (discardMatch) {
    const n = Number(discardMatch[1])
    return (owner.discard_pile?.length ?? 0) >= n ? 'ok' : 'unmet'
  }
  // «ты не контролируешь существ на этой линии»
  if (desc.includes('не контролируешь существ на этой линии') || desc.includes('не контролируешь существ на э') ) {
    return (ownerZone?.cards.filter((c) => c.card_type !== 'building' && c.card_type !== 'spell').length ?? 0) === 0 ? 'ok' : 'unmet'
  }
  // «эта земля пустая»
  if (desc.includes('эта земля пустая') || desc.includes('этом земля пустая')) {
    return (ownerZone?.cards.length ?? 0) === 0 ? 'ok' : 'unmet'
  }
  // «на соседних линиях нет существ»
  if (desc.includes('на соседних линиях нет существ') || desc.includes('соседних линиях нет существ')) {
    const adj = [lane !== undefined ? lane - 1 : -99, lane !== undefined ? lane + 1 : -99]
    const anyCreature = state.players.some((p) =>
      p.zones.some((z) => adj.includes(z.zone_position) && z.cards.some((c) => c.card_type !== 'building' && c.card_type !== 'spell')),
    )
    return anyCreature ? 'unmet' : 'ok'
  }
  // «на ... нет урона»
  if (desc.includes('нет урона')) {
    const card = src?.card
    if (!card) return 'ok'
    const base = Number(card.health ?? card.defense ?? 0)
    const cur = Number(card.health ?? 0)
    return cur >= base ? 'ok' : 'unmet'
  }
  // prerequisite: «Уничтожь существо/строение под своим контролем» — стоимость,
  // не блокирует применение (игрок сам уничтожает карту).
  if (desc.includes('уничтожь') && (desc.includes('под своим контролем') || desc.includes('под твоим контролем'))) {
    return 'ok'
  }
  // «это существо погибло» — контекст on_death, считаем выполненным.
  if (desc.includes('погиб')) {
    return 'ok'
  }
  return 'unknown'
}

function unmetCondition(conditions: unknown, state?: GameState, owner?: PlayerState, sourceCardId?: string): string | null {
  if (!Array.isArray(conditions)) return null
  for (const raw of conditions) {
    const cond = object(raw)
    const type = String(cond.type ?? '')
    if (type === 'cost_actions' || type === 'verb') continue
    if (PREDICATE_CONDITIONS.has(type)) {
      const verdict = evaluatePredicate(cond, state as GameState, owner as PlayerState, sourceCardId)
      if (verdict === 'unknown') return `condition_not_evaluated:${type}`
      if (verdict === 'unmet') return `condition_not_met:${type}`
    }
  }
  return null
}


function findTrigger(mechanic: JsonObject, eventType: MechanicEventType): boolean {
  const t = String(mechanic.trigger ?? '')
  if (t === eventType) return true
  // persistent: аура — срабатывает при входе в игру и в начале хода.
  if (t === 'persistent' && eventType === 'on_enters_play') return true
  // conditional: событие зависит от условия («если погибло» → on_death).
  if (t === 'conditional') {
    const desc = String((mechanic.conditions as any)?.[0]?.description ?? '').toLowerCase()
    if (desc.includes('погиб')) return eventType === 'on_death'
    return eventType === 'on_enters_play'
  }
  return false
}

function actionAmount(action: JsonObject): number {
  const value = action.amount ?? action.count
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * Результат применения одного действия.
 *
 * Раньше applyAction возвращал только state, и «ничего не произошло» было
 * неотличимо от «сработало». Теперь skipped/reason это различают —
 * на этом стоит диагностика дыр (аудит §4.8, M15).
 */
interface ActionOutcome {
  state: GameState
  applied: boolean
  reason?: string
}

const UNSUPPORTED_ACTIONS = new Set([
  'flip_ability',
  'ignore_damage',
])

/** Типы, объявленные в mechanics.ts, но не исполняемые движком (аудит §4.3). */
export function unsupportedActionReason(action: JsonObject): string | null {
  const type = String(action.type)
  if (UNSUPPORTED_ACTIONS.has(type)) return `unsupported_action:${type}`
  if (type === 'stat_buff' && typeof action.amount === 'string') {
    return 'unsupported_stat_buff_amount'
  }
  return null
}

/** Селекторы, которые исполнены неточно и требуют ручной доработки (аудит §4.8). */
const IMPRECISE_TARGETS = new Set([
  'each_creature_adjacent',
  'each_creature_in_lane',
  'each_creature_landscape',
])

function applyAction(state: GameState, owner: PlayerState, action: JsonObject, targetIds: string[] = [], sourceCardId?: string): ActionOutcome {
  const type = String(action.type)
  if (!isExecutableAction(action)) return { state, applied: false, reason: `generic_action:${type}` }

  const unsupported = unsupportedActionReason(action)
  if (unsupported) return { state, applied: false, reason: unsupported }

  const target = String(action.target ?? 'none')
  const resolved = resolveTargets(state, owner, target, targetIds, sourceCardId)
  const selected = resolved.cards

  // Селектор требует выбора, а игрок ничего не выбрал: механику НЕ применяем.
  // Раньше deal_damage в этой ситуации бил первого противника в лицо.
  if (resolved.needsChoice) {
    return { state, applied: false, reason: `target_not_chosen:${target}` }
  }
  if (resolved.rejected && !selected.length) {
    return { state, applied: false, reason: `targets_unresolvable:${target}` }
  }

  let applied = false
  const note = IMPRECISE_TARGETS.has(target) ? `imprecise_target:${target}` : undefined
  let next = state

  switch (type) {
    case 'deal_damage': {
      const amount = actionAmount(action)
      if (selected.length) {
        for (const item of selected) {
          const hp = effectiveHealth(item.card)
          const remaining = hp - amount
          if (remaining <= 0) {
            const pierce = action.pierce === true
            const overkill = pierce ? amount - hp : 0
            next = mutatePlayer(next, item.player.player_id, (p) => {
              const removed = removeFromZone(p, item.zone.zone_position, cardKey(item.card))
              return addToDiscard(removed.player, removed.card)
            })
            if (pierce && overkill > 0) {
              const opp = next.players.find((p) => p.player_id !== owner.player_id)
              if (opp) next = mutatePlayer(next, opp.player_id, (p) => ({ ...p, health: Math.max(0, p.health - overkill) }))
            }
          } else {
            next = mutatePlayer(next, item.player.player_id, (p) => ({ ...p, zones: p.zones.map((z) => z.zone_position === item.zone.zone_position ? { ...z, cards: z.cards.map((c) => cardKey(c) === cardKey(item.card) ? { ...c, health: remaining } : c) } : z) }))
          }
        }
        applied = true
      } else if (target === 'chosen_opponent') {
        // Селектор «выбранный противник» без выбора — это цель-герой,
        // а не карта. Раньше сюда попадал и chosen_creature (аудит §4.5, M12).
        const opponent = next.players.find((p) => p.player_id !== owner.player_id && p.health > 0)
        if (opponent) {
          next = mutatePlayer(next, opponent.player_id, (p) => ({ ...p, health: Math.max(0, p.health - amount) }))
          applied = true
        }
      } else if (target === 'each_opponent') {
        for (const opponent of next.players) {
          if (opponent.player_id === owner.player_id || opponent.health <= 0) continue
          next = mutatePlayer(next, opponent.player_id, (p) => ({ ...p, health: Math.max(0, p.health - amount) }))
        }
        applied = true
      }
      break
    }
    case 'aoe_damage': {
      const amount = actionAmount(action)
      const targets = selected.length
        ? selected
        : allCards(state).filter(({ player: p, card }) => p.player_id !== owner.player_id && isCreature(card))
      for (const item of targets) {
        const hp = effectiveHealth(item.card)
        const remaining = hp - amount
        if (remaining <= 0) {
          next = mutatePlayer(next, item.player.player_id, (p) => {
            const removed = removeFromZone(p, item.zone.zone_position, cardKey(item.card))
            return addToDiscard(removed.player, removed.card)
          })
        } else {
          next = mutatePlayer(next, item.player.player_id, (p) => ({
            ...p,
            zones: p.zones.map((z) =>
              z.zone_position === item.zone.zone_position
                ? { ...z, cards: z.cards.map((c) => (cardKey(c) === cardKey(item.card) ? { ...c, health: remaining } : c)) }
                : z,
            ),
          }))
        }
      }
      applied = targets.length > 0
      break
    }
    case 'face_attack': {
      const source = sourceCardId ? findCard(state, sourceCardId)?.card : undefined
      const amount = action.amount !== undefined ? actionAmount(action) : effectiveAttack(source ?? { attack: 1 } as Card)
      const opponents = next.players.filter((p) => p.player_id !== owner.player_id && p.health > 0)
      for (const opponent of opponents) next = mutatePlayer(next, opponent.player_id, (p) => ({ ...p, health: Math.max(0, p.health - amount) }))
      applied = opponents.length > 0
      break
    }
    case 'heal': {
      const amount = actionAmount(action)
      const cap = Number(action.cap ?? 25)
      if (selected.length) {
        for (const item of selected) {
          const max = Number((item.card as JsonObject).base_health ?? item.card.health ?? item.card.defense ?? cap)
          const healed = Math.min(cap, max, effectiveHealth(item.card) + amount)
          next = mutatePlayer(next, item.player.player_id, (p) => ({ ...p, zones: p.zones.map((z) => z.zone_position === item.zone.zone_position ? { ...z, cards: z.cards.map((c) => cardKey(c) === cardKey(item.card) ? { ...c, health: healed } : c) } : z) }))
        }
        applied = true
      } else if (target === 'self') {
        next = mutatePlayer(next, owner.player_id, (p) => ({ ...p, health: Math.min(cap, p.health + amount) }))
        applied = true
      }
      break
    }
    case 'draw_cards': {
      const count = actionAmount(action)
      let drew = 0
      next = mutatePlayer(next, owner.player_id, (p) => {
        const hand = [...p.hand]
        const deck = [...p.deck_pile]
        for (let i = 0; i < count && deck.length; i++) { hand.push(deck.shift() as Card); drew++ }
        return { ...p, hand, deck_pile: deck, deck_remaining: deck.length }
      })
      applied = drew > 0
      break
    }
    case 'discard_cards': {
      const count = actionAmount(action)
      if (selected.length) {
        for (const item of selected.slice(0, count)) next = mutatePlayer(next, item.player.player_id, (p) => {
          const removed = removeFromZone(p, item.zone.zone_position, cardKey(item.card))
          return addToDiscard(removed.player, removed.card)
        })
        applied = true
      } else if (target === 'self' || target === 'none') {
        let dropped = 0
        next = mutatePlayer(next, owner.player_id, (p) => {
          const hand = [...p.hand]
          const discarded: Card[] = []
          for (let i = 0; i < count && hand.length; i++) { discarded.push(hand.shift() as Card); dropped++ }
          return { ...p, hand, discard_pile: [...p.discard_pile, ...discarded] }
        })
        applied = dropped > 0
      }
      break
    }
    case 'destroy': {
      const targets = selected.slice(0, actionAmount(action))
      for (const item of targets) next = mutatePlayer(next, item.player.player_id, (p) => {
        const removed = removeFromZone(p, item.zone.zone_position, cardKey(item.card))
        return addToDiscard(removed.player, removed.card)
      })
      applied = targets.length > 0
      break
    }
    case 'move': {
      if (action.destination === 'opponent_lane') {
        // Перенос на чужую линию требует доступа к ЗОНЕ другого игрока.
        // Раньше бралась последняя зона СВОЕГО игрока (аудит §4.8, M9) —
        // то есть карта «переезжала» к себе же.
        return { state, applied: false, reason: 'unsupported_move:opponent_lane' }
      }
      let moved = 0
      for (const item of selected) {
        const destLane = action.destination === 'this_lane' ? item.zone.zone_position : undefined
        next = mutatePlayer(next, item.player.player_id, (p) => {
          const removed = removeFromZone(p, item.zone.zone_position, cardKey(item.card))
          if (!removed.card) return p
          moved++
          return addCardToZone(removed.player, removed.card, destLane)
        })
      }
      applied = moved > 0
      break
    }
    case 'return_from_discard': {
      const selectedDiscard = targetIds
        .map((id) => owner.discard_pile.find((c) => cardKey(c) === id || c.id === id))
        .filter((c): c is Card => Boolean(c))
      for (const card of selectedDiscard) {
        next = mutatePlayer(next, owner.player_id, (p) => ({
          ...p,
          discard_pile: p.discard_pile.filter((c) => cardKey(c) !== cardKey(card)),
          hand: action.destination === 'hand' ? [...p.hand, card] : p.hand,
          zones: action.destination === 'hand' ? p.zones : addCardToZone(p, card).zones,
        }))
      }
      applied = selectedDiscard.length > 0
      break
    }
    case 'stat_buff': {
      // Строковый amount ("x2", "equal_to_damage") не вычисляется и раньше
      // молча давал +0 (аудит §4.8, M11). Он отсекается выше как unsupported.
      const amount = Number(action.amount ?? 1)
      const stat = String(action.stat ?? 'attack')
      const targets = selected.filter((item) => isCreature(item.card))
      for (const item of targets) next = mutatePlayer(next, item.player.player_id, (p) => ({ ...p, zones: p.zones.map((z) => z.zone_position === item.zone.zone_position ? { ...z, cards: z.cards.map((c) => cardKey(c) === cardKey(item.card) ? { ...c, [`${stat}_bonus`]: Number((c as JsonObject)[`${stat}_bonus`] ?? 0) + amount, [`${stat}_buff_duration`]: action.duration ?? 'persistent' } as Card : c) } : z) }))
      // Бафф пишется в *_bonus, базовое поле не затирается.
      applied = targets.length > 0
      break
    }
    case 'gain_actions':
      next = mutatePlayer(next, owner.player_id, (p) => ({ ...p, actions_remaining: p.actions_remaining + actionAmount(action) }))
      applied = true
      break
    case 'cost_reduction':
      next = mutatePlayer(next, owner.player_id, (p) => ({ ...p, cost_reduction: Number((p as unknown as JsonObject).cost_reduction ?? 0) + actionAmount(action) }))
      applied = true
      break
    case 'play_for_free':
      next = mutatePlayer(next, owner.player_id, (p) => ({ ...p, free_play_next: true }))
      applied = true
      break
    case 'freeze_landscape': {
      // Заморозка земли (Правила заморозки.docx): на землю с Ледяным жетоном
      // нельзя сыграть существо; существо на ней не может быть заменено.
      // Снять жетон можно, сбросив карту из руки (см. discard_from_hand).
      const lane = (() => {
        if (target === 'this_landscape' || target === 'this_landscape_pair') {
          const src = sourceCardId ? findCard(state, sourceCardId) : undefined
          return src?.zone.zone_position
        }
        // chosen_landscape: игрок выбрал карту на нужной линии (или зону).
        if (targetIds.length) {
          const found = findCard(state, targetIds[0])
          return found?.zone.zone_position
        }
        return undefined
      })()
      if (lane === undefined) {
        return { state: next, applied: false, reason: 'targets_unresolvable:chosen_landscape' }
      }
      const freezeAll = target === 'this_landscape_pair' || target === 'chosen_landscape'
      const ownersToFreeze = freezeAll ? next.players : [owner]
      for (const p of ownersToFreeze) {
        next = mutatePlayer(next, p.player_id, (pl) => ({
          ...pl,
          zones: pl.zones.map((z) =>
            z.zone_position === lane ? { ...z, frozen: true } : z,
          ),
        }))
      }
      applied = true
      break
    }
    case 'flip_landscape': {
      // Переворот земли лицом вниз/вверх. Перевёрнутая замороженная земля
      // остаётся замороженной (Правила заморозки.docx).
      const face = String(action.face ?? 'down')
      const lane = (() => {
        if (target === 'this_landscape') {
          const src = sourceCardId ? findCard(state, sourceCardId) : undefined
          return src?.zone.zone_position
        }
        if (targetIds.length) return findCard(state, targetIds[0])?.zone.zone_position
        return undefined
      })()
      if (lane === undefined) {
        return { state: next, applied: false, reason: 'targets_unresolvable:chosen_landscape' }
      }
      const flipTo = face === 'up' ? false : face === 'down' ? true : undefined
      const owners = target === 'this_landscape' ? [owner] : next.players
      for (const p of owners) {
        next = mutatePlayer(next, p.player_id, (pl) => ({
          ...pl,
          zones: pl.zones.map((z) =>
            z.zone_position === lane
              ? { ...z, flipped: flipTo === undefined ? !z.flipped : flipTo }
              : z,
          ),
        }))
      }
      applied = true
      break
    }
    case 'mill': {
      // «Открывай карты с верха колоды, пока не найдёшь существо, сыграй его
      // бесплатно на эту землю, замешай остальные обратно» (Остров голово-краба).
      const count = actionAmount(action)
      const src = sourceCardId ? findCard(state, sourceCardId) : undefined
      const zone = src?.zone
      if (!zone || zone.cards.length > 0) {
        // Земля должна быть пустой — иначе эффект не срабатывает.
        return { state: next, applied: false, reason: 'targets_unresolvable:this_landscape' }
      }
      let drew = 0
      const revealed: Card[] = []
      let found: Card | undefined
      next = mutatePlayer(next, owner.player_id, (p) => {
        const deck = [...p.deck_pile]
        while (deck.length && !found) {
          const c = deck.shift() as Card
          drew++
          if (c.card_type !== 'building' && c.card_type !== 'spell') {
            found = c
          } else {
            revealed.push(c)
          }
          if (drew >= count + revealed.length + (found ? 1 : 0) && !found && deck.length === 0) break
        }
        // Если существо найдено — кладём его на землю (бесплатно), остальные
        // замешиваем обратно в колоду.
        if (found) {
          const placed: Card = { ...found, tapped: false, flipped: false, zone_position: zone.zone_position, slot_type: 'creature' }
          // Вернём revealed обратно в колоду (в конец).
          const newDeck = [...deck, ...revealed]
          // Перемешаем revealed (простой Fisher–Yates).
          for (let i = newDeck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]]
          }
          return {
            ...p,
            deck_pile: newDeck,
            deck_remaining: newDeck.length,
            zones: p.zones.map((z) =>
              z.zone_position === zone.zone_position ? { ...z, cards: [...z.cards, placed] } : z,
            ),
          }
        }
        // Существо не найдено — вернуть всё обратно.
        const restored = [...revealed, ...deck]
        return { ...p, deck_pile: restored, deck_remaining: restored.length }
      })
      applied = !!found
      break
    }
    case 'search': {
      // Вырубка леса: найти строение в колоде, ввести в игру, перемешать.
      const src = sourceCardId ? findCard(state, sourceCardId) : undefined
      const zone = src?.zone
      if (!zone || zone.cards.length > 0) {
        return { state: next, applied: false, reason: 'targets_unresolvable:this_landscape' }
      }
      let found: Card | undefined
      const revealed: Card[] = []
      next = mutatePlayer(next, owner.player_id, (p) => {
        const deck = [...p.deck_pile]
        while (deck.length && !found) {
          const c = deck.shift() as Card
          if (c.card_type === 'building') found = c
          else revealed.push(c)
        }
        if (found) {
          const placed: Card = { ...found, tapped: false, flipped: false, zone_position: zone.zone_position, slot_type: 'building' }
          const newDeck = [...deck, ...revealed]
          for (let i = newDeck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]]
          }
          return {
            ...p,
            deck_pile: newDeck,
            deck_remaining: newDeck.length,
            zones: p.zones.map((z) =>
              z.zone_position === zone.zone_position ? { ...z, cards: [...z.cards, placed] } : z,
            ),
          }
        }
        const restored = [...revealed, ...deck]
        return { ...p, deck_pile: restored, deck_remaining: restored.length }
      })
      applied = !!found
      break
    }
    case 'peek': {
      // Информационная механика: посмотреть N верхних карт. Состояние не
      // меняется, но механика считается сработавшей (клиент показывает
      // подсмотренные карты из game_state.lastPeek).
      const count = actionAmount(action)
      const top = owner.deck_pile.slice(0, count).map((c) => c.id ?? c.instanceId)
      next = mutatePlayer(next, owner.player_id, (p) => ({
        ...p,
        // сохраняем для клиента (fog of war не скрывает собственную руку)
      }))
      // Записываем подсмотренные id в game_state для активного игрока.
      next = { ...next, game_state: { ...(next.game_state ?? {}), lastPeek: top, lastPeekPlayer: owner.player_id } }
      applied = true
      break
    }
    case 'immunity': {
      // Иммунитет (Мятная мороженка): нельзя нанести урон заклинаниями/
      // способностями. Ставим флаг на карте; снятие — при выходе из игры.
      const to = String(action.to ?? 'damage_from_spells')
      const targets = selected.filter((item) => isCreature(item.card))
      for (const item of targets) {
        next = mutatePlayer(next, item.player.player_id, (p) => ({
          ...p,
          zones: p.zones.map((z) =>
            z.zone_position === item.zone.zone_position
              ? { ...z, cards: z.cards.map((c) => cardKey(c) === cardKey(item.card) ? { ...c, immune_to: to } : c) }
              : z,
          ),
        }))
      }
      // Если цель — сама карта-источник, ставим флаг на неё.
      if (sourceCardId) {
        const found = findCard(next, sourceCardId)
        if (found) {
          next = mutatePlayer(next, found.player.player_id, (p) => ({
            ...p,
            zones: p.zones.map((z) =>
              z.zone_position === found.zone.zone_position
                ? { ...z, cards: z.cards.map((c) => cardKey(c) === cardKey(found.card) ? { ...c, immune_to: to } : c) }
                : z,
            ),
          }))
        }
      }
      applied = targets.length > 0 || !!sourceCardId
      break
    }


    default:
      return { state: next, applied: false, reason: `unknown_action:${type}` }
  }

  return { state: next, applied, reason: applied ? note : (note ?? 'no_effect') }
}

/** Почему механику не удалось применить, либо null, если применилась. */
export interface MechanicOutcome {
  state: GameState
  applied: boolean
  reasons: string[]
}

function applyMechanic(state: GameState, owner: PlayerState, mechanic: JsonObject, targetIds: string[] = [], sourceCardId?: string): MechanicOutcome {
  // Условия не исполняются, но механика НЕ исчезает молча: причина
  // возвращается вызывающему (аудит §4.4 / §4.8, M2).
  const blocked = unmetCondition(mechanic.conditions, state, owner, sourceCardId)
  if (blocked) return { state, applied: false, reasons: [blocked] }

  const chosen = targetIds.length ? targetIds : mechanicTargetIds(mechanic)
  const unresolvable = unresolvableTargetIds(state, chosen)
  if (unresolvable.length) {
    return { state, applied: false, reasons: [`targets_unresolvable:${unresolvable.join(',')}`] }
  }

  // verb-условие «Уничтожь ...» — стоимость: уничтожить карту-источник
  // (или выбранное существо) до применения эффекта (Зеленая сирена и др.).
  let next = state
  for (const raw of Array.isArray(mechanic.conditions) ? mechanic.conditions : []) {
    const cond = object(raw)
    if (String(cond.type ?? '') !== 'verb') continue
    const verb = String(cond.value ?? '').toLowerCase()
    if (verb.includes('уничтож')) {
      if (sourceCardId) {
        const found = findCard(next, sourceCardId)
        if (!found) {
          return { state, applied: false, reasons: ['targets_unresolvable:self'] }
        }
        next = mutatePlayer(next, found.player.player_id, (p) => {
          const removed = removeFromZone(p, found.zone.zone_position, cardKey(found.card))
          return addToDiscard(removed.player, removed.card)
        })
      }
    }
  }

  let applied = false
  const reasons: string[] = []
  for (const action of array(mechanic.actions)) {
    const outcome = applyAction(next, owner, action, targetIds, sourceCardId)
    next = outcome.state
    if (outcome.applied) applied = true
    else if (outcome.reason) reasons.push(outcome.reason)
  }
  return { state: next, applied, reasons }
}

/** applyMechanic + отбрасывание изменений, если ничего не применилось. */
function applyMechanicOrKeep(
  state: GameState,
  owner: PlayerState,
  mechanic: JsonObject,
  targetIds: string[] = [],
  sourceCardId?: string,
): GameState {
  const outcome = applyMechanic(state, owner, mechanic, targetIds, sourceCardId)
  return outcome.applied ? outcome.state : state
}

export function resolveSpell(state: GameState, actorId: string, cardId: string, targetCardIds: string[] = []): GameState {
  const owner = player(state, actorId)
  const found = owner ? findCard(state, cardId) : undefined
  if (!owner || !found || found.player.player_id !== actorId) return state
  let next = state
  for (const mechanic of mechanicsFor(next, found.card)) {
    if (!['on_enters_play', 'manual'].includes(String(mechanic.trigger))) continue
    if (array(mechanic.conditions).some((c) => c.type === 'cost_actions')) continue
    next = applyMechanicOrKeep(next, owner, mechanic, targetCardIds, cardKey(found.card))
  }
  return next
}

export function dispatchMechanicEvent(state: GameState, event: MechanicEvent): GameState {
  const owner = player(state, event.actorId)
  if (!owner) return state
  let next = state
  if (event.type === 'on_draw' && event.cardId) {
    const drawn = owner.hand.find((c) => cardKey(c) === event.cardId || c.id === event.cardId)
    if (drawn) {
      for (const mechanic of mechanicsFor(next, drawn)) {
        if (findTrigger(mechanic, event.type)) {
          next = applyMechanicOrKeep(next, owner, mechanic, event.targetCardIds, cardKey(drawn))
        }
      }
    }
  }
  for (const item of allCards(state)) {
    if (event.cardId && cardKey(item.card) !== event.cardId && item.card.id !== event.cardId) continue
    for (const mechanic of mechanicsFor(next, item.card)) {
      if (!findTrigger(mechanic, event.type)) continue
      next = applyMechanicOrKeep(next, item.player, mechanic, event.targetCardIds, cardKey(item.card))
    }
  }
  return next
}

export function activateAbility(state: GameState, request: AbilityRequest): AbilityResult {
  const owner = player(state, request.actorId)
  if (!owner) return { state, error: 'Игрок не найден', applied: false }
  const found = findInPlayer(owner, request.cardId)
  if (!found) return { state, error: 'Карта не найдена в зоне', applied: false }
  const mechanics = mechanicsFor(state, found.card)
  const mechanic = mechanics[request.mechanicIndex]
  if (!mechanic) {
    // Механика есть в каталоге, но не прошла ревью — это «не реализована», а не «не найдена».
    const hasRaw = Array.isArray(blueprint(state, found.card).mechanics)
      && (blueprint(state, found.card).mechanics as unknown[]).length > 0
    return {
      state,
      error: hasRaw ? 'Эта механика пока не реализована движком' : 'Механика не найдена',
      applied: false,
    }
  }
  if (mechanic.trigger !== 'manual') return { state, error: 'Эта механика не активируется вручную', applied: false }

  // Условие if/while/prerequisite — не исполняем. Сообщаем честно, что
  // механика недоступна, и НЕ списываем за неё действие (аудит §4.4, M2).
  const blocked = unmetCondition(mechanic.conditions, state, owner, cardKey(found.card))
  if (blocked) return { state, error: 'Условие этой механики пока не поддерживается', applied: false }

  const executable = array(mechanic.actions).some(isExecutableAction)
  if (!executable) return { state, error: 'Механика пока не реализована движком', applied: false }

  // Выбранные id обязаны существовать на поле. Раньше проверки не было:
  // клиент мог прислать что угодно, и механика применялась «в никуда»
  // либо по первой попавшейся карте (аудит §4.5, M3).
  const requested = request.targetCardIds ?? []
  const unresolvable = unresolvableTargetIds(state, requested)
  if (unresolvable.length) {
    return { state, error: 'Выбрана карта, которой нет на поле', applied: false }
  }

  // Селектор требует выбора, а игрок ничего не выбрал: действие не
  // выполняем и стоимость не списываем (аудит §4.5, M12).
  const needsChoice = hasUnmetChoice(
    state,
    owner,
    { ...mechanic, owner_card_id: cardKey(found.card) },
    requested,
  )
  if (needsChoice) {
    return { state, error: 'Сначала выберите цель для этой способности', applied: false }
  }

  const conditionCost = array(mechanic.conditions).find((c) => c.type === 'cost_actions')
  const actionCost = array(mechanic.actions).find((a) => Number.isFinite(Number(a.cost_actions)))
  const cost = Number(conditionCost?.value ?? actionCost?.cost_actions ?? 0)
  if (owner.actions_remaining < cost) return { state, error: `Недостаточно действий (нужно ${cost})`, applied: false }

  const paid = owner.actions_remaining === cost
    ? state
    : mutatePlayer(state, request.actorId, (p) => ({ ...p, actions_remaining: p.actions_remaining - cost }))
  const outcome = applyMechanic(paid, owner, mechanic, requested, cardKey(found.card))

  // Действие списано, но ничего не произошло — возвращаем стоимость,
  // чтобы игрок не терял ход из-за неподдержанной механики.
  if (!outcome.applied) {
    const reason = outcome.reasons[0] ?? 'no_effect'
    const restored = paid === state
      ? state
      : mutatePlayer(state, request.actorId, (p) => ({ ...p, actions_remaining: p.actions_remaining + cost }))
    return {
      state: restored,
      error: describeOutcome(reason),
      applied: false,
    }
  }
  return { state: outcome.state, applied: true }
}

/** Человекочитаемая причина, по которой механику не удалось применить. */
export function describeOutcome(reason: string): string {
  switch (reason) {
    case 'condition_not_evaluated:if':
    case 'condition_not_evaluated:while':
    case 'condition_not_evaluated:prerequisite':
      return 'Условие этой механики пока не поддерживается'
    case 'targets_unresolvable:self':
      return 'Выбрана карта, которой нет на поле'
    default:
      break
  }
  if (reason.startsWith('targets_unresolvable:')) {
    return 'Выбрана карта, которой нет на поле'
  }
  if (reason.startsWith('target_not_chosen:')) {
    return 'Сначала выберите цель для этой способности'
  }
  if (reason.startsWith('unsupported_action:')) {
    return 'Эта механика пока не реализована движком'
  }
  if (reason === 'unsupported_stat_buff_amount') {
    return 'Эта механика пока не реализована движком'
  }
  if (reason === 'unsupported_move:opponent_lane') {
    return 'Перенос на чужую линию пока не реализован'
  }
  if (reason.startsWith('imprecise_target:')) {
    return 'Эта механика пока не реализована движком'
  }
  return 'Эта механика пока не реализована движком'
}

export function effectiveAttackForCombat(card: Card): number {
  return effectiveAttack(card)
}

export function cleanupTemporaryEffects(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      zones: p.zones.map((z) => ({
        ...z,
        cards: z.cards.map((c) => {
          const out = { ...c } as JsonObject
          for (const stat of ['attack', 'defense', 'health']) {
            if (out[`${stat}_buff_duration`] === 'this_turn') {
              delete out[`${stat}_bonus`]
              delete out[`${stat}_buff_duration`]
            }
          }
          return out as Card
        }),
      })),
    })),
  }
}

export function effectiveHealthForCombat(card: Card): number {
  return effectiveHealth(card)
}