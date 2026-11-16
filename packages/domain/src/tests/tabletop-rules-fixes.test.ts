import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createMatch,
  type Command,
  type MatchState,
  type PlayerSetup,
} from '../index';
import { killInstance } from '../damage';
import {
  buildDeck,
  catalog,
  defaultConfig,
  forceToHand,
  handCardId,
  makeSetup,
  mustOk,
  P1,
  P1_POOL,
  P2,
  P2_POOL,
} from './helpers';
import { produce } from 'immer';

const deps = { config: defaultConfig, catalog };
const P3 = 'p3';
const P4 = 'p4';

function startedMatch(seed = 12345): MatchState {
  const { state } = createMatch(deps, makeSetup({ seed }));
  let s = mustOk(applyCommand(state, { type: 'keep_hand', player: P1 }, deps));
  s = mustOk(applyCommand(s, { type: 'keep_hand', player: P2 }, deps));
  return s;
}

const LANDS = [
  ['swamp', 'swamp', 'corn', 'rainbow'],
  ['corn', 'corn', 'good', 'swamp'],
  ['swamp', 'swamp', 'corn', 'rainbow'],
  ['corn', 'corn', 'good', 'swamp'],
] as const;

function new2v2Match(teamVariant: 'wall' | 'neighbors', seed = 3000): MatchState {
  const players: PlayerSetup[] = [P1, P2, P3, P4].map((id, i) => ({
    id,
    nickname: `Игрок ${i + 1}`,
    heroId: 'hero-billy',
    deck: buildDeck(i % 2 === 0 ? P1_POOL : P2_POOL),
    lands: [...LANDS[i]!],
  }));
  const { state } = createMatch(deps, {
    players,
    seed,
    mode: 'teams',
    teamVariant,
  });
  let s = state;
  for (const pid of state.order) {
    s = mustOk(applyCommand(s, { type: 'keep_hand', player: pid }, deps));
  }
  return s;
}

function turn(s: MatchState, command: Command): MatchState {
  return mustOk(applyCommand(s, command, deps));
}

function battle(s: MatchState, player: string): MatchState {
  return turn(s, { type: 'go_battle', player });
}

