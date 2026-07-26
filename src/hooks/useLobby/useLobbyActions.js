/**
 * useLobbyActions — Хук для экшенов лобби (создание, вход, выход, готовность).
 * 
 * Использует Supabase RPC для работы с лобби.
 */

import { useCallback, useRef } from 'react';
import { supabase } from '../../utils/supabase.js';
import { getGuestId } from '../../utils/guestId.js';
import { generateLobbyCode } from '../../utils/lobbyCode.js';
import { logError } from '../../utils/errorLogger.js';

/**
 * Хук для экшенов лобби
 * @param {Function} dispatch - Dispatch для reducer
 * @param {Function} setError - Функция установки ошибки
 * @param {Function} saveSession - Функция сохранения сессии
 * @param {Function} clearSession - Функция очистки сессии
 * @returns {Object} Экшены лобби
 */
export function useLobbyActions(dispatch, setError, saveSession, clearSession) {
  const guestId = getGuestId();

  /**
   * Очистить старые лобби (старше 6 часов)
   */
  const cleanupOldLobbies = useCallback(async () => {
    const cutoff = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    await supabase.from('lobbies').delete().lt('created_at', cutoff);
  }, []);

  /**
   * Создать новое лобби
   * @param {string} nickname - Nikname игрока
   * @param {Object|null} deckPayload - Данные колоды
   * @returns {Promise<string|null>} Код лобби или null при ошибке
   */
  const createLobby = useCallback(
    async (nickname, deckPayload = null) => {
      dispatch({ type: 'SET_STATUS', payload: 'loading' });
      setError(null);
      clearSession();

      await cleanupOldLobbies();

      // Генерировать уникальный код
      let code = generateLobbyCode();
      for (let i = 0; i < 4; i++) {
        const { data: existing } = await supabase
          .from('lobbies')
          .select('id')
          .eq('code', code)
          .maybeSingle();
        
        if (!existing) break;
        code = generateLobbyCode();
      }

      // Создать лобби
      const { data: lobby, error: lobbyErr } = await supabase
        .from('lobbies')
        .insert({ code, host_id: guestId })
        .select()
        .single();

      if (lobbyErr) {
        setError('Не удалось создать лобби');
        dispatch({ type: 'SET_STATUS', payload: 'error' });
        return null;
      }

      // Добавить игрока через RPC
      const { data: player, error: playerErr } = await supabase.rpc('upsert_lobby_player', {
        p_guest_id: guestId,
        p_lobby_id: lobby.id,
        p_nickname: nickname.trim() || 'Игрок',
        p_ready: false,
        p_deck: deckPayload,
      });

      if (playerErr || !player) {
        logError(playerErr || new Error('RPC не вернул игрока'), { 
          module: 'useLobbyActions', 
          action: 'createLobby', 
          lobbyId: lobby?.id 
        });
        setError(`Не удалось добавить игрока: ${playerErr?.message || 'RPC не вернул игрока'}`);
        dispatch({ type: 'SET_STATUS', payload: 'error' });
        return null;
      }

      // Загрузить список игроков
      const { data: playersList } = await supabase
        .from('lobby_players')
        .select('*')
        .eq('lobby_id', lobby.id);

      // Обновить состояние
      dispatch({ type: 'SET_LOBBY', lobbyId: lobby.id, lobbyCode: code });
      dispatch({ type: 'SET_PLAYERS', players: playersList ?? [] });
      dispatch({ type: 'SET_HOST', isHost: true, hostId: guestId });
      dispatch({ type: 'SET_STATUS', payload: 'waiting' });

      // Сохранить сессию
      saveSession(lobby.id, code, guestId, true);

      return code;
    },
    [dispatch, setError, clearSession, saveSession, cleanupOldLobbies, guestId]
  );

  /**
   * Присоединиться к лобби
   * @param {string} code - Код лобби
   * @param {string} nickname - Nikname игрока
   * @param {Object|null} deckPayload - Данные колоды
   */
  const joinLobby = useCallback(
    async (code, nickname, deckPayload = null) => {
      dispatch({ type: 'SET_STATUS', payload: 'loading' });
      setError(null);
      clearSession();

      // Найти лобби по коду
      const { data: lobby, error: findErr } = await supabase
        .from('lobbies')
        .select('*')
        .eq('code', code.trim().toUpperCase())
        .maybeSingle();

      if (findErr || !lobby) {
        setError('Лобби с таким кодом не найдено');
        dispatch({ type: 'SET_STATUS', payload: 'error' });
        return;
      }

      if (lobby.status === 'in_game') {
        setError('Игра уже началась');
        dispatch({ type: 'SET_STATUS', payload: 'error' });
        return;
      }

      // Проверить, есть ли уже игрок в этом лобби
      const { data: existing } = await supabase
        .from('lobby_players')
        .select('player_id')
        .eq('lobby_id', lobby.id)
        .eq('player_id', guestId)
        .maybeSingle();

      if (existing) {
        // Обновить существующего игрока
        await supabase.rpc('upsert_lobby_player', {
          p_guest_id: guestId,
          p_lobby_id: lobby.id,
          p_nickname: nickname.trim() || 'Игрок',
          p_ready: false,
          p_deck: deckPayload,
        });
      } else {
        // Проверить количество игроков
        const { data: allPlayers } = await supabase
          .from('lobby_players')
          .select('player_id')
          .eq('lobby_id', lobby.id);

        if ((allPlayers ?? []).length >= 4) {
          setError('Лобби уже заполнено (максимум 4 игрока)');
          dispatch({ type: 'SET_STATUS', payload: 'error' });
          return;
        }

        // Добавить нового игрока
        const { data: player, error: joinErr } = await supabase.rpc('upsert_lobby_player', {
          p_guest_id: guestId,
          p_lobby_id: lobby.id,
          p_nickname: nickname.trim() || 'Игрок',
          p_ready: false,
          p_deck: deckPayload,
        });

        if (joinErr || !player) {
          logError(joinErr || new Error('RPC не вернул игрока'), { 
            module: 'useLobbyActions', 
            action: 'joinLobby', 
            lobbyId: lobby.id 
          });
          setError(`Не удалось войти в лобби: ${joinErr?.message || 'RPC не вернул игрока'}`);
          dispatch({ type: 'SET_STATUS', payload: 'error' });
          return;
        }
      }

      // Загрузить список игроков
      const { data: playersList } = await supabase
        .from('lobby_players')
        .select('*')
        .eq('lobby_id', lobby.id);

      // Обновить состояние
      const isHost = lobby.host_id === guestId;
      dispatch({ type: 'SET_LOBBY', lobbyId: lobby.id, lobbyCode: lobby.code });
      dispatch({ type: 'SET_PLAYERS', players: playersList ?? [] });
      dispatch({ type: 'SET_HOST', isHost, hostId: lobby.host_id });
      dispatch({ type: 'SET_STATUS', payload: lobby.status === 'waiting' ? 'waiting' : lobby.status });

      // Сохранить сессию
      saveSession(lobby.id, lobby.code, lobby.host_id, isHost);
    },
    [dispatch, setError, clearSession, saveSession, guestId]
  );

  /**
   * Отметить игрока как готового
   */
  const setReady = useCallback(
    async (lobbyId) => {
      if (!lobbyId) return;

      const { data, error: readyErr } = await supabase.rpc('set_lobby_player_ready', {
        p_guest_id: guestId,
        p_lobby_id: lobbyId,
        p_ready: true,
      });

      if (readyErr) {
        setError(`Не удалось отметить готовность: ${readyErr.message}`);
        return;
      }

      // Обновить локальное состояние игрока
      dispatch({ 
        type: 'UPDATE_PLAYER', 
        playerId: guestId, 
        updates: { ready: true, ...(data || {}) } 
      });
    },
    [dispatch, setError, guestId]
  );

  /**
   * Покинуть лобби
   */
  const leaveLobby = useCallback(
    async (lobbyId) => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      if (lobbyId) {
        // Удалить игрока из лобби
        await supabase
          .from('lobby_players')
          .delete()
          .eq('lobby_id', lobbyId)
          .eq('player_id', guestId);

        // Если я хост — удалить лобби
        // (Это делается через RLS триггер или нужно проверять isHost)
        // Пока оставим как в оригинале
      }

      // Сбросить состояние
      clearSession();
      dispatch({ type: 'RESET' });
    },
    [clearSession, dispatch, guestId]
  );

  // Ref для канала (используется в leaveLobby)
  const channelRef = useRef(null);

  return {
    createLobby,
    joinLobby,
    setReady,
    leaveLobby,
    cleanupOldLobbies,
  };
}

export default useLobbyActions;
