import type { CardData, CardType, LandType } from '@card-wars/domain';

/** Deterministic MVP preset builder: 10 distinct cards × 4 copies around a land theme. */
export function buildPreset(
  cards: CardData[],
  id: string,
  heroId: string,
  theme: LandType,
): { id: string; heroId: string; lands: LandType[]; deck: string[] } {
  const isPlayerSpell = (c: CardData): boolean =>
    c.type === 'spell' &&
    (c.abilities?.[0]?.targets ?? []).some((t) => t.kind === 'any_player' || t.kind === 'opponent_player');

  const pool = cards
    .filter((c) => c.type !== 'companion' && (c.landType === theme || c.landType === 'rainbow'))
    // theme cards first so two different themes produce different decks
    .sort(
      (a, b) =>
        Number(a.landType !== theme) - Number(b.landType !== theme) ||
        a.cost - b.cost ||
        a.id.localeCompare(b.id),
    );
  const chosen: string[] = [];
  const addType = (type: CardType, count: number): void => {
    let added = 0;
    const candidates = pool.filter((c) => c.type === type && !chosen.includes(c.id));
    if (type === 'spell') {
      candidates.sort((a, b) => {
        const themeDiff = Number(a.landType !== theme) - Number(b.landType !== theme);
        if (themeDiff !== 0) return themeDiff;
        const aPlay = isPlayerSpell(a);
        const bPlay = isPlayerSpell(b);
        if (aPlay && !bPlay) return -1;
        if (!aPlay && bPlay) return 1;
        return a.cost - b.cost || a.id.localeCompare(b.id);
      });
    }
    for (const card of candidates) {
      if (added >= count) break;
      chosen.push(card.id);
      added++;
    }
  };
  addType('creature', 6);
  addType('building', 2);
  addType('spell', 2);
  for (const card of pool) {
    if (chosen.length >= 10) break;
    if (!chosen.includes(card.id)) chosen.push(card.id);
  }
  const deck: string[] = [];
  for (let copy = 0; copy < 4; copy++) deck.push(...chosen.slice(0, 10));
  return { id, heroId, lands: [theme, theme, theme, theme], deck };
}
