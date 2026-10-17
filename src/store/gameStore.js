/**
 * gameStore.js — единый источник правды для game state.
 *
 * Принципы:
 * 1. serverVersion — единственный авторитет для game state.
 * 2. WS push и RPC ответы идут через applyServerState() → stabilizeGameState() → setState.
 * 3. Оптимистичные патчи применяются ТОЛЬКО после подтверждения сервера (по requestId).
 *    Если сервер не подтвердил в течение таймаута — патч откатывается.
 * 4. Dedup по instanceId внутри stabilizeGameState — защита от "карт-призраков"
 *    когда WS push и локальный optimistic reload временно дают два вхождения.
 */
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { stabilizeGameState, dedupCardsById } from '../utils/stabilizeGameState.js'

const DEFAULT_OPTIMISTIC_TIMEOUT_MS = 8_000

let __optimisticSeq = 0
function nextRequestId() {
  __optimisticSeq += 1
  return `opt-${__optimisticSeq}`
}

export const useGameStore = create(
  subscribeWithSelector((set, get) => ({
    game: null,
    serverVersion: 0,
    pendingActions: new Map(), // requestId -> { patcher, ts }
    isApplying: false,
    error: null,

    /**
     * Применить серверное состояние. Единственная точка входа для
     * server-authoritative данных (WS push, RPC response).
     * Stale versions игнорируются.
     *
     * Важно: если состояние не изменилось (стабилизировано к prev),
     * мы НЕ вызываем setState — это убирает лишний re-render и
     * перезагрузку 3D-мешей.
     */
    applyServerState: (rawState, source = 'server') => {
      if (!rawState) return false

      const incomingVersion = Number(rawState.version ?? 0)
      const currentVersion = get().serverVersion
      if (incomingVersion < currentVersion && currentVersion > 0) {
        return false
      }

      const prev = get().game
      const stabilized = prev ? stabilizeGameState(prev, rawState) : rawState

      // Финальная защита от ghost-cards: дедуп hand/deck/discard.
      // dedupCardsById возвращает prev ссылку если дубликатов не было —
      // это сохраняет reference stability для React.
      let finalState = stabilized
      if (finalState && Array.isArray(finalState.players)) {
        let playersChanged = false
        const players = finalState.players.map((p) => {
          const hand = dedupCardsById(p.hand)
          const deck = dedupCardsById(p.deck_pile)
          const discard = dedupCardsById(p.discard_pile)
          if (hand !== p.hand || deck !== p.deck_pile || discard !== p.discard_pile) {
            playersChanged = true
            return { ...p, hand, deck_pile: deck, discard_pile: discard }
          }
          return p
        })
        if (playersChanged) {
          finalState = { ...finalState, players }
        }
      }

      set((s) => {
        // Быстрая проверка: если ничего не изменилось — не вызываем setState
        if (finalState === s.game && s.serverVersion === incomingVersion && s.error === null) {
          // Но всё равно чистим pendingActions если нужно
          if (s.pendingActions.size === 0) return s
        }

        const pendingActions = new Map(s.pendingActions)
        // Если сервер прислал более новую версию, чем та, при которой
        // мы выпустили запрос — считаем оптимистичный патч подтверждённым.
        // (Сервер не возвращает requestId, поэтому чистим по эвристике.)
        let pendingChanged = false
        if (pendingActions.size > 0) {
          for (const [id, entry] of pendingActions) {
            // Optimistic patches may already have advanced the local version.
            // A server snapshot at or beyond that version is authoritative,
            // even when both versions are equal.
            if (incomingVersion >= (entry.optimisticVersion ?? entry.serverVersionAtIssue + 1)) {
              if (entry.timeoutId && typeof window !== 'undefined') {
                window.clearTimeout(entry.timeoutId)
              }
              pendingActions.delete(id)
              pendingChanged = true
            }
          }
        }

        // === КРИТИЧНО: не вызывать setState если ничего не изменилось ===
        // Это предотвращает перезагрузку 3D-мешей при дублирующих WS-push'ах.
        const gameChanged = finalState !== s.game
        const versionChanged = s.serverVersion !== incomingVersion
        const errorChanged = s.error !== null

        if (!gameChanged && !versionChanged && !pendingChanged && !errorChanged) {
          return s // no-op, избегаем лишнего re-render
        }

        return {
          game: finalState,
          serverVersion: incomingVersion,
          pendingActions: pendingChanged ? pendingActions : s.pendingActions,
          isApplying: pendingActions.size > 0,
          error: null,
          _lastSource: source,
        }
      })

      return true
    },

    /**
     * Применить оптимистичный патч. Сохраняется по requestId.
     * Если сервер не подтвердит в течение таймаута — будет откачен.
     */
    beginOptimistic: (requestId, patcher, opts = {}) => {
      if (!requestId || typeof patcher !== 'function') return requestId
      const { timeoutMs = DEFAULT_OPTIMISTIC_TIMEOUT_MS } = opts
      const serverVersionAtIssue = get().serverVersion

      set((s) => {
        const next = patcher(s.game)
        if (!next || next === s.game) return s

        const pendingActions = new Map(s.pendingActions)
        pendingActions.set(requestId, {
          patcher,
          base: s.game,
          ts: Date.now(),
          serverVersionAtIssue,
          optimisticVersion: Number(next.version ?? serverVersionAtIssue),
          timeoutId: null,
        })

        // Планируем автоматический rollback по таймауту
        const entry = pendingActions.get(requestId)
        if (typeof window !== 'undefined') {
          entry.timeoutId = window.setTimeout(() => {
            get().rollbackOptimistic(requestId, 'timeout')
          }, timeoutMs)
        }

        return {
          game: next,
          pendingActions,
          isApplying: true,
        }
      })

      return requestId
    },

    /**
     * applyOptimistic — упрощённый API: генерирует requestId внутри,
     * принимает только patcher. Возвращает requestId (для отладки/тестов).
     */
    applyOptimistic: (patcher, opts = {}) => {
      const id = nextRequestId()
      get().beginOptimistic(id, patcher, opts)
      return id
    },

    /**
     * Откатить оптимистичный патч. Вызывается по таймауту или при ошибке RPC.
     * Если сервер уже прислал более новую версию — ничего не делаем.
     */
    rollbackOptimistic: (requestId, reason = 'manual') => {
      set((s) => {
        const entry = s.pendingActions.get(requestId)
        if (!entry) return s

        if (entry.timeoutId && typeof window !== 'undefined') {
          window.clearTimeout(entry.timeoutId)
        }

        const pendingActions = new Map(s.pendingActions)
        pendingActions.delete(requestId)

        // Restore the exact state observed before the optimistic patch. The
        // previous implementation only removed the pending marker, leaving
        // rejected actions visible until the next unrelated snapshot.
        const canRestore =
          s.serverVersion <= (entry.serverVersionAtIssue ?? s.serverVersion) &&
          entry.base
        return {
          game: canRestore ? entry.base : s.game,
          pendingActions,
          isApplying: pendingActions.size > 0,
          _lastRollback: { requestId, reason, at: Date.now() },
        }
      })
    },

    /**
     * Установить ошибку (например, от RPC).
     */
    setError: (message) => set({ error: message || null }),

    /**
     * Полная очистка (при смене игры / выходе).
     */
    clear: () => {
      const s = get()
      // чистим таймеры
      if (typeof window !== 'undefined') {
        for (const entry of s.pendingActions.values()) {
          if (entry.timeoutId) window.clearTimeout(entry.timeoutId)
        }
      }
      set({
        game: null,
        serverVersion: 0,
        pendingActions: new Map(),
        isApplying: false,
        error: null,
      })
    },
  })),
)

