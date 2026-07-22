/**
 * useGameRealtimeSync
 * Manages real-time game state synchronization via Supabase Realtime
 */
import { useEffect, useRef, useCallback } from 'react'
import { supabase } from '../utils/supabase'

export function useGameRealtimeSync(gameId, playerId, onGameStateUpdate) {
  const subscriptionRef = useRef(null)

  // Subscribe to game state changes
  useEffect(() => {
    if (!gameId || !playerId) return

    // Subscribe to game_players table for state updates
    subscriptionRef.current = supabase
      .channel(`game:${gameId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_players',
          filter: `game_id=eq.${gameId}`,
        },
        payload => {
          if (payload.eventType === 'UPDATE') {
            onGameStateUpdate?.(payload.new)
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${gameId}`,
        },
        payload => {
          onGameStateUpdate?.(payload.new)
        },
      )
      .subscribe((status, err) => {
        if (err) console.error('Realtime subscription error:', err)
        console.log('Realtime status:', status)
      })

    return () => {
      subscriptionRef.current?.unsubscribe()
    }
  }, [gameId, playerId, onGameStateUpdate])

  const updateGameState = useCallback(
    async updates => {
      try {
        const { error } = await supabase
          .from('game_players')
          .update(updates)
          .eq('game_id', gameId)
          .eq('player_id', playerId)

        if (error) throw error
      } catch (err) {
        console.error('Failed to update game state:', err)
        throw err
      }
    },
    [gameId, playerId],
  )

  return { updateGameState }
}

export default useGameRealtimeSync
