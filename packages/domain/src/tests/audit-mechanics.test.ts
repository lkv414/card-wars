import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { runMechanic } from '../mechanics/registry';
import { createMatch, applyCommand } from '../index';
import { defaultConfig, catalog, makeSetup, P1, P2 } from './helpers';
import type { EffectSource } from '../mechanics/source';
import type { Ctx } from '../util';
import type { CardInstance, MatchState } from '../types';
import type { GameEvent } from '../events';

const deps = { config: defaultConfig, catalog };

function createTestCtx() {
  const events: GameEvent[] = [];
  const ctx: Ctx = {
    events,
    catalog,
    config: defaultConfig,
    frame: { queue: [], steps: 0 },
  };
  return { ctx, events };
}

function makeInstance(id: string, cardId: string, owner: string, zone: number | null, slot: 'creature' | 'building' | null = 'creature'): CardInstance {
  return {
    id,
    cardId,
    owner,
    controller: owner,
    location: 'field',
    zone,
    slot,
    damage: 0,
    flipped: false,
    shield: 0,
    bonusAttack: 0,
    bonusDefense: 0,
    playedTurn: 1,
  };
}

describe('Audited Mechanics Unit Tests', () => {
  it('freeze_lane_both_lands: freezes both players lands in the specified lane', () => {
    const s = createMatch(deps, makeSetup()).state;
    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };

    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'freeze_lane_both_lands', source, undefined, [{ kind: 'landscape', player: P1, zone: 2 }], undefined, P1);
    });

    expect(next.players[P1]!.lands[2]!.frozen).toBe(true);
    expect(next.players[P2]!.lands[2]!.frozen).toBe(true);
    expect(next.players[P1]!.lands[0]!.frozen).toBe(false);
  });

  it('pentaplaster_heal_five_exact: heals exactly 5 damage from target', () => {
    let s = createMatch(deps, makeSetup()).state;
    const instId = 'test-creature-1';
    s = produce(s, (d) => {
      const inst = makeInstance(instId, 'c1', P1, 0);
      inst.damage = 8;
      d.instances[instId] = inst;
      d.players[P1]!.zones[0]!.creature = instId;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'pentaplaster_heal_five_exact', source, undefined, [{ kind: 'creature', instanceId: instId }], undefined, P1);
    });

    expect(next.instances[instId]!.damage).toBe(3); // 8 - 5 = 3
  });

  it('damage_opponents_with_empty_hand: deals damage to opponents with 0 hand cards', () => {
    let s = createMatch(deps, makeSetup()).state;
    s = produce(s, (d) => {
      d.players[P2]!.hand = []; // empty hand
      d.players[P2]!.lives = 25;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'damage_opponents_with_empty_hand', source, { amount: 3 }, undefined, undefined, P1);
    });

    expect(next.players[P2]!.lives).toBe(22);
  });

  it('swap_damage: swaps damage between two chosen creatures', () => {
    let s = createMatch(deps, makeSetup()).state;
    const c1 = 'c-1';
    const c2 = 'c-2';
    s = produce(s, (d) => {
      const inst1 = makeInstance(c1, 'card-1', P1, 0);
      inst1.damage = 2;
      const inst2 = makeInstance(c2, 'card-2', P2, 0);
      inst2.damage = 7;
      d.instances[c1] = inst1;
      d.instances[c2] = inst2;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'swap_damage', source, undefined, [
        { kind: 'creature', instanceId: c1 },
        { kind: 'creature', instanceId: c2 },
      ], undefined, P1);
    });

    expect(next.instances[c1]!.damage).toBe(7);
    expect(next.instances[c2]!.damage).toBe(2);
  });

  it('explosive_dude_cleave: deals damage to opponent creature and adjacent opponent creatures', () => {
    let s = createMatch(deps, makeSetup()).state;
    const oppC1 = 'opp-c1';
    const oppC2 = 'opp-c2';
    const dudeId = 'explosive-dude';
    s = produce(s, (d) => {
      d.instances[dudeId] = makeInstance(dudeId, 'card-dude', P1, 1);
      d.players[P1]!.zones[1]!.creature = dudeId;

      d.instances[oppC1] = makeInstance(oppC1, 'card-opp1', P2, 1);
      d.instances[oppC2] = makeInstance(oppC2, 'card-opp2', P2, 2);
      d.players[P2]!.zones[1]!.creature = oppC1;
      d.players[P2]!.zones[2]!.creature = oppC2;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: dudeId };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'explosive_dude_cleave', source, undefined, [
        { kind: 'creature', instanceId: oppC1 },
      ], undefined, P1);
    });

    expect(next.instances[oppC1]!.damage).toBe(1);
    expect(next.instances[oppC2]!.damage).toBe(1);
  });

  it('arm_delayed_explosion: deals 6 damage to opponent creature in facing zone and self-destructs', () => {
    let s = createMatch(deps, makeSetup()).state;
    const boomId = 'loud-boom';
    const oppC = 'opp-c-facing';
    s = produce(s, (d) => {
      d.instances[boomId] = makeInstance(boomId, 'card-boom', P1, 0);
      d.players[P1]!.zones[0]!.creature = boomId;

      d.instances[oppC] = makeInstance(oppC, 'card-opp-facing', P2, 3);
      d.players[P2]!.zones[3]!.creature = oppC;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: boomId };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'arm_delayed_explosion', source, { damage: 6 }, undefined, undefined, P1);
    });

    expect(next.instances[oppC]!.damage).toBe(6);
    expect(next.players[P1]!.zones[0]!.creature).toBeNull();
    expect(next.players[P1]!.discard).toContain(boomId);
  });

  it('volcano_destroy_and_erupt: destroys targeted building/creature and flips own land', () => {
    let s = createMatch(deps, makeSetup()).state;
    const bId = 'bld-volcano';
    s = produce(s, (d) => {
      d.instances[bId] = makeInstance(bId, 'card-volcano', P1, 1, 'building');
      d.players[P1]!.zones[1]!.building = bId;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: bId };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'volcano_destroy_and_erupt', source, undefined, [
        { kind: 'creature', instanceId: bId },
      ], undefined, P1);
    });

    expect(next.players[P1]!.zones[1]!.building).toBeNull();
    expect(next.players[P1]!.lands[1]!.flipped).toBe(true);
    expect(next.players[P1]!.discard).toContain(bId);
  });

  it('grand_prix_replay: returns played creature to hand, replays for free, deals 3 damage', () => {
    let s = createMatch(deps, makeSetup()).state;
    const cId = 'played-this-turn';
    s = produce(s, (d) => {
      d.instances[cId] = makeInstance(cId, 'card-c1', P1, 0);
      d.instances[cId]!.enteredThisTurn = true;
      d.players[P1]!.zones[0]!.creature = cId;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'grand_prix_replay', source, undefined, [
        { kind: 'creature', instanceId: cId },
      ], undefined, P1);
    });

    // The creature should be back in the zone with 3 damage
    expect(next.players[P1]!.zones[0]!.creature).toBe(cId);
    expect(next.instances[cId]!.location).toBe('field');
    expect(next.instances[cId]!.damage).toBe(3);
  });

  it('basalt_colossus_burn: puts burn token on target creature and deals damage equal to all burn tokens', () => {
    let s = createMatch(deps, makeSetup()).state;
    const oppC = 'opp-burn-target';
    s = produce(s, (d) => {
      d.instances[oppC] = makeInstance(oppC, 'card-opp-burn', P2, 0);
      d.players[P2]!.zones[0]!.creature = oppC;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'basalt_colossus_burn', source, undefined, [
        { kind: 'creature', instanceId: oppC },
      ], undefined, P1);
    });

    expect(next.instances[oppC]!.burnTokens).toBe(1);
    expect(next.instances[oppC]!.damage).toBe(1);
  });

  it('fiery_crater_remove_burn_damage: removes burn token from creature and deals 3 damage', () => {
    let s = createMatch(deps, makeSetup()).state;
    const targetC = 'target-burn-c';
    s = produce(s, (d) => {
      const inst = makeInstance(targetC, 'card-tc', P2, 0);
      inst.burnTokens = 2;
      d.instances[targetC] = inst;
      d.players[P2]!.zones[0]!.creature = targetC;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'fiery_crater_remove_burn_damage', source, undefined, [
        { kind: 'creature', instanceId: targetC },
      ], undefined, P1);
    });

    expect(next.instances[targetC]!.burnTokens).toBe(1);
    expect(next.instances[targetC]!.damage).toBe(3);
  });

  it('volcanic_awakening_double_burn: doubles burn tokens on all creatures in game', () => {
    let s = createMatch(deps, makeSetup()).state;
    const c1 = 'burn-c1';
    const c2 = 'burn-c2';
    s = produce(s, (d) => {
      const inst1 = makeInstance(c1, 'c1', P1, 0);
      inst1.burnTokens = 2;
      d.instances[c1] = inst1;
      d.players[P1]!.zones[0]!.creature = c1;

      const inst2 = makeInstance(c2, 'c2', P2, 1);
      inst2.burnTokens = 3;
      d.instances[c2] = inst2;
      d.players[P2]!.zones[1]!.creature = c2;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'volcanic_awakening_double_burn', source, undefined, undefined, undefined, P1);
    });

    // c1 is controlled by P1 (friendly), so its burn tokens are not doubled (remains 2)
    expect(next.instances[c1]!.burnTokens).toBe(2);
    // c2 is controlled by P2 (opponent), so its burn tokens are doubled: 3 * 2 = 6
    expect(next.instances[c2]!.burnTokens).toBe(6);
  });

  it('count_dracula_lifesteal: heals source player for damage amount on trigger', () => {
    let s = createMatch(deps, makeSetup()).state;
    s = produce(s, (d) => {
      d.players[P1]!.lives = 15;
      d.players[P1]!.maxLives = 25;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'count_dracula_lifesteal', source, undefined, undefined, { amount: 4 }, P1);
    });

    expect(next.players[P1]!.lives).toBe(19);
  });

  it('avalanche_born_freeze: freezes target landscape', () => {
    const s = createMatch(deps, makeSetup()).state;
    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'avalanche_born_freeze', source, undefined, [
        { kind: 'landscape', player: P2, zone: 2 },
      ], undefined, P1);
    });

    expect(next.players[P2]!.lands[2]!.frozen).toBe(true);
  });

  it('bigfoot_ghost_unflip_land: unflips chosen land and draws 1 card if lava land', () => {
    let s = createMatch(deps, makeSetup()).state;
    s = produce(s, (d) => {
      d.players[P1]!.lands[0]!.type = 'lava';
      d.players[P1]!.lands[0]!.flipped = true;
      d.players[P1]!.deck = ['deck-1', 'deck-2'];
      d.instances['deck-1'] = makeInstance('deck-1', 'c1', P1, null, null);
      d.instances['deck-2'] = makeInstance('deck-2', 'c2', P1, null, null);
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'bigfoot_ghost_unflip_land', source, undefined, [
        { kind: 'landscape', player: P1, zone: 0 },
      ], undefined, P1);
    });

    expect(next.players[P1]!.lands[0]!.flipped).toBe(false);
    expect(next.players[P1]!.hand).toContain('deck-1');
  });

  it('rock_mermaid_mill_player: mills 2 cards from opponent deck', () => {
    let s = createMatch(deps, makeSetup()).state;
    s = produce(s, (d) => {
      d.players[P2]!.deck = ['opp-d1', 'opp-d2', 'opp-d3'];
      d.instances['opp-d1'] = makeInstance('opp-d1', 'c1', P2, null, null);
      d.instances['opp-d2'] = makeInstance('opp-d2', 'c2', P2, null, null);
      d.instances['opp-d3'] = makeInstance('opp-d3', 'c3', P2, null, null);
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'rock_mermaid_mill_player', source, undefined, undefined, undefined, P1);
    });

    expect(next.players[P2]!.deck).toEqual(['opp-d3']);
    expect(next.players[P2]!.discard).toEqual(['opp-d1', 'opp-d2']);
  });

  it('young_scholar_draw_per_damage: draws 1 card per 3 damage on creature', () => {
    let s = createMatch(deps, makeSetup()).state;
    const scholarId = 'young-scholar-inst';
    s = produce(s, (d) => {
      const inst = makeInstance(scholarId, 'young-scholar-card', P1, 0);
      inst.damage = 7; // Math.floor(7 / 3) = 2 cards
      d.instances[scholarId] = inst;
      d.players[P1]!.zones[0]!.creature = scholarId;
      d.players[P1]!.deck = ['draw-1', 'draw-2', 'draw-3'];
      d.instances['draw-1'] = makeInstance('draw-1', 'c1', P1, null, null);
      d.instances['draw-2'] = makeInstance('draw-2', 'c2', P1, null, null);
      d.instances['draw-3'] = makeInstance('draw-3', 'c3', P1, null, null);
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: scholarId };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'young_scholar_draw_per_damage', source, undefined, undefined, undefined, P1);
    });

    expect(next.players[P1]!.hand).toContain('draw-1');
    expect(next.players[P1]!.hand).toContain('draw-2');
    expect(next.players[P1]!.hand).not.toContain('draw-3');
  });

  it('conflagration_burn_damage_draw: deals damage to burning enemies and draws 1 card', () => {
    let s = createMatch(deps, makeSetup()).state;
    const oppC1 = 'opp-burn-1';
    const oppC2 = 'opp-burn-2';
    s = produce(s, (d) => {
      const inst1 = makeInstance(oppC1, 'c1', P2, 0);
      inst1.burnTokens = 3;
      d.instances[oppC1] = inst1;
      d.players[P2]!.zones[0]!.creature = oppC1;

      const inst2 = makeInstance(oppC2, 'c2', P2, 1);
      inst2.burnTokens = 0;
      d.instances[oppC2] = inst2;
      d.players[P2]!.zones[1]!.creature = oppC2;

      d.players[P1]!.deck = ['draw-card-1'];
      d.instances['draw-card-1'] = makeInstance('draw-card-1', 'c3', P1, null, null);
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'conflagration_burn_damage_draw', source, undefined, undefined, undefined, P1);
    });

    expect(next.instances[oppC1]!.damage).toBe(3);
    expect(next.instances[oppC2]!.damage).toBe(0);
    expect(next.players[P1]!.hand).toContain('draw-card-1');
  });

  it('winter_weaver_cycle: draws 1 card and forces players with frost tokens to discard', () => {
    let s = createMatch(deps, makeSetup()).state;
    s = produce(s, (d) => {
      d.players[P1]!.deck = ['weaver-draw'];
      d.instances['weaver-draw'] = makeInstance('weaver-draw', 'c1', P1, null, null);

      d.players[P2]!.lands[0]!.iceTokens = 1;
      d.players[P2]!.hand = ['opp-hand-1'];
      const inst = makeInstance('opp-hand-1', 'c2', P2, null, null);
      inst.location = 'hand';
      d.instances['opp-hand-1'] = inst;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'winter_weaver_cycle', source, undefined, undefined, undefined, P1);
    });

    expect(next.players[P1]!.hand).toContain('weaver-draw');
    expect(next.players[P2]!.hand).toHaveLength(0);
    expect(next.players[P2]!.discard).toContain('opp-hand-1');
  });

  it('hampyre_lifesteal_on_attack: heals source player based on attack power', () => {
    let s = createMatch(deps, makeSetup()).state;
    const vampId = 'hampyre-inst';
    s = produce(s, (d) => {
      const inst = makeInstance(vampId, 'hampyre-night-pig-be42487', P1, 0);
      d.instances[vampId] = inst;
      d.players[P1]!.zones[0]!.creature = vampId;
      d.players[P1]!.lives = 10;
      d.players[P1]!.maxLives = 25;
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: vampId };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'hampyre_lifesteal_on_attack', source, undefined, undefined, { amount: 5 }, P1);
    });

    expect(next.players[P1]!.lives).toBe(15);
  });

  it('bloodshed_pitcher_mill_damage: mills 3 cards and deals 2 damage per discarded spell', () => {
    let s = createMatch(deps, makeSetup()).state;
    const targetC = 'target-creature-blood';
    s = produce(s, (d) => {
      d.instances[targetC] = makeInstance(targetC, 'c-target', P2, 0);
      d.players[P2]!.zones[0]!.creature = targetC;

      // 2 spells, 1 creature in deck
      d.players[P1]!.deck = ['spell-1', 'creature-1', 'spell-2'];
      d.instances['spell-1'] = makeInstance('spell-1', 'spell-plain', P1, null, null);
      d.instances['creature-1'] = makeInstance('creature-1', 'vanilla-swamp', P1, null, null);
      d.instances['spell-2'] = makeInstance('spell-2', 'spell-plain', P1, null, null);
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: null };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'bloodshed_pitcher_mill_damage', source, undefined, [
        { kind: 'creature', instanceId: targetC },
      ], undefined, P1);
    });

    expect(next.players[P1]!.discard).toEqual(['spell-1', 'creature-1', 'spell-2']);
    // 2 spells * 2 = 4 damage
    expect(next.instances[targetC]!.damage).toBe(4);
  });

  it('enter_move_to_empty: moves creature to empty opponent land and switches controller', () => {
    let s = createMatch(deps, makeSetup()).state;
    const paraId = 'parachutist-inst';
    s = produce(s, (d) => {
      const inst = makeInstance(paraId, 'vanilla-swamp', P1, 0);
      d.instances[paraId] = inst;
      d.players[P1]!.zones[0]!.creature = paraId;
      // P2 has zone 0 occupied, zone 1 empty
      d.players[P2]!.zones[0]!.creature = 'p2-creature';
      d.instances['p2-creature'] = makeInstance('p2-creature', 'vanilla-corn', P2, 0);
    });

    const { ctx } = createTestCtx();
    const source: EffectSource = { player: P1, instanceId: paraId };
    const next = produce(s, (draft) => {
      runMechanic(draft, ctx, 'enter_move_to_empty', source, undefined, undefined, undefined, P1);
    });

    // P1 zone 0 should now be empty
    expect(next.players[P1]!.zones[0]!.creature).toBeNull();
    // Parachutist jumped to P2's empty zone (zone 1)
    expect(next.players[P2]!.zones[1]!.creature).toBe(paraId);
    expect(next.instances[paraId]!.controller).toBe(P2);
    expect(next.instances[paraId]!.zone).toBe(1);
  });

  it('combat direct damage applies attackPowerMod with multiplier', () => {
    const { state } = createMatch(deps, makeSetup());
    const r1 = applyCommand(state, { type: 'keep_hand', player: P1 }, deps);
    const r2 = r1.ok ? applyCommand(r1.state, { type: 'keep_hand', player: P2 }, deps) : r1;
    let s = r2.ok ? r2.state : state;

    const attackerId = 'atk-mod-inst';
    s = produce(s, (d: MatchState) => {
      // atk-mod-creature has base ATK 2, multiplier 3
      const inst = makeInstance(attackerId, 'atk-mod-creature', P2, 0);
      d.instances[attackerId] = inst;
      d.players[P2]!.zones[0]!.creature = attackerId;
      d.players[P1]!.lives = 25;
      // P1 mirror zone 3 is empty
      d.players[P1]!.zones[3]!.creature = null;
    });

    // Round 1: P1 goes battle (does not attack)
    const r3 = applyCommand(s, { type: 'go_battle', player: P1 }, deps);
    s = r3.ok ? r3.state : s;
    // Round 1: P2 (last player) attacks: zone 0 strikes mirror zone 3 (empty) for 2 * 3 = 6 direct damage
    const res = applyCommand(s, { type: 'go_battle', player: P2 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[P1]!.lives).toBe(25 - 6);
  });
});