/**
 * Удобный селектор: только game.
 */
export const selectGame = (s) => s.game

/**
 * Удобный селектор: только isApplying.
 * Возвращает примитив — стабильный по значению, не вызывает re-render.
 */
export const selectIsApplying = (s) => s.isApplying

/**
 * Удобный селектор: только error.
 */
export const selectError = (s) => s.error

/**
 * Удобный селектор: serverVersion.
 */
export const selectServerVersion = (s) => s.serverVersion

/**
 * Мемоизированный селектор: текущий игрок (me).
 * Возвращает стабильную ссылку — не вызывает re-render при изменении других полей.
 */
export const selectMe = (s) => {
  const game = s.game
  const currentPlayerId = game?.current_player_id
  if (!game || !currentPlayerId) return null
  return game.players.find((p) => p.player_id === currentPlayerId) ?? null
}

/**
 * Мемоизированный селектор: все живые игроки.
 */
export const selectAlivePlayers = (s) => {
  const game = s.game
  if (!game) return []
  return game.players.filter((p) => (p.health ?? 0) > 0)
}

/**
 * Мемоизированный селектор: статус игры.
 */
export const selectGameStatus = (s) => s.game?.status ?? null

/**
 * Мемоизированный селектор: победитель.
 */
export const selectWinner = (s) => s.game?.winner_id ?? null
