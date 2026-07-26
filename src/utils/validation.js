/**
 * validation.js — Утилиты для валидации данных от сервера
 * 
 * Содержит функции для проверки структуры и значений данных,
 * полученных от Supabase.
 */

import { DECK_LIMITS, STARTING_HAND_SIZE } from '../constants/game.js';

/**
 * Валидация структуры игры
 * @param {Object} game - Данные игры
 * @throws {Error} Если структура невалидна
 */
export function validateGame(game) {
  if (!game) {
    throw new Error('Game is null or undefined');
  }

  if (typeof game.id !== 'string' || game.id.length === 0) {
    throw new Error('Invalid game: missing or invalid id');
  }

  const validStatuses = ['setup', 'active', 'finished'];
  if (!validStatuses.includes(game.status)) {
    throw new Error(`Invalid game status: ${game.status}. Must be one of: ${validStatuses.join(', ')}`);
  }

  if (game.version === undefined || typeof game.version !== 'number' || game.version < 1) {
    throw new Error(`Invalid game version: ${game.version}. Must be a number >= 1`);
  }

  if (game.players === undefined || !Array.isArray(game.players)) {
    throw new Error('Invalid game: players must be an array');
  }

  if (game.players.length < 2) {
    throw new Error(`Invalid game: must have at least 2 players, got ${game.players.length}`);
  }

  if (game.current_turn !== undefined && (typeof game.current_turn !== 'number' || game.current_turn < 0)) {
    throw new Error(`Invalid current_turn: ${game.current_turn}. Must be a number >= 0`);
  }

  if (game.current_player_id !== undefined && typeof game.current_player_id !== 'string') {
    throw new Error(`Invalid current_player_id: must be a string`);
  }

  if (game.game_state !== undefined && (typeof game.game_state !== 'object' || game.game_state === null)) {
    throw new Error('Invalid game_state: must be an object');
  }

  return true;
}

/**
 * Валидация игрока
 * @param {Object} player - Данные игрока
 * @param {boolean} isSelf - Является ли текущим игроком
 * @throws {Error} Если структура невалидна
 */
export function validatePlayer(player) {
  if (!player) {
    throw new Error('Player is null or undefined');
  }

  if (typeof player.player_id !== 'string' || player.player_id.length === 0) {
    throw new Error('Invalid player: missing or invalid player_id');
  }

  if (player.nickname !== undefined && typeof player.nickname !== 'string') {
    throw new Error('Invalid player: nickname must be a string');
  }

  // Валидация здоровья
  if (player.health !== undefined) {
    if (typeof player.health !== 'number') {
      throw new Error(`Invalid health: must be a number, got ${typeof player.health}`);
    }
    if (player.health < 0 || player.health > 25) {
      throw new Error(`Invalid health value: ${player.health}. Must be between 0 and 25`);
    }
  }

  // Валидация руки
  if (player.hand !== undefined) {
    if (!Array.isArray(player.hand)) {
      throw new Error('Invalid hand: must be an array');
    }
    if (player.hand.length > STARTING_HAND_SIZE) {
      throw new Error(`Invalid hand length: ${player.hand.length}. Must be <= ${STARTING_HAND_SIZE}`);
    }
    
    // Валидация каждой карты в руке
    player.hand.forEach((card, index) => {
      validateCard(card, `hand[${index}]`);
    });
  }

  // Валидация deck_pile
  if (player.deck_pile !== undefined) {
    if (!Array.isArray(player.deck_pile)) {
      throw new Error('Invalid deck_pile: must be an array');
    }
    
    player.deck_pile.forEach((card, index) => {
      validateCard(card, `deck_pile[${index}]`);
    });
  }

  // Валидация deck_remaining
  if (player.deck_remaining !== undefined) {
    if (typeof player.deck_remaining !== 'number' || player.deck_remaining < 0) {
      throw new Error(`Invalid deck_remaining: ${player.deck_remaining}. Must be a number >= 0`);
    }
    
    // Проверка соответствия с deck_pile
    if (player.deck_pile !== undefined && player.deck_pile.length !== player.deck_remaining) {
      throw new Error(`deck_pile length (${player.deck_pile.length}) doesn't match deck_remaining (${player.deck_remaining})`);
    }
  }

  // Валидация зон
  if (player.zones !== undefined) {
    if (!Array.isArray(player.zones)) {
      throw new Error('Invalid zones: must be an array');
    }
    
    if (player.zones.length > 4) {
      throw new Error(`Invalid zones length: ${player.zones.length}. Must be <= 4`);
    }
    
    player.zones.forEach((zone, index) => {
      if (!Array.isArray(zone)) {
        throw new Error(`Invalid zone at index ${index}: must be an array`);
      }
      if (zone.length > 10) {
        throw new Error(`Invalid zone length at index ${index}: ${zone.length}. Must be <= 10`);
      }
      
      zone.forEach((card, cardIndex) => {
        validateCard(card, `zones[${index}][${cardIndex}]`);
      });
    });
  }

  if (player.position !== undefined && typeof player.position !== 'string') {
    throw new Error('Invalid position: must be a string');
  }

  if (player.player_order !== undefined && (typeof player.player_order !== 'number' || player.player_order < 1)) {
    throw new Error(`Invalid player_order: ${player.player_order}. Must be a number >= 1`);
  }

  return true;
}

