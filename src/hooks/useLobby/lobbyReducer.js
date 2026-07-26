/**
 * lobbyReducer — Reducer для управления состоянием лобби.
 * 
 * Состояния:
 *   - 'idle'        — без активного лобби
 *   - 'restoring'   — восстанавливаем сессию из localStorage
 *   - 'loading'     — загружаем (создание/вход в лобби)
 *   - 'waiting'     — в лобби, ожидаем других игроков
 *   - 'in_game'     — игра началась
 *   - 'error'       — ошибка
 *   - 'dismissed'   — лобби закрыто хостом
 */

/**
 * Начальное состояние
 */
export const initialState = {
  status: 'restoring',
  lobbyId: null,
  lobbyCode: null,
  players: [],
  error: null,
  isHost: false,
  hostId: null,
  dismissedMessage: null,
};

/**
 * Экшны для reducer
 */
export const LobbyActions = {
  // Состояние
  SET_STATUS: 'SET_STATUS',
  SET_LOBBY: 'SET_LOBBY',
  SET_PLAYERS: 'SET_PLAYERS',
  SET_ERROR: 'SET_ERROR',
  SET_HOST: 'SET_HOST',
  SET_DISMISSED_MESSAGE: 'SET_DISMISSED_MESSAGE',
  
  // Сброс
  RESET: 'RESET',
  
  // Обновление игрока (ready status)
  UPDATE_PLAYER: 'UPDATE_PLAYER',
};

/**
 * Reducer для управления состоянием лобби
 * @param {Object} state - Текущее состояние
 * @param {Object} action - Экшен
 * @returns {Object} Новое состояние
 */
export function lobbyReducer(state, action) {
  switch (action.type) {
    case LobbyActions.SET_STATUS:
      return { ...state, status: action.payload };
    
    case LobbyActions.SET_LOBBY:
      return {
        ...state,
        lobbyId: action.lobbyId,
        lobbyCode: action.lobbyCode,
        status: action.status || state.status,
      };
    
    case LobbyActions.SET_PLAYERS:
      return { ...state, players: action.players };
    
    case LobbyActions.SET_ERROR:
      return { ...state, error: action.error };
    
    case LobbyActions.SET_HOST:
      return {
        ...state,
        isHost: action.isHost,
        hostId: action.hostId,
      };
    
    case LobbyActions.SET_DISMISSED_MESSAGE:
      return { ...state, dismissedMessage: action.message };
    
    case LobbyActions.UPDATE_PLAYER:
      return {
        ...state,
        players: state.players.map(player =>
          player.player_id === action.playerId
            ? { ...player, ...action.updates }
            : player
        ),
      };
    
    case LobbyActions.RESET:
      return initialState;
    
    default:
      return state;
  }
}

/**
 * Action creators для удобства
 */
export const setStatus = (status) => ({ type: LobbyActions.SET_STATUS, payload: status });
export const setLobby = (lobbyId, lobbyCode, status) => ({ type: LobbyActions.SET_LOBBY, lobbyId, lobbyCode, status });
export const setPlayers = (players) => ({ type: LobbyActions.SET_PLAYERS, players });
export const setError = (error) => ({ type: LobbyActions.SET_ERROR, error });
export const setHost = (isHost, hostId) => ({ type: LobbyActions.SET_HOST, isHost, hostId });
export const setDismissedMessage = (message) => ({ type: LobbyActions.SET_DISMISSED_MESSAGE, message });
export const updatePlayer = (playerId, updates) => ({ type: LobbyActions.UPDATE_PLAYER, playerId, updates });
export const resetLobby = () => ({ type: LobbyActions.RESET });
