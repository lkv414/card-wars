import type { CardCatalog } from './catalog';
import type { GameConfig } from './config';
import type { RejectCode } from './errors';
import type { GameEvent } from './events';
import type { TargetChoice } from './mechanics/types';
import type { MatchState, PlayerId } from './types';

/** Player-picked targets sent with activation commands (docs/MECHANICS-V2.md §5). */
export interface ChoiceAnswer {
  /** For optional abilities: true = run, false/omitted = skip. */
  proceed?: boolean;
  /** One choice per resolve command, matching the current ask. */
  targets?: TargetChoice[];
}

export type Command =
  | { type: 'mulligan'; player: PlayerId }
  | { type: 'keep_hand'; player: PlayerId }
  | { type: 'play_card'; player: PlayerId; instanceId: string; zone?: number; unfreezeWith?: string; targets?: TargetChoice[] }
  | { type: 'floop'; player: PlayerId; instanceId: string; targets?: TargetChoice[] }
  | { type: 'hero_ability'; player: PlayerId; targets?: TargetChoice[] }
  | { type: 'resolve_choice'; player: PlayerId; answer: ChoiceAnswer }
  | { type: 'draw_extra'; player: PlayerId }
  | { type: 'discard_from_hand'; player: PlayerId; instanceId: string; unfreezeZone?: number }
  | { type: 'discard_from_field'; player: PlayerId; instanceId: string }
  | { type: 'go_battle'; player: PlayerId }
  /** Automatic transition sent by the adapter when the turn timer fires (docs/TECH.md). */
  | { type: 'time_expired'; player: PlayerId }
  | { type: 'surrender'; player: PlayerId }
  /** Server-only: the adapter applies it when the reconnect wait expires (docs/NETWORK.md). */
  | { type: 'disconnect_loss'; player: PlayerId };

export interface DomainDeps {
  config: GameConfig;
  catalog: CardCatalog;
}

export type ApplyResult =
  | { ok: true; state: MatchState; events: GameEvent[] }
  | { ok: false; rejected: { code: RejectCode; message: string } };
