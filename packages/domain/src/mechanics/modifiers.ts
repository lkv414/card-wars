import { instance } from '../util';
import type { Ctx } from '../util';
import type { MatchState } from '../types';
import { resolveTarget } from './resolve';
import type { EffectSource } from './source';
import type { AbilitySpec, StatKey } from './types';

export interface AuraContribution {
  stat: StatKey;
  amount: number;
}

/**
 * Aura scan (docs/MECHANICS-V2.md §2А): every in-play card + hero whose
 * modifier passive (no trigger, stat_buff aura) currently covers the queried
 * instance. Computed at the point of use — replacements, deaths and condition
 * changes apply immediately, nothing is persisted.
 */
export function auraContributions(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  forInstanceId: string,
): AuraContribution[] {
  const out: AuraContribution[] = [];
  forSource(draft, ctx, (source, ability, _payload) => {
    if (ability.kind !== 'passive' || ability.trigger !== undefined) return;
    const effect = ability.effect;
    if (!effect || effect.op !== 'stat_buff' || effect.duration !== 'aura') return;
    if (!conditionsHold(draft, source, ability)) return;
    const targets = resolveTarget(draft, ctx, effect.target, source, undefined);
    if (targets.some((t) => t.kind === 'creature' && t.instanceId === forInstanceId)) {
      out.push({ stat: effect.stat, amount: effect.amount });
    }
  });
  return out;
}

/** Run `fn` for every ability of every live source (field instances + heroes). */
export function forSource(
  draft: MatchState,
  ctx: Pick<Ctx, 'config' | 'catalog'>,
  fn: (source: EffectSource, ability: AbilitySpec, abilityIndex: number) => void,
): void {
  for (const pid of draft.order) {
    const p = draft.players[pid]!;
    for (const zone of p.zones) {
      for (const id of [zone.creature, zone.building]) {
        if (!id) continue;
        const inst = instance(draft, id);
        const card = ctx.catalog.getCard(inst.cardId);
        if (!card?.abilities) continue;
        const source: EffectSource = { player: pid, instanceId: id };
        card.abilities.forEach((ability, abilityIndex) => fn(source, ability, abilityIndex));
      }
    }
    if (p.companion) {
      const inst = instance(draft, p.companion);
      const card = ctx.catalog.getCard(inst.cardId);
      if (card?.abilities) {
        const source: EffectSource = { player: pid, instanceId: p.companion };
        card.abilities.forEach((ability, abilityIndex) => fn(source, ability, abilityIndex));
      }
    }
    const hero = ctx.catalog.getHero(p.heroId);
    if (hero?.ability) {
      fn({ player: pid, instanceId: null }, hero.ability, 0);
    }
  }
}

/** `if_*`/`while_*` conditions against the current board (docs/MECHANICS-V2.md §7). */
export function conditionsHold(
  draft: MatchState,
  source: EffectSource,
  ability: Pick<AbilitySpec, 'conditions'>,
): boolean {
  if (!ability.conditions) return true;
  const p = draft.players[source.player]!;
  for (const cond of ability.conditions) {
    if (
      (cond.kind === 'if_discard_count' || cond.kind === 'while_discard_count') &&
      p.discard.length < cond.min
    ) {
      return false;
    }
  }
  return true;
}
