/**
 * useLobbyState — Основной хук для управления состоянием лобби.
 * 
 * Объединяет reducer, сессию, realtime и экшены.
 */

import { useEffect, useReducer, useCallback } from 'react';
import { lobbyReducer, initialState, setStatus, setLobby, setPlayers, setError, setHost, setDismissedMessage } from './lobbyReducer';
import { useLobbySession } from './useLobbySession';
import { useLobbyRealtime } from './useLobbyRealtime';
import { useLobbyActions } from './useLobbyActions';
import { ensureGuestId } from '../../utils/guestSession.js';
import { supabase } from '../../utils/supabase.js';
import { getGuestId } from '../../utils/guestId.js';

/**
 * Основной хук для управления лобби
 * @returns {Object} Состояние и экшены лобби
 */
export function useLobbyState() {
  // Reducer для состояния
  const [state, dispatch] = useReducer(lobbyReducer, initialState);

  // Работа с сессией
  const { session, saveSession, clearSession } = useLobbySession();

  // Установить ошибку (обертка для dispatch)
  const setErrorState = useCallback((error) => {
    dispatch(setError(error));
  }, []);

  // Экшены лобби
  const { createLobby, joinLobby, setReady, leaveLobby, cleanupOldLobbies } = useLobbyActions(
    dispatch,
    setErrorState,
    saveSession,
    clearSession
  );

  // Realtime подписки
  const { subscribeToLobby } = useLobbyRealtime(
    state.lobbyId,
    useCallback((players) => {
      dispatch(setPlayers(players));
    }, []),
    useCallback((status) => {
      dispatch(setStatus(status));
    }, []),
    useCallback(() => {
      dispatch(setDismissedMessage('Хост закрыл лобби'));
      dispatch(setStatus('idle'));
    }, [])
  );

  // Восстановить лобби из сессии при монтировании
  useEffect(() => {
    const restoreLobby = async () => {
      // Фаза 6: RLS — установить guest_id в Postgres-сеанс при старте
      await ensureGuestId();

      const sessionData = session;
      if (!sessionData) {
        dispatch(setStatus('idle'));
        return;
      }

      const guestId = getGuestId();

      try {
        // Проверить, существует ли лобби
        const { data: lobby } = await supabase
          .from('lobbies')
          .select('*')
          .eq('id', sessionData.lobbyId)
          .maybeSingle();

        if (!lobby) {
          clearSession();
          dispatch(setStatus('idle'));
          return;
        }

        // Если игра уже началась, не восстанавливать
        if (lobby.status === 'in_game') {
          clearSession();
          dispatch(setStatus('idle'));
          return;
        }

        // Проверить, что игрок всё ещё в лобби
        const { data: me } = await supabase
          .from('lobby_players')
          .select('player_id')
          .eq('lobby_id', lobby.id)
          .eq('player_id', guestId)
          .maybeSingle();

        if (!me) {
          clearSession();
          dispatch(setStatus('idle'));
          return;
        }

        // Загрузить список игроков
        const { data: playersList } = await supabase
          .from('lobby_players')
          .select('*')
          .eq('lobby_id', lobby.id);

        // Восстановить состояние
        dispatch(setLobby(lobby.id, lobby.code));
        dispatch(setPlayers(playersList ?? []));
        dispatch(setHost(lobby.host_id === guestId, lobby.host_id));
        dispatch(setStatus('waiting'));

        // Подписаться на изменения
        subscribeToLobby(lobby.id);
      } catch (err) {
        console.error('Error restoring lobby session:', err);
        clearSession();
        dispatch(setStatus('idle'));
      }
    };

    restoreLobby();
  }, [session, dispatch, clearSession, subscribeToLobby]);

  // Удалить игрока при закрытии вкладки
  useEffect(() => {
    const handleUnload = () => {
      clearSession();
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [clearSession]);

  // Возвращаем состояние и экшены
  return {
    // Состояние
    status: state.status,
    lobbyId: state.lobbyId,
    lobbyCode: state.lobbyCode,
    players: state.players,
    error: state.error,
    isHost: state.isHost,
    hostId: state.hostId,
    dismissedMessage: state.dismissedMessage,
    
    // Экшены
    createLobby,
    joinLobby,
    setReady: useCallback((lobbyId) => setReady(lobbyId), [setReady]),
    leaveLobby: useCallback((lobbyId) => leaveLobby(lobbyId), [leaveLobby]),
    
    // Утилиты
    cleanupOldLobbies,
  };
}

export default useLobbyState;
