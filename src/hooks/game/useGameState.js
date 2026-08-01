/**
 * useGameState — низкоуровневый writeGameState.
 *
 * Обновляет `games` через Supabase с optimistic lock по `version`.
 * Если версия конфликтует — вызывает `reload()` чтобы перечитать свежий state.
 *
 * Используется как база для usePlayCard, useAttack, useTurnControl.
 * Сам по себе не выполняет игровых действий — только "атомарное обновление".
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'

export function useGameState(game, reload) {
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState(null)

  // Ref на game: нужен чтобы retry внутри useCallback видел СВЕЖИЙ state
  // (closure обновляется только при ре-рендере, а мы внутри callback'а).
  const gameRef = useRef(game)
  useEffect(() => {
    gameRef.current = game
  }, [game])

  /**
   * writeGameState с оптимистичной блокировкой + retry.
   * Если version конфликтует (между двумя игроками), перечитываем state
   * через reload() и повторяем попытку до MAX_RETRIES раз.
   */
  const writeGameState = useCallback(
    async (patch) => {
      if (!game?.id) {
        const e = 'Игра не загружена'
        setError(e)
        return { error: e }
      }
      await ensureGuestId()
      setIsApplying(true)
      setError(null)

      const MAX_RETRIES = 2

      try {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          // Берём всегда АКТУАЛЬНЫЙ game из ref (обновляется useEffect'ом)
          const currentGame = gameRef.current || game
          if (!currentGame?.id) {
            throw new Error('Игра не загружена')
          }

          const expectedVersion = currentGame.version
          const next = {
            ...currentGame,
            ...patch,
            game_state: { ...(currentGame.game_state || {}), ...(patch.game_state || {}) },
            version: expectedVersion + 1,
            updated_at: new Date().toISOString(),
          }

          const { data, error: updateErr } = await supabase
            .from('games')
            .update({
              game_state: next.game_state,
              current_turn: next.current_turn,
              current_player_id: next.current_player_id,
              status: next.status,
              winner_id: next.winner_id,
              ended_at: next.ended_at,
              version: next.version,
              updated_at: next.updated_at,
            })
            .eq('id', currentGame.id)
            .eq('version', expectedVersion)
            .select('version')
            .maybeSingle()

          if (updateErr) {
            // Реальная ошибка БД — не retry-им
            throw new Error(updateErr.message)
          }

          if (data) {
            // Успех! Перечитываем state чтобы frontend получил свежие данные
            if (reload) await reload()
            return { success: true, version: data.version }
          }

          // data === null → version conflict
          console.warn(`[writeGameState] version conflict (attempt ${attempt}/${MAX_RETRIES})`)
          if (reload) {
            const freshGame = await reload()
            if (freshGame?.id) {
              gameRef.current = freshGame
            }
          }
          // 100мс чтобы новый state точно пришёл в ref/react-state, если reload
          // не возвращает объект (старые call-sites).
          await new Promise((r) => setTimeout(r, 100))
        }

        throw new Error('Конфликт версий — состояние не синхронизировано. Перечитайте игру.')
      } catch (err) {
        const msg = err?.message || 'Не удалось обновить игру'
        setError(msg)
        return { error: msg }
      } finally {
        setIsApplying(false)
      }
    },
    [game, reload]
  )

  return { writeGameState, isApplying, error, setError }
}