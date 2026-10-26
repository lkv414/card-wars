export type RejectCode =
  | 'match_not_running'
  | 'match_finished'
  | 'not_your_turn'
  | 'wrong_phase'
  | 'unknown_player'
  | 'unknown_instance'
  | 'unknown_card'
  | 'card_not_in_hand'
  | 'card_not_in_play'
  | 'card_has_no_floop'
  | 'insufficient_actions'
  | 'land_requirement_not_met'
  | 'zone_out_of_range'
  | 'slot_mismatch'
  | 'land_frozen'
  | 'zone_not_frozen'
  | 'unfreeze_card_invalid'
  | 'already_flipped'
  | 'already_surrendered'
  | 'floop_forbidden_first_turn'
  | 'deck_empty'
  | 'mulligan_unavailable'
  | 'invalid_card_type'
  | 'target_required'
  | 'invalid_choice'
  | 'invalid_setup'
  | 'unknown_command';

/** Thrown inside a state transition; the producer aborts, so the state stays untouched. */
export class DomainError extends Error {
  constructor(
    readonly code: RejectCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}
