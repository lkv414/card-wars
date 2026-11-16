import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CONFIG } from '@card-wars/protocol';
import { LAND_TYPES, cards, heroes, type CardData, type LandType } from '@card-wars/content';
import {
  generateRandomDeck,
  loadFavorites,
  saveFavorites,
  validateSavedDeck,
  type SavedDeck,
} from '../decks';
import { CATALOG_ZOOM_SCALE, DECK_ZOOM_SCALE, computeZoomOrigin } from './cardZoom';
import { LAND_META, landImageUrl } from './landImages';

export type SortBy = 'default' | 'cost' | 'name' | 'type' | 'attack' | 'defense';
export type CostFilter = 'all' | '0' | '1' | '2' | '3+';
export type AtkFilter = 'all' | '0-2' | '3-4' | '5+';
export type DefFilter = 'all' | '1-3' | '4-6' | '7+';
export type BaseCardType = 'creature' | 'building' | 'spell';

const BASE_TYPES: Array<{ value: BaseCardType; label: string }> = [
  { value: 'creature', label: 'Существа' },
  { value: 'building', label: 'Строения' },
  { value: 'spell', label: 'Заклинания' },
];

const LAND_FILTER_BUTTONS: Array<{ type: LandType; label: string; icon: string }> = [
  { type: 'corn', label: 'Кукуруза', icon: '🌽' },
  { type: 'blue', label: 'Равнины', icon: '💧' },
  { type: 'good', label: 'Добрые', icon: '🌸' },
  { type: 'ice', label: 'Ледяные', icon: '❄️' },
  { type: 'sand', label: 'Песчаные', icon: '🏜️' },
  { type: 'swamp', label: 'Болота', icon: '🍄' },
  { type: 'rainbow', label: 'Радуга', icon: '🌈' },
  { type: 'lava', label: 'Лавовые', icon: '🌋' },
];

const LAND_ORDER: Record<LandType, number> = Object.fromEntries(
  LAND_TYPES.map((lt, i) => [lt, i]),
) as Record<LandType, number>;

const TYPE_RANK: Record<CardData['type'], number> = {
  creature: 0,
  building: 1,
  spell: 2,
  companion: 3,
};

const HOLD_ZOOM_DELAY_MS = 180;
const HOLD_MOVE_TOLERANCE_PX = 10;
const INITIAL_CHUNK = 48;
const CHUNK_SIZE = 36;

function hasFloop(card: CardData): boolean {
  if (card.abilities?.some((a) => a.kind === 'active')) return true;
  if (!card.description) return false;
  return /при[её]м|флюп|floop/i.test(card.description);
}

const cardById = new Map(cards.map((c) => [c.id, c]));

export const DEFAULT_EDITOR_DRAFT_KEY = 'cw-editor-draft';

export function loadEditorDraft(storageKey = DEFAULT_EDITOR_DRAFT_KEY): SavedDeck | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedDeck>;
    if (
      typeof parsed?.id === 'string' &&
      typeof parsed?.name === 'string' &&
      typeof parsed?.heroId === 'string' &&
      Array.isArray(parsed?.lands) &&
      Array.isArray(parsed?.cards)
    ) {
      return {
        id: parsed.id,
        name: parsed.name,
        heroId: parsed.heroId,
        lands: parsed.lands as LandType[],
        cards: parsed.cards as string[],
      };
    }
  } catch {
    // ignore invalid sessionStorage draft
  }
  return null;
}

export function clearEditorDraft(storageKey = DEFAULT_EDITOR_DRAFT_KEY): void {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // ignore storage error
  }
}

