import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from '../index';
import { catalog, defaultConfig, forceToHand, handCardId, P1 } from './helpers';
import { startedMatch } from './engine.test';

const deps = { config: defaultConfig, catalog };

function ok(s: ReturnType<typeof startedMatch>, cmd: Command) {
  const res = applyCommand(s, cmd, deps);
  if (!res.ok) throw new Error(`${cmd.type}: ${res.rejected.code} — ${res.rejected.message}`);
  return res.state;
}

function fail(s: ReturnType<typeof startedMatch>, cmd: Command, code: string) {
  const res = applyCommand(s, cmd, deps);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.rejected.code).toBe(code);
}

describe('розыгрыш карт', () => {
  it('оплачивает стоимость действиями', () => {
    let s = startedMatch();
    s = forceToHand(s, P1, 'big-swamp'); // cost 2
    s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'big-swamp'), zone: 0 });
    expect(s.players[P1]!.actions).toBe(0);
    fail(
      s,
      { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 1 },
      'insufficient_actions',
    );
  });

  it('требует землю нужного типа', () => {
    let s = startedMatch();
    // p1: все земли — болото (без радужной), vanilla-good требует good
    s = produce(s, (d) => {
      d.players[P1]!.lands.forEach((land) => {
        land.type = 'swamp';
      });
    });
    s = forceToHand(s, P1, 'vanilla-good');
    fail(
      s,
      { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-good'), zone: 0 },
      'land_requirement_not_met',
    );
    // радужная земля подходит под любой тип — вернём одну радужной
    s = produce(s, (d) => {
      d.players[P1]!.lands[0]!.type = 'rainbow';
    });
    s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-good'), zone: 0 });
    expect(s.players[P1]!.zones[0]!.creature).not.toBeNull();
  });

  it('при включённой настройке anyLand разрешает разыгрывать карты без земель нужного типа', () => {
    let s = startedMatch();
    s = produce(s, (d) => {
      d.anyLand = true;
      d.players[P1]!.lands.forEach((land) => {
        land.type = 'swamp';
      });
    });
    s = forceToHand(s, P1, 'vanilla-good');
    s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-good'), zone: 0 });
    expect(s.players[P1]!.zones[0]!.creature).not.toBeNull();
  });

  it('перевёрнутая земля не считается типом; радужная подходит под любой тип', () => {
    let s = startedMatch();
    s = produce(s, (d) => {
      d.players[P1]!.lands.forEach((land) => {
        land.flipped = true;
      });
    });
    fail(
      s,
      { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 },
      'land_requirement_not_met',
    );
    // rainbow card is fine while at least one land is not flipped — all flipped here, so also rejected
    s = forceToHand(s, P1, 'cheap-rainbow');
    fail(
      s,
      { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'cheap-rainbow'), zone: 0 },
      'land_requirement_not_met',
    );
    s = produce(s, (d) => {
      d.players[P1]!.lands[3]!.flipped = false; // rainbow land unflipped
    });
    s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'cheap-rainbow'), zone: 0 });
    expect(s.players[P1]!.zones[0]!.creature).not.toBeNull();
  });

  it('существо и строение занимают разные слоты одной зоны', () => {
    let s = startedMatch();
    s = forceToHand(s, P1, 'plain-fortress');
    s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'plain-fortress'), zone: 0 });
    s = ok(s, { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'vanilla-swamp'), zone: 0 });
    expect(s.players[P1]!.zones[0]!.building).not.toBeNull();
    expect(s.players[P1]!.zones[0]!.creature).not.toBeNull();
  });

  it('замена: старая карта уходит в сброс без смерти', () => {
    let s = startedMatch();
    s = forceToHand(s, P1, 'vanilla-swamp');
    const first = handCardId(s, P1, 'vanilla-swamp');
    s = ok(s, { type: 'play_card', player: P1, instanceId: first, zone: 0 });
    s = forceToHand(s, P1, 'vanilla-swamp');
    const second = handCardId(s, P1, 'vanilla-swamp');
    const res = applyCommand(s, { type: 'play_card', player: P1, instanceId: second, zone: 0 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[P1]!.zones[0]!.creature).toBe(second);
    expect(res.state.instances[first]!.location).toBe('discard');
    expect(res.events).toContainEqual({
      type: 'card_discarded',
      player: P1,
      instanceId: first,
      cardId: 'vanilla-swamp',
      from: 'field',
    });
    expect(res.events.some((e) => e.type === 'creature_destroyed')).toBe(false);
  });

  it('замороженная земля: розыгрыш только после сброса карты с руки', () => {
    let s = startedMatch();
    // мороз ставится тест-манипуляцией (заморозка даётся способностями — docs/TECH.md № 2)
    s = produce(s, (d) => {
      d.players[P1]!.lands[0]!.frozen = true;
    });
    // ход p1: без сброса — отказ
    s = forceToHand(s, P1, 'vanilla-swamp');
    const target = handCardId(s, P1, 'vanilla-swamp');
    const sacrifice = s.players[P1]!.hand.find((i) => i !== target)!;
    fail(s, { type: 'play_card', player: P1, instanceId: target, zone: 0 }, 'land_frozen');
    // со сбросом — мороз снят, карта сыграна
    s = ok(s, { type: 'play_card', player: P1, instanceId: target, zone: 0, unfreezeWith: sacrifice });
    expect(s.players[P1]!.lands[0]!.frozen).toBe(false);
    expect(s.instances[sacrifice]!.location).toBe('discard');
    expect(s.players[P1]!.zones[0]!.creature).toBe(target);
  });

  it('отдельный сброс с руки снимает мороз с указанной земли', () => {
    let s = startedMatch();
    s = produce(s, (d) => {
      d.players[P1]!.lands[1]!.frozen = true;
    });
    const card = s.players[P1]!.hand[0]!;
    fail(
      s,
      { type: 'discard_from_hand', player: P1, instanceId: card, unfreezeZone: 2 },
      'zone_not_frozen',
    );
    s = ok(s, { type: 'discard_from_hand', player: P1, instanceId: card, unfreezeZone: 1 });
    expect(s.players[P1]!.lands[1]!.frozen).toBe(false);
    expect(s.instances[card]!.location).toBe('discard');
  });

  it('сброс своей карты с поля', () => {
    let s = startedMatch();
    s = forceToHand(s, P1, 'vanilla-swamp');
    const id = handCardId(s, P1, 'vanilla-swamp');
    s = ok(s, { type: 'play_card', player: P1, instanceId: id, zone: 2 });
    s = ok(s, { type: 'discard_from_field', player: P1, instanceId: id });
    expect(s.players[P1]!.zones[2]!.creature).toBeNull();
    expect(s.instances[id]!.location).toBe('discard');
  });

  it('парные карты в этом режиме играть нельзя', () => {
    let s = startedMatch();
    s = produce(s, (d) => {
      const p = d.players[P1]!;
      const deckId = p.deck[0]!;
      p.deck.splice(0, 1);
      d.instances[deckId]!.cardId = 'companion-pair';
      d.instances[deckId]!.location = 'hand';
      p.hand.push(deckId);
    });
    fail(
      s,
      { type: 'play_card', player: P1, instanceId: handCardId(s, P1, 'companion-pair'), zone: 0 },
      'invalid_card_type',
    );
  });
});
