import { useMemo, useState } from 'react';
import { CONFIG } from '@card-wars/protocol';
import { LAND_TYPES, cards, heroes, type CardData, type LandType } from '@card-wars/content';
import { loadFavorites, saveFavorites, validateSavedDeck, type SavedDeck } from '../decks';

const TYPE_RU: Record<CardData['type'], string> = {
  creature: 'существо',
  building: 'строение',
  spell: 'заклинание',
  companion: 'парная',
};

const LAND_RU: Record<LandType, string> = {
  corn: 'кукуруза',
  blue: 'синий',
  good: 'добрый',
  ice: 'лёд',
  sand: 'песок',
  swamp: 'болото',
  rainbow: 'радужная',
};

type TypeFilter = 'all' | CardData['type'];
type CostFilter = 'all' | '0' | '1' | '2' | '3+';

export function DeckEditor({
  deck,
  onSave,
  onClose,
}: {
  deck: SavedDeck;
  onSave: (deck: SavedDeck) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SavedDeck>(() => ({
    ...deck,
    lands: [...deck.lands],
    cards: [...deck.cards],
  }));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [costFilter, setCostFilter] = useState<CostFilter>('all');
  const [landFilter, setLandFilter] = useState<'all' | LandType>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showCompanions, setShowCompanions] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [hovered, setHovered] = useState<CardData | null>(null);

  const errors = validateSavedDeck(draft);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const id of draft.cards) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, [draft.cards]);

  const filtered = useMemo(() => {
    return cards.filter((card) => {
      if (card.type === 'companion' && !showCompanions) return false;
      if (typeFilter !== 'all' && card.type !== typeFilter) return false;
      if (landFilter !== 'all' && card.landType !== landFilter) return false;
      if (costFilter === '0' && card.cost !== 0) return false;
      if (costFilter === '1' && card.cost !== 1) return false;
      if (costFilter === '2' && card.cost !== 2) return false;
      if (costFilter === '3+' && card.cost < 3) return false;
      if (favoritesOnly && !favorites.has(card.id)) return false;
      return true;
    });
  }, [typeFilter, costFilter, landFilter, favoritesOnly, showCompanions, favorites]);

  const addCard = (card: CardData) => {
    if (draft.cards.length >= CONFIG.deckSize) return;
    if ((counts.get(card.id) ?? 0) >= CONFIG.copyLimit) return;
    setDraft((d) => ({ ...d, cards: [...d.cards, card.id] }));
  };

  const removeCard = (cardId: string) => {
    setDraft((d) => {
      const index = d.cards.lastIndexOf(cardId);
      if (index < 0) return d;
      const next = [...d.cards];
      next.splice(index, 1);
      return { ...d, cards: next };
    });
  };

  const toggleFavorite = (cardId: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      saveFavorites(next);
      return next;
    });
  };

  const setLand = (index: number, type: LandType) => {
    setDraft((d) => {
      const lands = [...d.lands];
      lands[index] = type;
      return { ...d, lands };
    });
  };

  const save = () => {
    if (errors.length > 0) return;
    onSave({ ...draft, name: draft.name.trim(), cards: [...draft.cards], lands: [...draft.lands] });
  };

  return (
    <div className="editor-screen">
      <div className="editor-head">
        <button className="mini" onClick={onClose}>
          ← Назад
        </button>
        <input
          className="deck-name"
          value={draft.name}
          maxLength={40}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        <span className={draft.cards.length === CONFIG.deckSize ? 'count-ok' : 'hint'}>
          {draft.cards.length} / {CONFIG.deckSize} карт
        </span>
        <button disabled={errors.length > 0} onClick={save}>
          Сохранить
        </button>
      </div>

      {errors.length > 0 && (
        <div className="deck-errors">
          {errors.map((error) => (
            <div key={error} className="error-line">
              {error}
            </div>
          ))}
        </div>
      )}

      <div className="editor-body">
        <aside className="deck-panel panel">
          <h3>Герой</h3>
          <select value={draft.heroId} onChange={(e) => setDraft((d) => ({ ...d, heroId: e.target.value }))}>
            {heroes.map((hero) => (
              <option key={hero.id} value={hero.id}>
                {hero.name}
              </option>
            ))}
          </select>
          <p className="hint">{heroes.find((h) => h.id === draft.heroId)?.ability.text}</p>

          <h3>Земли</h3>
          <div className="lands-row">
            {Array.from({ length: CONFIG.landsPerPlayer }, (_, i) => (
              <select key={i} value={draft.lands[i] ?? 'rainbow'} onChange={(e) => setLand(i, e.target.value as LandType)}>
                {LAND_TYPES.map((land) => (
                  <option key={land} value={land}>
                    {LAND_RU[land]}
                  </option>
                ))}
              </select>
            ))}
          </div>

          <h3>Колода</h3>
          <div className="deck-list">
            {[...counts.entries()].map(([cardId, count]) => {
              const card = cards.find((c) => c.id === cardId);
              if (!card) return null;
              return (
                <div key={cardId} className="deck-row" onMouseEnter={() => setHovered(card)}>
                  <span>
                    {card.name} <span className="hint">({count})</span>
                  </span>
                  <button className="mini" onClick={() => removeCard(cardId)}>
                    −
                  </button>
                </div>
              );
            })}
            {draft.cards.length === 0 && <p className="hint">Добавьте карты из каталога справа</p>}
          </div>
        </aside>

        <section className="catalog-panel">
          <div className="filters">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}>
              <option value="all">все типы</option>
              <option value="creature">существа</option>
              <option value="building">строения</option>
              <option value="spell">заклинания</option>
              <option value="companion">парные</option>
            </select>
            <select value={costFilter} onChange={(e) => setCostFilter(e.target.value as CostFilter)}>
              <option value="all">любая стоимость</option>
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3+">3+</option>
            </select>
            <select value={landFilter} onChange={(e) => setLandFilter(e.target.value as 'all' | LandType)}>
              <option value="all">любая земля</option>
              {LAND_TYPES.map((land) => (
                <option key={land} value={land}>
                  {LAND_RU[land]}
                </option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} />
              избранные
            </label>
            <label className="check">
              <input type="checkbox" checked={showCompanions} onChange={(e) => setShowCompanions(e.target.checked)} />
              парные (2 на 2)
            </label>
          </div>

          <div className="catalog-grid">
            {filtered.map((card) => {
              const count = counts.get(card.id) ?? 0;
              const favorite = favorites.has(card.id);
              return (
                <div
                  key={card.id}
                  className={`catalog-card ${count > 0 ? 'in-deck' : ''}`}
                  onMouseEnter={() => setHovered(card)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <button className="catalog-add" disabled={count >= CONFIG.copyLimit} onClick={() => addCard(card)}>
                    <span className="catalog-name">{card.name}</span>
                    <span className="hint">
                      {TYPE_RU[card.type]} · {card.cost}д · {LAND_RU[card.landType]}
                      {card.type === 'creature' ? ` · ${card.attack ?? '—'}/${card.defense ?? '—'}` : ''}
                    </span>
                    {count > 0 && <span className="catalog-count">{count}</span>}
                  </button>
                  <div className="catalog-buttons">
                    <button className={`mini ${favorite ? 'fav' : ''}`} onClick={() => toggleFavorite(card.id)}>
                      ★
                    </button>
                    <button className="mini" disabled={count === 0} onClick={() => removeCard(card.id)}>
                      −
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {hovered && <CardPreview card={hovered} />}
    </div>
  );
}

function CardPreview({ card }: { card: CardData }) {
  return (
    <div className="card-preview panel">
      <b>{card.name}</b>
      <div className="hint">
        {TYPE_RU[card.type]} · стоимость {card.cost} · {LAND_RU[card.landType]}
      </div>
      {card.type === 'creature' && (
        <div>
          АТК {card.attack ?? '—'} / ЗАЩ {card.defense ?? '—'}
        </div>
      )}
      {card.abilities.map((ability, i) => (
        <div key={i} className="hint">
          {ability.kind === 'floop' ? 'ПРИЁМ' : 'Пассивно'}: {ability.text}
        </div>
      ))}
      {card.description && <p className="hint">{card.description}</p>}
    </div>
  );
}
