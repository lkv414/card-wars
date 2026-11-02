// Card Wars v3 domain — pure rules core (docs/ARCHITECTURE.md, docs/STRUCTURE.md).
// No I/O, no clocks, no Math.random: RNG and config arrive through ports,
// card definitions through the CardCatalog port. The only dependency is Immer.

export * from './types';
export * from './config';
export * from './catalog';
export * from './commands';
export * from './events';
export * from './errors';
export * from './rng';
export * from './zones';

export { createMatch, type MatchSetup, type PlayerSetup } from './match/create';
export { applyCommand } from './match/apply';
export { computeEff } from './stats';
export { mirrorZoneIndex } from './zones';
export type {
  AbilitySpec,
  AdditionalCost,
  ConditionSpec,
  EffectSpec,
  PendingChoice,
  QueuedAbility,
  StatKey,
  TargetAsk,
  TargetAskKind,
  TargetChoice,
  TargetRef,
  Trigger,
  TriggerPayload,
} from './mechanics/types';
export { MECHANICS, type MechanicHandler } from './mechanics/registry';