describe('Tabletop rules fixes', () => {
  describe('1. Discard to owner pile', () => {
    it('killInstance sends stolen/controlled card to original owner discard pile', () => {
      let s = startedMatch();
      // P1 has a card from P2's deck (stolen/borrowed)
      const p2CardId = s.players[P2]!.deck[0]!;
      s = produce(s, (draft) => {
        draft.players[P2]!.deck = draft.players[P2]!.deck.filter((id) => id !== p2CardId);
        const inst = draft.instances[p2CardId]!;
        inst.controller = P1;
        inst.owner = P2;
        inst.location = 'field';
        inst.zone = 0;
        inst.slot = 'creature';
        draft.players[P1]!.zones[0]!.creature = p2CardId;
      });

      // Kill instance
      const next = produce(s, (draft) => {
        const ctx = { config: deps.config, catalog: deps.catalog, events: [], frame: { queue: [], steps: 0 } };
        killInstance(draft, ctx, p2CardId);
      });

      expect(next.players[P2]!.discard).toContain(p2CardId);
      expect(next.players[P1]!.discard).not.toContain(p2CardId);
    });

    it('creature replacement sends replaced card to its original owner discard pile', () => {
      let s = startedMatch();
      // P1 controls a creature owned by P2 in zone 0
      const p2CardId = s.players[P2]!.deck[0]!;
      s = produce(s, (draft) => {
        draft.players[P2]!.deck = draft.players[P2]!.deck.filter((id) => id !== p2CardId);
        const inst = draft.instances[p2CardId]!;
        inst.controller = P1;
        inst.owner = P2;
        inst.location = 'field';
        inst.zone = 0;
        inst.slot = 'creature';
        inst.flipped = false;
        draft.players[P1]!.zones[0]!.creature = p2CardId;
      });

      // P1 plays another creature into zone 0, replacing it
      s = forceToHand(s, P1, 'vanilla-swamp');
      const newCardId = handCardId(s, P1, 'vanilla-swamp');
      s = turn(s, { type: 'play_card', player: P1, instanceId: newCardId, zone: 0 });

      expect(s.players[P2]!.discard).toContain(p2CardId);
      expect(s.players[P1]!.discard).not.toContain(p2CardId);
    });
  });

  describe('2. 2v2 teammate floop', () => {
    it('allows a teammate in 2v2 to floop/activate a companion card during their turn', () => {
      let s = new2v2Match('wall');
      // Advance to round 2 so floop is allowed
      s = battle(battle(s, P1), P2); // team B
      s = battle(battle(s, P3), P4); // back to team A, round 2
      expect(s.round).toBe(2);

      // Put companion-floop into P1's companion slot
      const compId = s.players[P1]!.deck[0]!;
      s = produce(s, (draft) => {
        draft.players[P1]!.deck = draft.players[P1]!.deck.filter((id) => id !== compId);
        const inst = draft.instances[compId]!;
        inst.cardId = 'companion-floop';
        inst.location = 'companion';
        inst.flipped = false;
        draft.players[P1]!.companion = compId;
      });

      const p2HandBefore = s.players[P2]!.hand.length;
      const p2ActionsBefore = s.players[P2]!.actions;

      // P2 (P1's teammate) floops P1's companion card!
      s = turn(s, { type: 'floop', player: P2, instanceId: compId });

      expect(s.instances[compId]!.flipped).toBe(true);
      expect(s.players[P2]!.actions).toBe(p2ActionsBefore - 1);
      expect(s.players[P2]!.hand.length).toBe(p2HandBefore + 1);
    });

    it('rejects an opponent from flooping another team companion card', () => {
      let s = new2v2Match('wall');
      s = battle(battle(s, P1), P2); // team B active
      const compId = s.players[P1]!.deck[0]!;
      s = produce(s, (draft) => {
        draft.players[P1]!.deck = draft.players[P1]!.deck.filter((id) => id !== compId);
        const inst = draft.instances[compId]!;
        inst.cardId = 'companion-floop';
        inst.location = 'companion';
        inst.flipped = false;
        draft.players[P1]!.companion = compId;
      });

      // P3 is on team B (opponents of P1)
      const res = applyCommand(s, { type: 'floop', player: P3, instanceId: compId }, deps);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.rejected.code).toBe('card_not_in_play');
    });
  });

  describe('3. Combat damage event payload', () => {
    it('passes modified attack power (attackPowerMod) in on_damage_dealt trigger', () => {
      let s = startedMatch();
      // Round 2
      s = battle(s, P1);
      s = battle(s, P2);
      expect(s.round).toBe(2);

      // Place atk-mod-creature (base attack 2, tripled to 6) in P1 zone 0
      s = forceToHand(s, P1, 'atk-mod-creature');
      s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'atk-mod-creature'), zone: 0 });

      // Place a high defense defender in P2 zone 3 (which faces P1 zone 0)
      s = produce(s, (draft) => {
        const p2Card = draft.players[P2]!.deck[0]!;
        draft.players[P2]!.deck = draft.players[P2]!.deck.filter((id) => id !== p2Card);
        const inst = draft.instances[p2Card]!;
        inst.cardId = 'vanilla-swamp'; // def 6
        inst.location = 'field';
        inst.zone = 3;
        inst.slot = 'creature';
        inst.damage = 0;
        draft.players[P2]!.zones[3]!.creature = p2Card;
      });

      // Apply go_battle
      const res = applyCommand(s, { type: 'go_battle', player: P1 }, deps);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      // Check damage dealt event has amount: 6 (not raw 2)
      const damageEvent = res.events.find(
        (e) => e.type === 'damage_dealt' && e.targetPlayer === null,
      ) as { type: 'damage_dealt'; amount: number } | undefined;
      expect(damageEvent).toBeDefined();
      expect(damageEvent?.amount).toBe(6);
    });
  });

  describe('4. 2v2 team starting lives', () => {
    it('sets teamStartingLives to 40 in 2v2', () => {
      expect(defaultConfig.teamStartingLives).toBe(40);
      const s = new2v2Match('wall');
      expect(s.teams!['team-a']!.lives).toBe(40);
      expect(s.teams!['team-a']!.maxLives).toBe(40);
      expect(s.players[P1]!.lives).toBe(40);
      expect(s.players[P2]!.lives).toBe(40);
      expect(s.teams!['team-b']!.lives).toBe(40);
      expect(s.players[P3]!.lives).toBe(40);
      expect(s.players[P4]!.lives).toBe(40);
    });
  });

  describe('5. 2v2 turn modes', () => {
    it('wall: both team allies take turns simultaneously', () => {
      let s = new2v2Match('wall');
      expect(s.activePlayers).toEqual([P1, P2]);
      expect(s.round).toBe(1);

      // Floop forbidden for both in round 1
      s = forceToHand(s, P1, 'vanilla-swamp');
      s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 });
      const floop = applyCommand(s, { type: 'floop', player: P1, instanceId: s.players[P1]!.zones[0]!.creature! }, deps);
      expect(floop.ok).toBe(false);
      if (!floop.ok) expect(floop.rejected.code).toBe('floop_forbidden_first_turn');

      // Both ready up to advance
      const r1 = battle(s, P1);
      expect(r1.activePlayers).toEqual([P1, P2]);
      const r2 = battle(r1, P2);
      expect(r2.activePlayers).toEqual([P3, P4]);
    });

    it('neighbors: sequential turns P1 -> P2 -> P3 -> P4 with no floop/attack for first 3 players in round 1', () => {
      let s = new2v2Match('neighbors');
      // Turn 1: P1
      expect(s.activePlayers).toEqual([P1]);
      expect(s.round).toBe(1);
      expect(s.turn).toBe(1);

      // P1 cannot floop in round 1
      s = forceToHand(s, P1, 'vanilla-swamp');
      s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 });
      const floopP1 = applyCommand(s, { type: 'floop', player: P1, instanceId: s.players[P1]!.zones[0]!.creature! }, deps);
      expect(floopP1.ok).toBe(false);
      if (!floopP1.ok) expect(floopP1.rejected.code).toBe('floop_forbidden_first_turn');

      // P1 battle -> no combat damage dealt in round 1 for P1
      s = battle(s, P1);
      expect(s.teams!['team-b']!.lives).toBe(40);

      // Turn 2: P2
      expect(s.activePlayers).toEqual([P2]);
      expect(s.turn).toBe(2);
      expect(s.round).toBe(1);

      // P2 cannot floop in round 1
      s = forceToHand(s, P2, 'vanilla-swamp');
      s = turn(s, { type: 'play_card', player: P2, instanceId: handCardId(s, P2, 'vanilla-swamp'), zone: 0 });
      const floopP2 = applyCommand(s, { type: 'floop', player: P2, instanceId: s.players[P2]!.zones[0]!.creature! }, deps);
      expect(floopP2.ok).toBe(false);
      if (!floopP2.ok) expect(floopP2.rejected.code).toBe('floop_forbidden_first_turn');

      // P2 battle -> no attack in round 1 for P2
      s = battle(s, P2);

      // Turn 3: P3
      expect(s.activePlayers).toEqual([P3]);
      expect(s.turn).toBe(3);
      expect(s.round).toBe(1);

      // P3 cannot floop in round 1
      s = forceToHand(s, P3, 'vanilla-swamp');
      s = turn(s, { type: 'play_card', player: P3, instanceId: handCardId(s, P3, 'vanilla-swamp'), zone: 0 });
      const floopP3 = applyCommand(s, { type: 'floop', player: P3, instanceId: s.players[P3]!.zones[0]!.creature! }, deps);
      expect(floopP3.ok).toBe(false);
      if (!floopP3.ok) expect(floopP3.rejected.code).toBe('floop_forbidden_first_turn');

      // P3 battle -> no attack in round 1 for P3
      s = battle(s, P3);

      // Turn 4: P4 (4th player!)
      expect(s.activePlayers).toEqual([P4]);
      expect(s.turn).toBe(4);
      expect(s.round).toBe(1);

      // P4 CAN attack! Play creature and battle -> attacks!
      s = forceToHand(s, P4, 'vanilla-swamp'); // 2 ATK
      s = turn(s, { type: 'play_card', player: P4, instanceId: handCardId(s, P4, 'vanilla-swamp'), zone: 0 });
      s = battle(s, P4);

      // P4 attack deals 2 damage to opponent team A (40 - 2 = 38)
      expect(s.teams!['team-a']!.lives).toBe(38);

      // Turn 5: P1 in Round 2!
      expect(s.round).toBe(2);
      expect(s.activePlayers).toEqual([P1]);
      expect(s.turn).toBe(5);

      // In Round 2, P1 CAN attack!
      s = battle(s, P1);
      // P1 had creature in zone 0 with 2 ATK -> attacks team B (40 - 2 = 38)
      expect(s.teams!['team-b']!.lives).toBe(38);
    });
  });

  describe('6. Burn tokens ticking', () => {
    it('ticks burn tokens on active player creatures and player at turn start', () => {
      let s = startedMatch();
      // Round 2
      s = battle(s, P1);
      s = battle(s, P2);
      expect(s.round).toBe(2);

      // Put a creature with burnTokens on P1 zone 0
      s = forceToHand(s, P1, 'vanilla-swamp'); // 6 DEF
      s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 });
      const cId = s.players[P1]!.zones[0]!.creature!;

      // Give 2 burn tokens to creature and 3 burn tokens to P1
      s = produce(s, (draft) => {
        draft.instances[cId]!.burnTokens = 2;
        draft.players[P1]!.burnTokens = 3;
      });

      // Pass turns to P2 and back to P1
      s = battle(s, P1); // P2's turn
      expect(s.instances[cId]!.damage).toBe(0); // Not P1's turn start yet

      s = battle(s, P2); // P1's turn start!
      // Creature took 2 damage from its 2 burn tokens
      expect(s.instances[cId]!.damage).toBe(2);
      // Player took 3 damage from their 3 burn tokens (25 - 3 = 22)
      expect(s.players[P1]!.lives).toBe(22);
    });

    it('destroys creature if burn token damage >= defense at turn start', () => {
      let s = startedMatch();
      s = battle(s, P1);
      s = battle(s, P2);

      s = forceToHand(s, P1, 'cheap-rainbow'); // 5 DEF
      s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'cheap-rainbow'), zone: 0 });
      const cId = s.players[P1]!.zones[0]!.creature!;

      // Give 5 burn tokens
      s = produce(s, (draft) => {
        draft.instances[cId]!.burnTokens = 5;
      });

      s = battle(s, P1);
      s = battle(s, P2); // P1's turn start

      // Creature took 5 damage and was destroyed
      expect(s.players[P1]!.zones[0]!.creature).toBeNull();
      expect(s.players[P1]!.discard).toContain(cId);
    });
  });

  describe('7. Rumble / Slam discount', () => {
    it('discounts replacement cost by the replaced creature cost', () => {
      let s = startedMatch();
      // Zone 0 has a creature of cost 2 (big-swamp)
      s = forceToHand(s, P1, 'big-swamp');
      s = turn(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'big-swamp'), zone: 0 });
      expect(s.players[P1]!.zones[0]!.creature).not.toBeNull();

      // Pass turn to get full actions back
      s = battle(s, P1);
      s = battle(s, P2);
      expect(s.players[P1]!.actions).toBe(2);

      // Now P1 has rumble-creature (printed cost 3, rumble: true)
      // Since big-swamp costs 2, replacement cost should be 3 - 2 = 1 action!
      s = forceToHand(s, P1, 'rumble-creature');
      const rumbleId = handCardId(s, P1, 'rumble-creature');

      // Set P1 actions to 1 (which would be insufficient for cost 3, but sufficient for 3 - 2 = 1)
      s = produce(s, (draft) => {
        draft.players[P1]!.actions = 1;
      });

      s = turn(s, { type: 'play_card', player: P1, instanceId: rumbleId, zone: 0 });
      expect(s.players[P1]!.zones[0]!.creature).toBe(rumbleId);
      expect(s.players[P1]!.actions).toBe(0); // 1 - 1 = 0
    });

    it('requires full cost when rumble creature is played on an empty zone', () => {
      let s = startedMatch();
      s = battle(s, P1);
      s = battle(s, P2);

      s = forceToHand(s, P1, 'rumble-creature'); // cost 3
      const rumbleId = handCardId(s, P1, 'rumble-creature');

      // P1 has 2 actions (less than 3)
      expect(s.players[P1]!.actions).toBe(2);

      // Playing on empty zone 1 should fail with insufficient_actions
      const res = applyCommand(s, { type: 'play_card', player: P1, instanceId: rumbleId, zone: 1 }, deps);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.rejected.code).toBe('insufficient_actions');
    });
  });
});