/**
 * Валидация карты
 * @param {Object} card - Данные карты
 * @param {string} path - Путь к карте (для ошибок)
 * @throws {Error} Если структура невалидна
 */
export function validateCard(card, path = 'card') {
  if (!card) {
    throw new Error(`${path}: is null or undefined`);
  }

  if (typeof card !== 'object') {
    throw new Error(`${path}: must be an object, got ${typeof card}`);
  }

  if (card.id !== undefined && typeof card.id !== 'string') {
    throw new Error(`${path}.id: must be a string`);
  }

  if (card.name !== undefined && typeof card.name !== 'string') {
    throw new Error(`${path}.name: must be a string`);
  }

  if (card.card_type !== undefined && !['creature', 'building', 'spell'].includes(card.card_type)) {
    throw new Error(`${path}.card_type: invalid value "${card.card_type}". Must be one of: creature, building, spell`);
  }

  if (card.cost !== undefined && (typeof card.cost !== 'number' || card.cost < 0)) {
    throw new Error(`${path}.cost: must be a number >= 0, got ${card.cost}`);
  }

  if (card.attack !== undefined && (typeof card.attack !== 'number' || card.attack < 0)) {
    throw new Error(`${path}.attack: must be a number >= 0, got ${card.attack}`);
  }

  if (card.health !== undefined && (typeof card.health !== 'number' || card.health < 0)) {
    throw new Error(`${path}.health: must be a number >= 0, got ${card.health}`);
  }

  return true;
}

/**
 * Валидация колоды
 * @param {Object} deck - Данные колоды
 * @param {string} path - Путь к колоде (для ошибок)
 * @throws {Error} Если структура невалидна
 */
export function validateDeck(deck, path = 'deck') {
  if (!deck) {
    throw new Error(`${path}: is null or undefined`);
  }

  if (typeof deck !== 'object') {
    throw new Error(`${path}: must be an object, got ${typeof deck}`);
  }

  // Валидация карт
  if (deck.cards !== undefined) {
    if (!Array.isArray(deck.cards)) {
      throw new Error(`${path}.cards: must be an array`);
    }
    
    if (deck.cards.length > DECK_LIMITS.cards.maxTotal) {
      throw new Error(`${path}.cards: length ${deck.cards.length} exceeds maximum of ${DECK_LIMITS.cards.maxTotal}`);
    }
    
    // Проверка лимита на одну карту
    const cardCounts = {};
    deck.cards.forEach((card, index) => {
      validateCard(card, `${path}.cards[${index}]`);
      if (card.id) {
        cardCounts[card.id] = (cardCounts[card.id] || 0) + 1;
        if (cardCounts[card.id] > DECK_LIMITS.cards.maxPerEntry) {
          throw new Error(`${path}.cards: card ${card.id} appears ${cardCounts[card.id]} times, maximum is ${DECK_LIMITS.cards.maxPerEntry}`);
        }
      }
    });
  }

  // Валидация земель
  if (deck.lands !== undefined) {
    if (!Array.isArray(deck.lands)) {
      throw new Error(`${path}.lands: must be an array`);
    }
    
    if (deck.lands.length > DECK_LIMITS.lands.maxTotal) {
      throw new Error(`${path}.lands: length ${deck.lands.length} exceeds maximum of ${DECK_LIMITS.lands.maxTotal}`);
    }
    
    // Проверка лимита на одну землю
    const landCounts = {};
    deck.lands.forEach((land) => {
      if (land.id) {
        landCounts[land.id] = (landCounts[land.id] || 0) + 1;
        if (landCounts[land.id] > DECK_LIMITS.lands.maxPerEntry) {
          throw new Error(`${path}.lands: land ${land.id} appears ${landCounts[land.id]} times, maximum is ${DECK_LIMITS.lands.maxPerEntry}`);
        }
      }
    });
  }

  return true;
}

