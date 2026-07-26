/**
 * useLobby — Композитный хук для работы с лобби.
 * 
 * Экспортирует основной хук useLobbyState для обратной совместимости.
 * 
 * Пример использования:
 *   const { status, lobbyId, lobbyCode, players, error, isHost, createLobby, joinLobby, setReady, leaveLobby } = useLobby();
 */

import { useLobbyState } from './useLobbyState';

// Экспортируем все подхуки для прямого использования
export { useLobbyState } from './useLobbyState';
export { useLobbySession, saveLobbySession, loadLobbySession, clearLobbySession } from './useLobbySession';
export { useLobbyRealtime } from './useLobbyRealtime';
export { useLobbyActions } from './useLobbyActions';
export { lobbyReducer, initialState, LobbyActions } from './lobbyReducer';

/**
 * Основной хук для работы с лобби (обратная совместимость)
 * @returns {Object} Состояние и экшены лобби
 */
export function useLobby() {
  const lobbyState = useLobbyState();
  
  // Возвращаем состояние и экшены в старом формате для совместимости
  return {
    status: lobbyState.status,
    lobbyId: lobbyState.lobbyId,
    lobbyCode: lobbyState.lobbyCode,
    players: lobbyState.players,
    error: lobbyState.error,
    isHost: lobbyState.isHost,
    hostId: lobbyState.hostId,
    dismissedMessage: lobbyState.dismissedMessage,
    createLobby: lobbyState.createLobby,
    joinLobby: lobbyState.joinLobby,
    setReady: lobbyState.setReady,
    leaveLobby: lobbyState.leaveLobby,
  };
}

export default useLobby;
