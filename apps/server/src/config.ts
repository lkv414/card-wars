// Rule parameter values (docs/CONFIG.md). The game subset feeds the domain;
// the timer subset belongs to the adapter's timer state machine (docs/TECH.md).
export const config = {
  // game (docs/CONFIG.md «Партия» / «Колода»)
  startingLives: 25,
  teamStartingLives: 50,
  deckSize: 40,
  startingHandSize: 5,
  mulliganCount: 1,
  actionsPerTurn: 2,
  landsPerPlayer: 4,
  landRequirementPerCard: 1,
  freeDrawsPerTurn: 1,
  extraDrawCost: 1,
  companionMaxInPlay: 1,
  copyLimit: 4,
  // timers (docs/CONFIG.md «Таймеры»)
  turnTimerSeconds: 90,
  hurrySpeedupFactor: 2,
  hurrySpeedupWindowSeconds: 1,
  reconnectWaitSeconds: 60,
  // lobby (docs/CONFIG.md «Лобби»)
  lobbyCodeDigits: 4,
  minPlayers: 2,
  maxPlayers: 2, // MVP: 1v1; 3–4 players arrive in stage 5
} as const;
