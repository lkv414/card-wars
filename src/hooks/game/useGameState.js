/**
 * useGameState — низкоуровневый writeGameState.
 *
 * Обновляет `games` через Supabase с optimistic lock по `version`.
 * Если версия конфликтует — вызывает `reload()` чтобы перечитать свежий state.
 *
 * Используется как база для usePlayCard, useAttack, useTurnControl.
 * Сам по себе не выполняет игровых действий — только "атомарное обновление".
 */

import { useState, useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'

export function useGameState(game, reload) {
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState(null)

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
      try {
        // optimistic lock: only update if version matches
        const expectedVersion = game.version
        const next = {
          ...game,
          ...patch,
          game_state: { ...(game.game_state || {}), ...(patch.game_state || {}) },
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
          .eq('id', game.id)
          .eq('version', expectedVersion)
          .select('version')
          .maybeSingle()

        if (updateErr) throw new Error(updateErr.message)
        if (!data) {
          // version conflict — reload
          if (reload) await reload()
          throw new Error('Конфликт версий — состояние перечитано')
        }

        if (reload) await reload()
        return { success: true, version: data.version }
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