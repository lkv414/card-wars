/**
 * useLobbySession — Хук для работы с сессией лобби в localStorage.
 * 
 * Хранит информацию о текущем лобби для восстановления после перезагрузки страницы.
 */

import { useCallback, useEffect, useState } from 'react';

const LOBBY_STORAGE_KEY = 'activeLobby';
const LOBBY_MAX_AGE_HOURS = 6;

/**
 * Сохранить сессию лобби в localStorage
 * @param {string} lobbyId - ID лобби
 * @param {string} code - Код лобби
 * @param {string} hostId - ID хоста
 * @param {boolean} isHost - Является ли текущий пользователь хостом
 */
export function saveLobbySession(lobbyId, code, hostId, isHost) {
  localStorage.setItem(
    LOBBY_STORAGE_KEY,
    JSON.stringify({
      lobbyId,
      code,
      hostId,
      isHost,
      savedAt: Date.now(),
    })
  );
}

/**
 * Загрузить сессию лобби из localStorage
 * @returns {Object|null} Сессия или null если не найдена/устарела
 */
export function loadLobbySession() {
  try {
    const raw = localStorage.getItem(LOBBY_STORAGE_KEY);
    if (!raw) return null;
    
    const session = JSON.parse(raw);
    const ageHours = (Date.now() - session.savedAt) / 1000 / 3600;
    
    if (ageHours > LOBBY_MAX_AGE_HOURS) {
      clearLobbySession();
      return null;
    }
    
    return session;
  } catch {
    return null;
  }
}

/**
 * Удалить сессию лобби из localStorage
 */
export function clearLobbySession() {
  localStorage.removeItem(LOBBY_STORAGE_KEY);
}

/**
 * Хук для управления сессией лобби
 * @returns {Object} Методы работы с сессией
 */
export function useLobbySession() {
  const [session, setSession] = useState(() => loadLobbySession());

  // Обновить сессию при изменении localStorage (для синхронизации между вкладками)
  useEffect(() => {
    const handleStorageChange = () => {
      setSession(loadLobbySession());
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const saveSession = useCallback((lobbyId, code, hostId, isHost) => {
    saveLobbySession(lobbyId, code, hostId, isHost);
    setSession({ lobbyId, code, hostId, isHost, savedAt: Date.now() });
  }, []);

  const clearSession = useCallback(() => {
    clearLobbySession();
    setSession(null);
  }, []);

  const restoreSession = useCallback(() => {
    setSession(loadLobbySession());
  }, []);

  return {
    session,
    saveSession,
    clearSession,
    restoreSession,
  };
}

export default useLobbySession;
