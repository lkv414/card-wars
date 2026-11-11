import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { runMechanic } from '../mechanics/registry';
import { createMatch } from '../index';
import { defaultConfig, catalog, makeSetup, P1, P2 } from './helpers';
import type { EffectSource } from '../mechanics/source';
import type { Ctx } from '../util';
import type { CardInstance } from '../types';
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
});