/**
 * Валидация лобби
 * @param {Object} lobby - Данные лобби
 * @throws {Error} Если структура невалидна
 */
export function validateLobby(lobby) {
  if (!lobby) {
    throw new Error('Lobby is null or undefined');
  }

  if (typeof lobby.id !== 'string' || lobby.id.length === 0) {
    throw new Error('Invalid lobby: missing or invalid id');
  }

  if (typeof lobby.code !== 'string' || lobby.code.length === 0) {
    throw new Error('Invalid lobby: missing or invalid code');
  }

  if (typeof lobby.host_id !== 'string' || lobby.host_id.length === 0) {
    throw new Error('Invalid lobby: missing or invalid host_id');
  }

  const validStatuses = ['waiting', 'in_game'];
  if (!validStatuses.includes(lobby.status)) {
    throw new Error(`Invalid lobby status: ${lobby.status}. Must be one of: ${validStatuses.join(', ')}`);
  }

  if (lobby.created_at !== undefined && isNaN(new Date(lobby.created_at).getTime())) {
    throw new Error('Invalid lobby: created_at must be a valid date string');
  }

  return true;
}

/**
 * Валидация игрока лобби
 * @param {Object} player - Данные игрока лобби
 * @throws {Error} Если структура невалидна
 */
export function validateLobbyPlayer(player) {
  if (!player) {
    throw new Error('Lobby player is null or undefined');
  }

  if (typeof player.player_id !== 'string' || player.player_id.length === 0) {
    throw new Error('Invalid lobby player: missing or invalid player_id');
  }

  if (typeof player.lobby_id !== 'string' || player.lobby_id.length === 0) {
    throw new Error('Invalid lobby player: missing or invalid lobby_id');
  }

  if (player.nickname !== undefined && typeof player.nickname !== 'string') {
    throw new Error('Invalid lobby player: nickname must be a string');
  }

  if (player.ready !== undefined && typeof player.ready !== 'boolean') {
    throw new Error('Invalid lobby player: ready must be a boolean');
  }

  if (player.deck !== undefined) {
    validateDeck(player.deck, 'lobbyPlayer.deck');
  }

  if (player.joined_at !== undefined && isNaN(new Date(player.joined_at).getTime())) {
    throw new Error('Invalid lobby player: joined_at must be a valid date string');
  }

  return true;
}

/**
 * Валидация полного состояния игры
 * @param {Object} game - Полные данные игры
 * @throws {Error} Если данные невалидны
 */
export function validateGameState(game) {
  if (!game) {
    throw new Error('Game state is null or undefined');
  }

  // Валидация базовой структуры игры
  validateGame(game);

  // Валидация всех игроков
  if (game.players && Array.isArray(game.players)) {
    game.players.forEach((player, index) => {
      try {
        validatePlayer(player);
      } catch (error) {
        const wrappedError = new Error(`Player validation failed at index ${index}: ${error.message}`);
        wrappedError.cause = error;
        throw wrappedError;
      }
    });

    // Проверка, что current_player_id указывает на существующего игрока
    if (game.current_player_id) {
      const currentPlayerExists = game.players.some(p => p.player_id === game.current_player_id);
      if (!currentPlayerExists) {
        throw new Error(`current_player_id "${game.current_player_id}" doesn't match any player in the game`);
      }
    }
  }

  // Валидация game_state
  if (game.game_state) {
    if (game.game_state.log !== undefined && !Array.isArray(game.game_state.log)) {
      throw new Error('game_state.log must be an array');
    }
  }

  return true;
}

export default {
  validateGame,
  validatePlayer,
  validateCard,
  validateDeck,
  validateLobby,
  validateLobbyPlayer,
  validateGameState,
};
