/**
 * useLobbyRealtime — Хук для управления Realtime подписками лобби.
 * 
 * Подписывается на изменения в lobby_players и lobbies.
 */

import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../../utils/supabase.js';
import { clearLobbySession } from './useLobbySession';

/**
 * Хук для подписки на изменения в лобби
 * @param {string|null} lobbyId - ID лобби для подписки
 * @param {Function} onPlayersUpdate - Колбэк при изменении игроков
 * @param {Function} onLobbyUpdate - Колбэк при изменении лобби
 * @param {Function} onLobbyDeleted - Колбэк при удалении лобби
 * @returns {Object} Методы управления подпиской
 */
export function useLobbyRealtime(lobbyId, onPlayersUpdate, onLobbyUpdate, onLobbyDeleted) {
  const channelRef = useRef(null);

  /**
   * Подписаться на изменения в лобби
   */
  const subscribeToLobby = useCallback((id) => {
    // Отписаться от предыдущего канала
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    if (!id) return;

    const channel = supabase
      .channel(`lobby_room:${id}`)
      
      // Изменения в игроках лобби
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'lobby_players', 
          filter: `lobby_id=eq.${id}` 
        },
        async () => {
          const { data } = await supabase
            .from('lobby_players')
            .select('*')
            .eq('lobby_id', id);
          onPlayersUpdate(data ?? []);
        }
      )
      
      // Изменения в статусе лобби
      .on(
        'postgres_changes',
        { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'lobbies', 
          filter: `id=eq.${id}` 
        },
        ({ new: updated }) => {
          if (updated?.status) {
            onLobbyUpdate(updated.status);
          }
        }
      )
      
      // Удаление лобби (хост закрыл лобби)
      .on(
        'postgres_changes',
        { 
          event: 'DELETE', 
          schema: 'public', 
          table: 'lobbies', 
          filter: `id=eq.${id}` 
        },
        () => {
          // Очистить сессию
          clearLobbySession();
          
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
          }
          
          // Уведомить о закрытии лобби
          onLobbyDeleted();
        }
      )
      .subscribe();

    channelRef.current = channel;
    return channel;
  }, [onPlayersUpdate, onLobbyUpdate, onLobbyDeleted]);

  /**
   * Отписаться от текущего канала
   */
  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  // Автоматически отписываться при размонтировании
  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  // Автоматически подписываться при изменении lobbyId
  useEffect(() => {
    if (lobbyId) {
      subscribeToLobby(lobbyId);
    } else {
      unsubscribe();
    }
  }, [lobbyId, subscribeToLobby, unsubscribe]);

  return {
    subscribeToLobby,
    unsubscribe,
  };
}

export default useLobbyRealtime;
