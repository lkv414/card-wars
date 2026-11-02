import type { PlayerId } from './types';

/** Where an ability comes from: a field instance or the player's hero (instanceId null). */
export interface EffectSource {
  player: PlayerId;
  instanceId: string | null;
}
