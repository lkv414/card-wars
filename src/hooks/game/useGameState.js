/**
 * useGameState — низкоуровневый writeGameState.
 *
 * Обновляет `games` через Supabase с optimistic lock по `version`.
 * При конфликте — перечитывает актуальную version и делает 1 retry.
 * Если после retry всё ещё конфликт — reload() и ошибка.
 */

import { useState, useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { getGuestId } from '../../utils/guestId'

async function fetchFreshVersion(gameId) {
  try {
    const guestId = getGuestId()
    const { data } = await supabase.rpc('get_player_game_state', {
      p_game_id: gameId,
      p_player_id: guestId,
    })
    return data?.version ?? null
  } catch {
    return null
  }
}

export function useGameState(game, reload) {
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState(null)

  const writeGameState = useCallback(
    async (patch, { retries = 1 } = {}) => {
      if (!game?.id) {
        const e = 'Игра не загружена'
        setError(e)
        return { error: e }
      }
      await ensureGuestId()
      setIsApplying(true)
      setError(null)

      let expectedVersion = game.version
      let attempt = 0

      try {
        while (attempt <= retries) {
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

          if (data) {
            if (reload) await reload()
            return { success: true, version: data.version }
          }

          // version conflict or RLS blocked (0 rows)
          attempt += 1
          if (attempt > retries) break

          const fresh = await fetchFreshVersion(game.id)
          if (fresh == null || fresh === expectedVersion) {
            break
          }
          expectedVersion = fresh
        }

        if (reload) await reload()
        throw new Error('Конфликт версий — состояние перечитано')
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
