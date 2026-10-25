import type { FinishReason, Phase, PlayerId } from './types';

// Events feed the journal, animations and the network (docs/COMMANDS.md).
// Events MUST NOT contain hidden information: no opponent hand or deck contents.
export type GameEvent =
  | { type: 'match_started'; players: Array<{ id: PlayerId; nickname: string; heroId: string }>; firstPlayer: PlayerId }
  | { type: 'mulligan_made'; player: PlayerId }
  | { type: 'mulligan_kept'; player: PlayerId }
  | { type: 'turn_started'; player: PlayerId; turn: number; round: number }
  | { type: 'phase_changed'; player: PlayerId; phase: Phase }
  /** Personal-safe: never contains the drawn card ids. */
  | { type: 'card_drawn'; player: PlayerId; count: number }
  | { type: 'card_played'; player: PlayerId; instanceId: string; cardId: string; zone: number; slot: 'creature' | 'building'; replacedInstanceId: string | null }
  | { type: 'spell_cast'; player: PlayerId; instanceId: string; cardId: string }
  | { type: 'floop_used'; player: PlayerId; instanceId: string; cardId: string; paidActions: number }
  | { type: 'damage_dealt'; sourceInstanceId: string | null; targetInstanceId: string | null; targetPlayer: PlayerId | null; amount: number; absorbedByShield: number; toTarget: number }
  | { type: 'creature_healed'; instanceId: string; amount: number }
  | { type: 'lives_changed'; player: PlayerId; delta: number; lives: number }
  | { type: 'creature_destroyed'; instanceId: string; cardId: string }
  | { type: 'card_discarded'; player: PlayerId; instanceId: string; cardId: string; from: 'hand' | 'field' | 'deck' }
  | { type: 'card_returned'; player: PlayerId; instanceId: string; cardId: string }
  | { type: 'land_changed'; player: PlayerId; zone: number; change: 'frozen' | 'unfrozen' | 'flipped' | 'unflipped' }
  | { type: 'bonus_changed'; instanceId: string; cardId: string; bonusAttack: number; bonusDefense: number }
  | { type: 'shield_changed'; instanceId: string; cardId: string; shield: number }
  | { type: 'card_moved'; player: PlayerId; instanceId: string; fromZone: number; toZone: number }
  | { type: 'timer_expired'; player: PlayerId }
  | { type: 'player_eliminated'; player: PlayerId }
  | { type: 'player_surrendered'; player: PlayerId }
  | { type: 'player_disconnected'; player: PlayerId }
  | { type: 'match_finished'; winners: PlayerId[]; reason: FinishReason };
