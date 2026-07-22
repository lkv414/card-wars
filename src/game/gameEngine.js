/**
 * Card Wars Game Engine
 * Core game logic: turns, actions, card mechanics, combat
 */

export class GameEngine {
  constructor(player1Id, player2Id, deck1, deck2, lands1, lands2) {
    this.players = {
      [player1Id]: {
        id: player1Id,
        health: 25,
        hand: [],
        deck: [...deck1],
        discardPile: [],
        lands: lands1,
        zones: [[], [], [], []], // 4 zones (2x2 grid)
        hero: { health: 25 }, // Hero card
        frozenTokens: 0, // Special mechanic for Ice King
        actionsRemaining: 2,
        hasAttacked: false,
      },
      [player2Id]: {
        id: player2Id,
        health: 25,
        hand: [],
        deck: [...deck2],
        discardPile: [],
        lands: lands2,
        zones: [[], [], [], []], // 4 zones
        hero: { health: 25 },
        frozenTokens: 0,
        actionsRemaining: 2,
        hasAttacked: false,
      },
    }

    this.gameState = {
      status: 'setup', // setup -> active -> finished
      currentTurn: 0,
      currentPlayerId: player1Id,
      turnPhase: 'draw', // draw -> main -> attack -> end
      winner: null,
      history: [],
      log: [],
    }

    this.player1Id = player1Id
    this.player2Id = player2Id
  }

  /**
   * Initialize game: shuffle decks, draw initial hands
   */
  initialize() {
    this.shuffleDeck(this.player1Id)
    this.shuffleDeck(this.player2Id)

    // Draw 5 initial cards
    for (let i = 0; i < 5; i++) {
      this.drawCard(this.player1Id)
      this.drawCard(this.player2Id)
    }

    this.gameState.status = 'active'
    this.gameState.turnPhase = 'start'

    return {
      gameState: this.gameState,
      player1: this.getPlayerState(this.player1Id),
      player2: this.getPlayerState(this.player2Id),
    }
  }

