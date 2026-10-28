import type { CardData, CardType, LandType } from '@card-wars/domain';

/** Deterministic MVP preset builder: 10 distinct cards × 4 copies around a land theme. */
export function buildPreset(
  cards: CardData[],
  id: string,
  heroId: string,
  theme: LandType,
): { id: string; heroId: string; lands: LandType[]; deck: string[] } {
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
    for (const card of pool) {
      if (added >= count) break;
      if (card.type === type && !chosen.includes(card.id)) {
        chosen.push(card.id);
        added++;
      }
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
  return { id, heroId, lands: [theme, theme, theme, 'rainbow'], deck };
}