export function DeckEditor({
  deck,
  onSave,
  onClose,
  storageKey = DEFAULT_EDITOR_DRAFT_KEY,
}: {
  deck: SavedDeck;
  onSave: (deck: SavedDeck) => void;
  onClose: () => void;
  storageKey?: string;
}) {
  const [draft, setDraft] = useState<SavedDeck>(() => ({
    ...deck,
    lands: [...deck.lands],
    cards: [...deck.cards],
  }));

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      // ignore storage quota errors
    }
  }, [draft, storageKey]);

  // Filters state
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('default');
  const [selectedTypes, setSelectedTypes] = useState<BaseCardType[]>([]);
  const [costFilter, setCostFilter] = useState<CostFilter>('all');
  const [selectedLands, setSelectedLands] = useState<LandType[]>([]);
  const [onlyMyLands, setOnlyMyLands] = useState(false);
  const [atkFilter, setAtkFilter] = useState<AtkFilter>('all');
  const [defFilter, setDefFilter] = useState<DefFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [floopOnly, setFloopOnly] = useState(false);
  const [showCompanions, setShowCompanions] = useState(() =>
    deck.cards.some((id) => cardById.get(id)?.type === 'companion'),
  );
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());

  // Infinite scroll pagination
  const [visibleCount, setVisibleCount] = useState(INITIAL_CHUNK);

  // Deck view mode in right column: 'grid' (40 slots) vs 'list' (grouped by unique cards)
  const [deckViewMode, setDeckViewMode] = useState<'grid' | 'list'>('grid');

  // UI modals and drawers
  const [openLandSlot, setOpenLandSlot] = useState<number | null>(null);
  const [dragLandSlot, setDragLandSlot] = useState<number | null>(null);
  const [dragOverLandSlot, setDragOverLandSlot] = useState<number | null>(null);
  const [drawerRightOpen, setDrawerRightOpen] = useState(false);
  const [drawerLeftOpen, setDrawerLeftOpen] = useState(false);
  const [landsMenuOpen, setLandsMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReroll, setConfirmReroll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const catalogScrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Keyboard navigation: Escape key closes active drawers, pickers, and modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmClear) {
          setConfirmClear(false);
          return;
        }
        if (confirmReroll) {
          setConfirmReroll(false);
          return;
        }
        if (openLandSlot !== null) {
          setOpenLandSlot(null);
          return;
        }
        if (drawerLeftOpen) {
          setDrawerLeftOpen(false);
          return;
        }
        if (drawerRightOpen) {
          setDrawerRightOpen(false);
          return;
        }
        if (landsMenuOpen) {
          setLandsMenuOpen(false);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmClear, confirmReroll, openLandSlot, drawerLeftOpen, drawerRightOpen, landsMenuOpen]);

  const errors = validateSavedDeck(draft);
  const hero = heroes.find((h) => h.id === draft.heroId) ?? heroes[0];

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const id of draft.cards) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, [draft.cards]);

  const hasActiveFilters =
    search.trim().length > 0 ||
    selectedTypes.length > 0 ||
    costFilter !== 'all' ||
    selectedLands.length > 0 ||
    onlyMyLands ||
    atkFilter !== 'all' ||
    defFilter !== 'all' ||
    favoritesOnly ||
    floopOnly ||
    showCompanions;

  const resetFilters = useCallback(() => {
    setSearch('');
    setSelectedTypes([]);
    setCostFilter('all');
    setSelectedLands([]);
    setOnlyMyLands(false);
    setAtkFilter('all');
    setDefFilter('all');
    setFavoritesOnly(false);
    setFloopOnly(false);
    setShowCompanions(false);
  }, []);

  const toggleType = useCallback((t: BaseCardType) => {
    setSelectedTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }, []);

  const toggleLandFilter = useCallback((type: LandType) => {
    setSelectedLands((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const myLandsSet = onlyMyLands ? new Set<LandType>([...draft.lands, 'rainbow']) : null;

    const list = cards.filter((card) => {
      if (card.type === 'companion' && !showCompanions) return false;
      if (selectedTypes.length > 0 && card.type !== 'companion' && !selectedTypes.includes(card.type)) {
        return false;
      }
      if (selectedTypes.length > 0 && card.type === 'companion' && !showCompanions) {
        return false;
      }
      if (costFilter === '0' && card.cost !== 0) return false;
      if (costFilter === '1' && card.cost !== 1) return false;
      if (costFilter === '2' && card.cost !== 2) return false;
      if (costFilter === '3+' && card.cost < 3) return false;

      // Land filters
      if (myLandsSet && !myLandsSet.has(card.landType)) return false;
      if (selectedLands.length > 0 && !selectedLands.includes(card.landType)) return false;

      // Creature stat filters
      if (atkFilter !== 'all') {
        if (card.type !== 'creature' || typeof card.attack !== 'number') return false;
        if (atkFilter === '0-2' && (card.attack < 0 || card.attack > 2)) return false;
        if (atkFilter === '3-4' && (card.attack < 3 || card.attack > 4)) return false;
        if (atkFilter === '5+' && card.attack < 5) return false;
      }
      if (defFilter !== 'all') {
        if (card.type !== 'creature' || typeof card.defense !== 'number') return false;
        if (defFilter === '1-3' && (card.defense < 1 || card.defense > 3)) return false;
        if (defFilter === '4-6' && (card.defense < 4 || card.defense > 6)) return false;
        if (defFilter === '7+' && card.defense < 7) return false;
      }

      if (favoritesOnly && !favorites.has(card.id)) return false;
      if (floopOnly && !hasFloop(card)) return false;
      if (q) {
        const hay = `${card.name} ${card.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      if (sortBy === 'cost') {
        return a.cost - b.cost || a.name.localeCompare(b.name, 'ru');
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, 'ru');
      }
      if (sortBy === 'type') {
        return (
          TYPE_RANK[a.type] - TYPE_RANK[b.type] ||
          a.cost - b.cost ||
          a.name.localeCompare(b.name, 'ru')
        );
      }
      if (sortBy === 'attack') {
        const aAtk = a.attack ?? -1;
        const bAtk = b.attack ?? -1;
        return bAtk - aAtk || a.cost - b.cost || a.name.localeCompare(b.name, 'ru');
      }
      if (sortBy === 'defense') {
        const aDef = a.defense ?? -1;
        const bDef = b.defense ?? -1;
        return bDef - aDef || a.cost - b.cost || a.name.localeCompare(b.name, 'ru');
      }
      // 'default': by landType order, then cost, then Russian name localeCompare
      const landDiff = (LAND_ORDER[a.landType] ?? 99) - (LAND_ORDER[b.landType] ?? 99);
      if (landDiff !== 0) return landDiff;
      const costDiff = a.cost - b.cost;
      if (costDiff !== 0) return costDiff;
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [
    search,
    sortBy,
    selectedTypes,
    costFilter,
    selectedLands,
    onlyMyLands,
    draft.lands,
    atkFilter,
    defFilter,
    favoritesOnly,
    floopOnly,
    showCompanions,
    favorites,
  ]);

  // Reset infinite scroll pagination when filters, search, or sort change
  useEffect(() => {
    setVisibleCount(INITIAL_CHUNK);
  }, [
    search,
    sortBy,
    selectedTypes,
    costFilter,
    selectedLands,
    onlyMyLands,
    atkFilter,
    defFilter,
    favoritesOnly,
    floopOnly,
    showCompanions,
  ]);

  const visibleCards = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // IntersectionObserver for chunked pagination inside catalog grid
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (visibleCount >= filtered.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + CHUNK_SIZE, filtered.length));
        }
      },
      { root: catalogScrollRef.current, rootMargin: '200px', threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filtered.length, visibleCount]);

  const addCard = useCallback(
    (card: CardData) => {
      const currentCount = counts.get(card.id) ?? 0;
      if (currentCount >= CONFIG.copyLimit) {
        showToast(`Максимум ${CONFIG.copyLimit} копии карты «${card.name}»`);
        return;
      }
      if (draft.cards.length >= CONFIG.deckSize) {
        showToast(`В колоде уже ${CONFIG.deckSize} из ${CONFIG.deckSize} карт`);
        return;
      }
      setDraft((d) => ({ ...d, cards: [...d.cards, card.id] }));
    },
    [counts, draft.cards.length, showToast],
  );

  const removeCardAtIndex = useCallback((index: number) => {
    setDraft((d) => {
      if (index < 0 || index >= d.cards.length) return d;
      const next = [...d.cards];
      next.splice(index, 1);
      return { ...d, cards: next };
    });
  }, []);

  const toggleFavorite = useCallback((cardId: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      saveFavorites(next);
      return next;
    });
  }, []);

  const setLand = useCallback((index: number, type: LandType) => {
    setDraft((d) => {
      const lands = [...d.lands];
      lands[index] = type;
      return { ...d, lands };
    });
    setOpenLandSlot(null);
  }, []);

  const swapLands = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setDraft((d) => {
      const lands = [...d.lands];
      const temp = lands[fromIndex]!;
      lands[fromIndex] = lands[toIndex]!;
      lands[toIndex] = temp;
      return { ...d, lands };
    });
  }, []);

  // Tap-to-swap lands on mobile & touch: tapping slot A then slot B swaps them
  const handleLandSlotClick = useCallback(
    (slotIndex: number) => {
      if (openLandSlot === null) {
        setOpenLandSlot(slotIndex);
      } else if (openLandSlot === slotIndex) {
        setOpenLandSlot(null);
      } else {
        swapLands(openLandSlot, slotIndex);
        showToast(`Земли #${openLandSlot + 1} и #${slotIndex + 1} поменялись местами`);
        setOpenLandSlot(null);
      }
    },
    [openLandSlot, swapLands, showToast],
  );

  // Random deck fill ("Случайный набор")
  const handleRandomFill = useCallback(() => {
    if (draft.cards.length >= CONFIG.deckSize) {
      setConfirmReroll(true);
      return;
    }
    const prevCount = draft.cards.length;
    const newCards = generateRandomDeck(draft.heroId, draft.lands, draft.cards);
    setDraft((d) => ({ ...d, cards: newCards }));
    const added = newCards.length - prevCount;
    showToast(added > 0 ? `Добавлено ${added} карт(ы)` : 'Колода уже полная');
  }, [draft.cards, draft.heroId, draft.lands, showToast]);

  const handleRerollConfirmed = useCallback(() => {
    const newCards = generateRandomDeck(draft.heroId, draft.lands, []);
    setDraft((d) => ({ ...d, cards: newCards }));
    setConfirmReroll(false);
    showToast(`Колода пересобрана (${newCards.length} карт)`);
  }, [draft.heroId, draft.lands, showToast]);

  // Save button: click always provides clear toast feedback when errors exist
  const save = useCallback(() => {
    if (errors.length > 0) {
      if (draft.cards.length < CONFIG.deckSize) {
        showToast(`Не хватает ${CONFIG.deckSize - draft.cards.length} карт до полной колоды`);
      } else {
        showToast(errors[0]!);
      }
      return;
    }
    onSave({
      ...draft,
      name: draft.name.trim(),
      cards: [...draft.cards],
      lands: [...draft.lands],
    });
  }, [draft, errors, onSave, showToast]);

  // Compute land variant numbers (1..4) so duplicate land types show distinct artwork scans.
  const landVariants = useMemo(() => {
    const seen = new Map<LandType, number>();
    return draft.lands.map((type) => {
      const next = (seen.get(type) ?? 0) + 1;
      seen.set(type, next);
      return next;
    });
  }, [draft.lands]);

  const deckSlots = useMemo(() => {
    return Array.from({ length: CONFIG.deckSize }, (_, index) => {
      const cardId = draft.cards[index];
      return cardId ? { index, card: cardById.get(cardId) ?? null, cardId } : { index, card: null, cardId: null };
    });
  }, [draft.cards]);

  // Grouped cards for List view mode
  const groupedDeck = useMemo(() => {
    const map = new Map<string, { card: CardData; count: number; indices: number[] }>();
    draft.cards.forEach((id, index) => {
      const existing = map.get(id);
      if (existing) {
        existing.count += 1;
        existing.indices.push(index);
      } else {
        const card = cardById.get(id);
        if (card) {
          map.set(id, { card, count: 1, indices: [index] });
        }
      }
    });
    return Array.from(map.values()).sort(
      (a, b) => a.card.cost - b.card.cost || a.card.name.localeCompare(b.card.name, 'ru'),
    );
  }, [draft.cards]);

  const isDeckFull = draft.cards.length === CONFIG.deckSize;

  return (
    <main className="cw-editor ui-v2">
      {toast && (
        <div className="cw-editor-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {(drawerLeftOpen || drawerRightOpen) && (
        <div
          className="cw-drawer-backdrop"
          onClick={() => {
            setDrawerLeftOpen(false);
            setDrawerRightOpen(false);
          }}
        />
      )}

      {/* LEFT COLUMN: Hero + Filters */}
      <aside className={`cw-editor-col cw-editor-left ui-card ${drawerLeftOpen ? 'is-drawer-open' : ''}`}>
        <div className="cw-drawer-head cw-drawer-head--left">
          <b>Герой и фильтры</b>
          <button
            type="button"
            className="cw-drawer-close"
            onClick={() => setDrawerLeftOpen(false)}
            aria-label="Закрыть фильтры"
          >
            ✕
          </button>
        </div>

        <div className="cw-hero-box">
          <div className="cw-hero-preview">
            {hero?.image ? (
              <img className="cw-hero-img" src={hero.image} alt={hero.name} draggable={false} fetchPriority="high" />
            ) : (
              <div className="cw-hero-fallback">
                <b>{hero?.name ?? 'Герой'}</b>
                {hero?.text && <p>{hero.text}</p>}
              </div>
            )}
          </div>
          <select
            className="cw-control cw-hero-select"
            value={draft.heroId}
            aria-label="Выбор героя"
            onChange={(e) => setDraft((d) => ({ ...d, heroId: e.target.value }))}
          >
            {heroes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div className="cw-filters-box">
          <input
            type="search"
            className="cw-control"
            placeholder="Поиск карты…"
            style={{ fontSize: '16px' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <label className="cw-filter-field">
            <span>Сортировка</span>
            <select
              className="cw-control"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
            >
              <option value="default">По умолчанию (земли)</option>
              <option value="cost">По стоимости</option>
              <option value="name">По алфавиту</option>
              <option value="type">По типу карты</option>
              <option value="attack">По атаке (убыв.)</option>
              <option value="defense">По защите (убыв.)</option>
            </select>
          </label>

          <label className="cw-filter-field">
            <span>Стоимость</span>
            <select
              className="cw-control"
              value={costFilter}
              onChange={(e) => setCostFilter(e.target.value as CostFilter)}
            >
              <option value="all">Любая стоимость</option>
              <option value="0">0 действий</option>
              <option value="1">1 действие</option>
              <option value="2">2 действия</option>
              <option value="3+">3 и более действий</option>
            </select>
          </label>

          {/* Land Filters: 8 Lands + "Только мои земли" */}
          <div className="cw-land-filter" role="group" aria-label="Фильтры по землям">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--ui-muted)' }}>Земли</span>
              <button
                type="button"
                className={`cw-filter-chip ${onlyMyLands ? 'is-active is-on' : ''}`}
                aria-pressed={onlyMyLands}
                onClick={() => setOnlyMyLands((v) => !v)}
                title="Показывать только карты, подходящие под 4 земли колоды + радугу"
                style={{ fontSize: '11px', padding: '3px 8px' }}
              >
                {onlyMyLands ? '✓ Мои земли' : 'Только мои земли'}
              </button>
            </div>
            <div className="cw-filter-chips-grid">
              {LAND_FILTER_BUTTONS.map(({ type, label, icon }) => {
                const active = selectedLands.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    className={`cw-filter-chip ${active ? 'is-active is-on' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggleLandFilter(type)}
                    title={`${icon} ${label}`}
                  >
                    <span>{icon}</span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Creature Stat Filters (Attack & Defense) */}
          <div className="cw-stat-filters" role="group" aria-label="Фильтры существ по характеристикам">
            <div className="cw-stat-row">
              <span className="cw-stat-label" title="Атака существ">⚔️</span>
              <div className="cw-stat-chip-group" role="radiogroup" aria-label="Атака">
                {(['all', '0-2', '3-4', '5+'] as const).map((range) => (
                  <button
                    key={range}
                    type="button"
                    className={`cw-stat-chip ${atkFilter === range ? 'is-active is-on' : ''}`}
                    onClick={() => setAtkFilter(range)}
                    aria-pressed={atkFilter === range}
                  >
                    {range === 'all' ? 'Все' : range}
                  </button>
                ))}
              </div>
            </div>

            <div className="cw-stat-row">
              <span className="cw-stat-label" title="Защита существ">🛡️</span>
              <div className="cw-stat-chip-group" role="radiogroup" aria-label="Защита">
                {(['all', '1-3', '4-6', '7+'] as const).map((range) => (
                  <button
                    key={range}
                    type="button"
                    className={`cw-stat-chip ${defFilter === range ? 'is-active is-on' : ''}`}
                    onClick={() => setDefFilter(range)}
                    aria-pressed={defFilter === range}
                  >
                    {range === 'all' ? 'Все' : range}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="cw-filter-stack" role="group" aria-label="Фильтры по типу и свойствам">
            {BASE_TYPES.map((t) => {
              const active = selectedTypes.includes(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  className={`cw-pill ${active ? 'is-on' : ''}`}
                  aria-pressed={active}
                  onClick={() => toggleType(t.value)}
                >
                  {t.label}
                </button>
              );
            })}

            <button
              type="button"
              className={`cw-pill ${favoritesOnly ? 'is-on' : ''}`}
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly((v) => !v)}
            >
              ★ Избранные
            </button>

            <button
              type="button"
              className={`cw-pill ${floopOnly ? 'is-on' : ''}`}
              aria-pressed={floopOnly}
              onClick={() => setFloopOnly((v) => !v)}
            >
              Только с флюпом
            </button>

            <button
              type="button"
              className={`cw-pill ${showCompanions ? 'is-on' : ''}`}
              aria-pressed={showCompanions}
              onClick={() => setShowCompanions((v) => !v)}
            >
              Парные карты (2 на 2)
            </button>
          </div>

          <div className="cw-filter-footer">
            <span className="cw-filter-count">Найдено: {filtered.length}</span>
            {hasActiveFilters && (
              <button type="button" className="cw-reset-btn" onClick={resetFilters}>
                Сбросить
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* CENTER COLUMN: Top Header + Scrollable Catalog Grid */}
      <section className="cw-editor-col cw-editor-center">
        <div className="cw-lands-bar ui-card">
          <div className="cw-lands-bar-row">
            <button
              type="button"
              className="cw-top-back-btn"
              onClick={onClose}
              title="Назад к списку колод"
              aria-label="Назад к списку колод"
            >
              ←
            </button>

            {/* Left drawer toggle button (Hero & Filters) */}
            <button
              type="button"
              className={`cw-header-toggle cw-header-toggle--left ${drawerLeftOpen ? 'is-open' : ''}`}
              onClick={() => {
                setDrawerRightOpen(false);
                setDrawerLeftOpen((v) => !v);
              }}
            >
              <span>Фильтры{hasActiveFilters ? ' •' : ''}</span>
            </button>

            {/* Center lands collapse toggle with 4 land indicators */}
            <button
              type="button"
              className={`cw-header-toggle cw-header-toggle--lands ${landsMenuOpen ? 'is-open' : ''}`}
              onClick={() => setLandsMenuOpen((v) => !v)}
            >
              <span>Земли</span>
              <span className="cw-lands-dots" aria-hidden="true">
                {Array.from({ length: CONFIG.landsPerPlayer }, (_, i) => {
                  const landType = draft.lands[i] ?? 'rainbow';
                  return (
                    <span
                      key={i}
                      className={`cw-land-dot cw-land-dot--${landType}`}
                      title={LAND_META[landType].label}
                    />
                  );
                })}
              </span>
            </button>

            <div className={`cw-lands-slots ${landsMenuOpen ? 'is-mobile-open' : ''}`}>
              {Array.from({ length: CONFIG.landsPerPlayer }, (_, i) => {
                const landType = draft.lands[i] ?? 'rainbow';
                const variant = landVariants[i] ?? 1;
                const imgUrl = landImageUrl(landType, variant);
                const isOpen = openLandSlot === i;
                const isDragOver = dragOverLandSlot === i && dragLandSlot !== i;

                return (
                  <div
                    key={i}
                    className={`cw-land-slot-wrap ${isDragOver ? 'is-drag-over' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDragLandSlot(i);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(i));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverLandSlot !== i) setDragOverLandSlot(i);
                    }}
                    onDragLeave={() => {
                      if (dragOverLandSlot === i) setDragOverLandSlot(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragLandSlot ?? Number(e.dataTransfer.getData('text/plain'));
                      setDragLandSlot(null);
                      setDragOverLandSlot(null);
                      if (Number.isInteger(from) && from >= 0 && from < CONFIG.landsPerPlayer) {
                        swapLands(from, i);
                      }
                    }}
                    onDragEnd={() => {
                      setDragLandSlot(null);
                      setDragOverLandSlot(null);
                    }}
                  >
                    <button
                      type="button"
                      className={`cw-land-slot ${isOpen ? 'is-active' : ''} cw-land-slot--${landType}`}
                      onClick={() => handleLandSlotClick(i)}
                      title={`Зона ${i + 1}: ${LAND_META[landType].label} (кликните слот A затем B чтобы поменять местами)`}
                    >
                      {imgUrl ? (
                        <img src={imgUrl} alt={LAND_META[landType].label} draggable={false} fetchPriority="high" />
                      ) : (
                        <div className="cw-land-rainbow">
                          <span>🌈</span>
                          <b>Радуга</b>
                        </div>
                      )}
                      <span className="cw-land-slot-badge">
                        {i + 1}. {LAND_META[landType].shortLabel}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Right drawer toggle button (Deck preview) */}
            <button
              type="button"
              className={`cw-header-toggle cw-header-toggle--right ${isDeckFull ? 'is-ok' : ''} ${drawerRightOpen ? 'is-open' : ''}`}
              onClick={() => {
                setDrawerLeftOpen(false);
                setDrawerRightOpen((v) => !v);
              }}
            >
              <span className="cw-deck-toggle-label">Колода</span>
              <span className="cw-deck-toggle-count">
                {draft.cards.length}/{CONFIG.deckSize}
              </span>
            </button>
          </div>

          {openLandSlot !== null && (
            <div className="cw-land-picker-popover ui-card" role="dialog" aria-label="Выбор земли">
              <div className="cw-land-picker-head">
                <b>Выберите землю для слота #{openLandSlot + 1}</b>
                <button type="button" className="mini" onClick={() => setOpenLandSlot(null)}>
                  ✕
                </button>
              </div>
              <div className="cw-land-picker-grid">
                {LAND_TYPES.map((type) => {
                  const previewImg = landImageUrl(type, (openLandSlot % 4) + 1);
                  const current = draft.lands[openLandSlot] === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      className={`cw-land-option ${current ? 'is-selected' : ''}`}
                      onClick={() => setLand(openLandSlot, type)}
                    >
                      <div className="cw-land-option-art">
                        {previewImg ? (
                          <img src={previewImg} alt={LAND_META[type].label} draggable={false} />
                        ) : (
                          <div className="cw-land-rainbow">
                            <span>🌈</span>
                            <b>Радужная</b>
                          </div>
                        )}
                      </div>
                      <span className="cw-land-option-label">{LAND_META[type].label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="cw-catalog-scroll ui-card" data-zoom-bounds ref={catalogScrollRef}>
          {filtered.length === 0 ? (
            <div className="cw-catalog-empty">
              <p>Нет карт по выбранным фильтрам</p>
              {hasActiveFilters && (
                <button type="button" className="btn-soft" onClick={resetFilters}>
                  Сбросить фильтры
                </button>
              )}
            </div>
          ) : (
            <div className="cw-catalog-grid">
              {visibleCards.map((card) => (
                <CatalogCardTile
                  key={card.id}
                  card={card}
                  inDeck={(counts.get(card.id) ?? 0) > 0}
                  count={counts.get(card.id) ?? 0}
                  favorite={favorites.has(card.id)}
                  onAdd={addCard}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
              {visibleCount < filtered.length && (
                <div
                  ref={sentinelRef}
                  className="cw-catalog-sentinel"
                  style={{ height: '32px', width: '100%', gridColumn: '1 / -1' }}
                  aria-hidden="true"
                />
              )}
            </div>
          )}
        </div>
      </section>

      {/* RIGHT COLUMN: Controls + Name + All 40 Slots or Grouped List */}
      <aside
        className={`cw-editor-col cw-editor-right ui-card ${drawerRightOpen ? 'is-drawer-open' : ''}`}
        data-zoom-bounds
      >
        <div className="cw-drawer-head cw-drawer-head--right">
          <b>Предпросмотр колоды</b>
          <button
            type="button"
            className="cw-drawer-close"
            onClick={() => setDrawerRightOpen(false)}
            aria-label="Закрыть колоду"
          >
            ✕
          </button>
        </div>
        <div className="cw-right-top">
          <div className="cw-right-actions" style={{ flexWrap: 'wrap', gap: '6px' }}>
            <div className="cw-right-status-box">
              <span className={`cw-deck-counter ${isDeckFull ? 'is-ok' : ''}`}>
                {draft.cards.length} / {CONFIG.deckSize}
              </span>
              <button
                type="button"
                className="cw-clear-btn"
                disabled={draft.cards.length === 0}
                onClick={() => setConfirmClear(true)}
                title="Очистить все карты из колоды"
              >
                Очистить
              </button>
            </div>

            {/* Random Fill Button */}
            <button
              type="button"
              className="cw-random-btn"
              onClick={handleRandomFill}
              title={isDeckFull ? 'Пересобрать колоду случайно' : 'Заполнить колоду случайными картами'}
            >
              🎲 Случайный набор
            </button>

            {/* View mode toggle: Grid vs Grouped List */}
            <div className="cw-view-mode-toggle" role="radiogroup" aria-label="Вид колоды">
              <button
                type="button"
                className={`cw-view-mode-btn ${deckViewMode === 'grid' ? 'is-active' : ''}`}
                onClick={() => setDeckViewMode('grid')}
                title="Сетка из 40 слотов"
                aria-label="Вид сеткой"
              >
                ⊞ Сетка
              </button>
              <button
                type="button"
                className={`cw-view-mode-btn ${deckViewMode === 'list' ? 'is-active' : ''}`}
                onClick={() => setDeckViewMode('list')}
                title="Сгруппированный список карт"
                aria-label="Вид списком"
              >
                ☰ Список
              </button>
            </div>

            {/* Save Button (always clickable with feedback toast if invalid) */}
            <button
              type="button"
              className={`btn-primary cw-save-btn ${errors.length > 0 ? 'is-invalid' : ''}`}
              onClick={save}
              title={
                errors.length > 0
                  ? `Не хватает ${CONFIG.deckSize - draft.cards.length} карт до полной колоды`
                  : 'Сохранить колоду'
              }
            >
              Сохранить
            </button>
          </div>

          <div className="cw-right-name-row">
            <input
              type="text"
              className="cw-control cw-deck-name-input"
              placeholder="Название колоды…"
              maxLength={40}
              style={{ fontSize: '16px' }}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
        </div>

        {deckViewMode === 'grid' ? (
          <div className="cw-deck-slots-grid" aria-label="Карты в колоде">
            {deckSlots.map((slot) =>
              slot.card ? (
                <DeckSlotCard
                  key={`${slot.index}-${slot.cardId}`}
                  card={slot.card}
                  index={slot.index}
                  onRemove={removeCardAtIndex}
                />
              ) : (
                <div key={`empty-${slot.index}`} className="cw-deck-slot cw-deck-slot--empty">
                  <span>{slot.index + 1}</span>
                </div>
              ),
            )}
          </div>
        ) : (
          <div className="cw-grouped-list" aria-label="Сгруппированные карты в колоде">
            {groupedDeck.length === 0 ? (
              <div className="cw-grouped-empty" style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                <p>В колоде пока нет карт</p>
                <button
                  type="button"
                  className="btn-soft mini cw-random-btn"
                  onClick={handleRandomFill}
                  style={{ marginTop: '8px' }}
                >
                  🎲 Заполнить случайно
                </button>
              </div>
            ) : (
              groupedDeck.map((group) => (
                <div key={group.card.id} className="cw-grouped-item">
                  <span className="cw-grouped-cost" title={`Стоимость: ${group.card.cost} действий`}>
                    {group.card.cost}
                  </span>
                  <span className="cw-grouped-name" title={group.card.name}>
                    {group.card.name}
                  </span>
                  <div className="cw-grouped-controls">
                    <button
                      type="button"
                      className="cw-grouped-btn cw-grouped-minus"
                      onClick={() => removeCardAtIndex(group.indices[group.indices.length - 1]!)}
                      aria-label={`Убрать копию ${group.card.name}`}
                      title="Убрать копию"
                    >
                      −
                    </button>
                    <span className="cw-grouped-count">×{group.count}</span>
                    <button
                      type="button"
                      className="cw-grouped-btn cw-grouped-plus"
                      disabled={
                        draft.cards.length >= CONFIG.deckSize || group.count >= CONFIG.copyLimit
                      }
                      onClick={() => addCard(group.card)}
                      aria-label={`Добавить копию ${group.card.name}`}
                      title={
                        group.count >= CONFIG.copyLimit
                          ? `Максимум ${CONFIG.copyLimit} копии`
                          : draft.cards.length >= CONFIG.deckSize
                            ? 'Колода полна'
                            : 'Добавить копию'
                      }
                    >
                      +
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </aside>

      {/* Modal: Confirm Clear Deck */}
      {confirmClear && (
        <div className="cw-modal-backdrop" onClick={() => setConfirmClear(false)}>
          <div className="cw-modal ui-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Очистить колоду?</h3>
            <p className="hint">Все набранные карты ({draft.cards.length} шт.) будут убраны из колоды.</p>
            <div className="cw-modal-actions">
              <button type="button" className="btn-soft" onClick={() => setConfirmClear(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="delete-btn"
                onClick={() => {
                  setDraft((d) => ({ ...d, cards: [] }));
                  setConfirmClear(false);
                  showToast('Колода очищена');
                }}
              >
                Очистить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Re-roll Deck */}
      {confirmReroll && (
        <div className="cw-modal-backdrop" onClick={() => setConfirmReroll(false)}>
          <div className="cw-modal ui-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Пересобрать колоду случайно?</h3>
            <p className="hint">
              В колоде уже 40 карт. Все текущие карты будут заменены сбалансированным случайным набором под выбранные земли.
            </p>
            <div className="cw-modal-actions">
              <button type="button" className="btn-soft" onClick={() => setConfirmReroll(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary cw-random-btn"
                onClick={handleRerollConfirmed}
              >
                🎲 Заполнить заново
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * Shared hook for press-and-hold card zoom:
 * - Holding a pointer/finger still for HOLD_ZOOM_DELAY_MS zooms the card in (`holdZoomed = true`).
 * - Releasing the finger immediately shrinks the card (`holdZoomed = false`) and suppresses the click.
 * - Moving the finger before the timer fires cancels the hold so touch scrolling works smoothly.
 */
function useHoldZoom<T extends HTMLElement>(scale: number) {
  const elRef = useRef<T | null>(null);
  const [origin, setOrigin] = useState('50% 50%');
  const [holdZoomed, setHoldZoomed] = useState(false);
  const timerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const didHoldRef = useRef(false);

  const clearHoldTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearHoldTimer();
  }, [clearHoldTimer]);

  const updateOrigin = useCallback(() => {
    if (elRef.current) {
      setOrigin(computeZoomOrigin(elRef.current, scale));
    }
  }, [scale]);

  const onMouseEnter = useCallback(() => {
    updateOrigin();
  }, [updateOrigin]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      didHoldRef.current = false;
      startPosRef.current = { x: e.clientX, y: e.clientY };
      clearHoldTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        didHoldRef.current = true;
        updateOrigin();
        setHoldZoomed(true);
      }, HOLD_ZOOM_DELAY_MS);
    },
    [clearHoldTimer, updateOrigin],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!startPosRef.current || timerRef.current === null) return;
      const dx = e.clientX - startPosRef.current.x;
      const dy = e.clientY - startPosRef.current.y;
      if (Math.hypot(dx, dy) > HOLD_MOVE_TOLERANCE_PX) {
        clearHoldTimer();
        startPosRef.current = null;
      }
    },
    [clearHoldTimer],
  );

  const endHold = useCallback(() => {
    clearHoldTimer();
    startPosRef.current = null;
    setHoldZoomed(false);
  }, [clearHoldTimer]);

  const handleTapClick = useCallback((e: ReactMouseEvent, action: () => void) => {
    if (didHoldRef.current) {
      e.preventDefault();
      e.stopPropagation();
      didHoldRef.current = false;
      return;
    }
    action();
  }, []);

  return {
    elRef,
    origin,
    holdZoomed,
    onMouseEnter,
    onPointerDown,
    onPointerMove,
    onPointerUp: endHold,
    onPointerCancel: endHold,
    onPointerLeave: endHold,
    handleTapClick,
  };
}

interface CatalogCardTileProps {
  card: CardData;
  inDeck: boolean;
  count?: number;
  favorite: boolean;
  onAdd: (card: CardData) => void;
  onToggleFavorite: (cardId: string) => void;
}

const CatalogCardTile = memo(
  function CatalogCardTile({
    card,
    inDeck,
    count = 0,
    favorite,
    onAdd,
    onToggleFavorite,
  }: CatalogCardTileProps) {
    const {
      elRef,
      origin,
      holdZoomed,
      onMouseEnter,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      handleTapClick,
    } = useHoldZoom<HTMLDivElement>(CATALOG_ZOOM_SCALE);

    const visualStyle = {
      '--cw-zoom-scale': CATALOG_ZOOM_SCALE,
      '--cw-zoom-origin': origin,
    } as CSSProperties;

    return (
      <div
        ref={elRef}
        className={`cw-card-tile ${inDeck ? 'is-in-deck' : ''} ${holdZoomed ? 'is-hold-zoomed' : ''}`}
        onMouseEnter={onMouseEnter}
      >
        <div className="cw-card-visual" style={visualStyle}>
          {card.image ? (
            <img
              className="cw-card-img"
              src={card.image}
              alt={card.name}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : (
            <div className="cw-card-fallback">
              <b>{card.name}</b>
            </div>
          )}
        </div>

        {count > 0 && (
          <span className="cw-card-count-badge" aria-label={`В колоде: ${count}`}>
            {count}
          </span>
        )}

        <button
          type="button"
          className="cw-card-hit"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={onPointerLeave}
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => handleTapClick(e, () => onAdd(card))}
          aria-label={`Добавить ${card.name}`}
        />

        <button
          type="button"
          className={`cw-card-fav ${favorite ? 'is-fav' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(card.id);
          }}
          aria-label={favorite ? 'Убрать из избранного' : 'В избранное'}
          title={favorite ? 'В избранном' : 'Добавить в избранное'}
        >
          ★
        </button>
      </div>
    );
  },
  (prev, next) =>
    prev.card.id === next.card.id &&
    prev.inDeck === next.inDeck &&
    prev.count === next.count &&
    prev.favorite === next.favorite &&
    prev.onAdd === next.onAdd &&
    prev.onToggleFavorite === next.onToggleFavorite,
);

interface DeckSlotCardProps {
  card: CardData;
  index: number;
  onRemove: (index: number) => void;
}

const DeckSlotCard = memo(
  function DeckSlotCard({ card, index, onRemove }: DeckSlotCardProps) {
    const {
      elRef,
      origin,
      holdZoomed,
      onMouseEnter,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      handleTapClick,
    } = useHoldZoom<HTMLButtonElement>(DECK_ZOOM_SCALE);

    const visualStyle = {
      '--cw-zoom-scale': DECK_ZOOM_SCALE,
      '--cw-zoom-origin': origin,
    } as CSSProperties;

    return (
      <button
        ref={elRef}
        type="button"
        className={`cw-deck-slot cw-deck-slot--filled ${holdZoomed ? 'is-hold-zoomed' : ''}`}
        onMouseEnter={onMouseEnter}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => handleTapClick(e, () => onRemove(index))}
        aria-label={`Убрать ${card.name}`}
      >
        <div className="cw-card-visual" style={visualStyle}>
          {card.image ? (
            <img
              className="cw-card-img"
              src={card.image}
              alt={card.name}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : (
            <div className="cw-card-fallback">
              <b>{card.name}</b>
            </div>
          )}
        </div>
      </button>
    );
  },
  (prev, next) =>
    prev.card.id === next.card.id &&
    prev.index === next.index &&
    prev.onRemove === next.onRemove,
);