  /**
   * Shuffle player's deck
   */
  shuffleDeck(playerId) {
    const player = this.players[playerId]
    const deck = player.deck
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]]
    }
  }

  /**
   * Draw a card from deck to hand
   */
  drawCard(playerId) {
    const player = this.players[playerId]
    if (player.deck.length === 0) return false

    const card = player.deck.shift()
    player.hand.push(card)
    return true
  }

  /**
   * Start turn: prepare cards, draw card
   */
  startTurn(playerId) {
    if (playerId !== this.gameState.currentPlayerId) {
      throw new Error('Not your turn!')
    }

    const player = this.players[playerId]

    // Prepare all cards (reset tapped state)
    player.zones.forEach(zone => {
      zone.forEach(card => {
        card.tapped = false
      })
    })

    // Reset actions
    player.actionsRemaining = 2
    player.hasAttacked = false

    // Draw one card
    this.drawCard(playerId)

    this.gameState.turnPhase = 'main'
    this.addLog(`${playerId} started turn ${this.gameState.currentTurn}`)

    return this.getPlayerState(playerId)
  }

  /**
   * Play a card from hand to zone
   * @param playerId
   * @param cardIndex - index in hand
   * @param zoneIndex - target zone (0-3)
   * @param actionCost - actions to spend (1 or 2)
   */
  playCard(playerId, cardIndex, zoneIndex, actionCost = 1) {
    if (playerId !== this.gameState.currentPlayerId) {
      throw new Error('Not your turn!')
    }

    const player = this.players[playerId]

    // Validate
    if (actionCost < 1 || actionCost > 2) throw new Error('Invalid action cost')
    if (player.actionsRemaining < actionCost) throw new Error('Not enough actions')
    if (cardIndex < 0 || cardIndex >= player.hand.length) throw new Error('Invalid card')
    if (zoneIndex < 0 || zoneIndex >= 4) throw new Error('Invalid zone')

    const card = player.hand[cardIndex]
    if (card.cost > actionCost) throw new Error('Card cost exceeds action cost')

    // Remove from hand and place in zone
    player.hand.splice(cardIndex, 1)
    const cardInstance = { ...card, id: this.generateId(), tapped: false, flipped: false }
    player.zones[zoneIndex].push(cardInstance)

    // Deduct actions
    player.actionsRemaining -= actionCost

    this.addLog(`${playerId} played ${card.name} in zone ${zoneIndex}`)

    return {
      success: true,
      card: cardInstance,
      actionsRemaining: player.actionsRemaining,
    }
  }

  /**
   * Flip a card (activate it)
   */
  flipCard(playerId, zoneIndex, cardId) {
    if (playerId !== this.gameState.currentPlayerId) {
      throw new Error('Not your turn!')
    }

    const player = this.players[playerId]
    const zone = player.zones[zoneIndex]
    const card = zone.find(c => c.id === cardId)

    if (!card) throw new Error('Card not found in zone')
    if (card.tapped) throw new Error('Card already tapped')
    if (!card.has_flip) throw new Error('Card cannot flip')

    card.tapped = true
    card.flipped = !card.flipped

    this.addLog(`${playerId} flipped ${card.name}`)

    return { success: true, card }
  }

  /**
   * Attack with card from zone to opponent's zone
   */
  attack(playerId, fromZone, cardId, toOpponentZone) {
    if (playerId !== this.gameState.currentPlayerId) {
      throw new Error('Not your turn!')
    }

    // First player can't attack on first turn
    if (this.gameState.currentTurn === 0 && playerId === this.player1Id) {
      throw new Error('First player cannot attack on first turn')
    }

    const attacker = this.players[playerId]
    const defender = this.players[this.getOpponentId(playerId)]

    const attackingCard = attacker.zones[fromZone].find(c => c.id === cardId)
    if (!attackingCard) throw new Error('Card not found')
    if (attackingCard.tapped) throw new Error('Card already tapped')

    const defendingCards = defender.zones[toOpponentZone]

    // Calculate damage and defense
    const damage = attackingCard.attack || 0
    let totalDefense = 0

    defendingCards.forEach(card => {
      totalDefense += card.health || 0
    })

    // Apply damage
    if (damage > totalDefense) {
      const excessDamage = damage - totalDefense
      defender.health -= excessDamage

      this.addLog(
        `${playerId} attacks ${toOpponentZone} with ${attackingCard.name} (${damage} damage). Overkill: ${excessDamage}`,
      )
    } else {
      this.addLog(`${playerId} attacks ${toOpponentZone} with ${attackingCard.name} (${damage} damage).`)
    }

    // Remove dead creatures
    defender.zones[toOpponentZone] = defendingCards.filter(card => {
      card.health -= damage
      return card.health > 0
    })

    attackingCard.tapped = true
    attacker.hasAttacked = true

    // Check for winner
    if (defender.health <= 0) {
      this.gameState.status = 'finished'
      this.gameState.winner = playerId
      this.addLog(`${playerId} WINS! ${this.getOpponentId(playerId)}'s hero is defeated!`)
    }

    return {
      success: true,
      damage,
      remainingDefense: Math.max(0, totalDefense - damage),
      opponentHealth: defender.health,
    }
  }

  /**
   * End turn and switch to opponent
   */
  endTurn() {
    const currentPlayer = this.gameState.currentPlayerId
    this.gameState.currentTurn++

    this.gameState.currentPlayerId = this.getOpponentId(currentPlayer)
    this.gameState.turnPhase = 'start'

    this.addLog(`Turn ${this.gameState.currentTurn} - ${this.gameState.currentPlayerId}'s turn`)

    return {
      gameState: this.gameState,
      nextPlayer: this.gameState.currentPlayerId,
    }
  }

  /**
   * Get opponent's ID
   */
  getOpponentId(playerId) {
    return playerId === this.player1Id ? this.player2Id : this.player1Id
  }

  /**
   * Get player state (sanitized for display)
   */
  getPlayerState(playerId) {
    const player = this.players[playerId]
    return {
      id: playerId,
      health: player.health,
      hand: player.hand.map(card => ({
        ...card,
        id: undefined, // Don't expose card IDs in hand to opponent
      })),
      deckCount: player.deck.length,
      zones: player.zones,
      actionsRemaining: player.actionsRemaining,
      hasAttacked: player.hasAttacked,
      frozenTokens: player.frozenTokens,
    }
  }

  /**
   * Get full game state
   */
  getGameState() {
    return {
      gameState: this.gameState,
      player1: this.getPlayerState(this.player1Id),
      player2: this.getPlayerState(this.player2Id),
    }
  }

  /**
   * Add log entry
   */
  addLog(message) {
    this.gameState.log.push({
      timestamp: Date.now(),
      message,
    })
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}

export default GameEngine
