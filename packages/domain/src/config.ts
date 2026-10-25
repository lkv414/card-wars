// Rule parameters (docs/CONFIG.md). The domain has no default values — the caller provides them.

export interface GameConfig {
  startingLives: number;
  teamStartingLives: number;
  deckSize: number;
  startingHandSize: number;
  mulliganCount: number;
  actionsPerTurn: number;
  landsPerPlayer: number;
  landRequirementPerCard: number;
  freeDrawsPerTurn: number;
  extraDrawCost: number;
  companionMaxInPlay: number;
  copyLimit: number;
}
