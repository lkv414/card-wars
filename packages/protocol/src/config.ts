// Shared project config values (docs/CONFIG.md). The single source of these
// numbers for server, domain deps, bots and client UI. Adapters may add their
// own tuning constants, but rule parameters live only here.

export const CONFIG = {
  // match
  startingLives: 25,
  teamStartingLives: 50,
  teamSize: 2,
  minPlayers: 2,
  maxPlayers: 4,
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
  // timers
  turnTimerSeconds: 90,
  hurrySpeedupFactor: 2,
  hurrySpeedupWindowSeconds: 1,
  reconnectWaitSeconds: 60,
  // lobby
  lobbyCodeDigits: 4,
} as const;
