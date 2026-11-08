import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { CONFIG } from '@card-wars/protocol';
import { LAND_TYPES, cards, heroes, type CardData, type LandType } from '@card-wars/content';
import { loadFavorites, saveFavorites, validateSavedDeck, type SavedDeck } from '../decks';
import { CATALOG_ZOOM_SCALE, DECK_ZOOM_SCALE, computeZoomOrigin } from './cardZoom';

const LAND_META: Record<LandType, { label: string; shortLabel: string; prefix: string | null }> = {
  corn: { label: 'Кукурузные поля', shortLabel: 'Кукуруза', prefix: 'land_corn' },
  blue: { label: 'Синие равнины', shortLabel: 'Синие', prefix: 'land_blue' },
  good: { label: 'Милые земли', shortLabel: 'Милые', prefix: 'land_nice' },
  ice: { label: 'Ледяные земли', shortLabel: 'Лёд', prefix: 'land_icy' },
  sand: { label: 'Песчаные земли', shortLabel: 'Песок', prefix: 'land_sandy' },
  swamp: { label: 'Болото', shortLabel: 'Болото', prefix: 'land_swamp' },
  rainbow: { label: 'Радужная земля', shortLabel: 'Радуга', prefix: null },
  ghost: { label: 'Призрачные земли', shortLabel: 'Призраки', prefix: 'land_ghost' },
};

function landImageUrl(type: LandType, variant = 1): string | null {
  const prefix = LAND_META[type].prefix;
  if (!prefix) return null;
  const v = ((variant - 1) % 4) + 1;
  return `/content/lands/images/${prefix}_${v}.png`;
}

type SortBy = 'number' | 'cost' | 'name' | 'type';
type CostFilter = 'all' | '0' | '1' | '2' | '3+';
type BaseCardType = 'creature' | 'building' | 'spell';

const BASE_TYPES: Array<{ value: BaseCardType; label: string }> = [
  { value: 'creature', label: 'Существа' },
  { value: 'building', label: 'Строения' },
  { value: 'spell', label: 'Заклинания' },
];

const TYPE_RANK: Record<CardData['type'], number> = {
  creature: 0,
  building: 1,
  spell: 2,
  companion: 3,
};

const HOLD_ZOOM_DELAY_MS = 180;
const HOLD_MOVE_TOLERANCE_PX = 10;

function cardNumberKey(id: string): [string, number] {
  const m = /^(.+)_card_(\d+)$/.exec(id);
  return m ? [m[1]!, Number(m[2])] : [id, 0];
}

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

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('number');
  const [selectedTypes, setSelectedTypes] = useState<BaseCardType[]>([]);
  const [costFilter, setCostFilter] = useState<CostFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [floopOnly, setFloopOnly] = useState(false);
  const [showCompanions, setShowCompanions] = useState(() =>
    deck.cards.some((id) => cardById.get(id)?.type === 'companion'),
  );
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());

  const [openLandSlot, setOpenLandSlot] = useState<number | null>(null);
  const [dragLandSlot, setDragLandSlot] = useState<number | null>(null);
  const [dragOverLandSlot, setDragOverLandSlot] = useState<number | null>(null);
  const [drawerRightOpen, setDrawerRightOpen] = useState(false);
  const [landsMenuOpen, setLandsMenuOpen] = useState(false);
  const [drawerLeftOpen, setDrawerLeftOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (openLandSlot === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenLandSlot(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openLandSlot]);

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
    favoritesOnly ||
    floopOnly ||
    showCompanions;

  const resetFilters = () => {
    setSearch('');
    setSelectedTypes([]);
    setCostFilter('all');
    setFavoritesOnly(false);
    setFloopOnly(false);
    setShowCompanions(false);
  };

  const toggleType = (t: BaseCardType) => {
    setSelectedTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
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
        return TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.cost - b.cost || a.name.localeCompare(b.name, 'ru');
      }
      const [setA, numA] = cardNumberKey(a.id);
      const [setB, numB] = cardNumberKey(b.id);
      return setA.localeCompare(setB) || numA - numB;
    });
  }, [search, sortBy, selectedTypes, costFilter, favoritesOnly, floopOnly, showCompanions, favorites]);

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

  const setLand = (index: number, type: LandType) => {
    setDraft((d) => {
      const lands = [...d.lands];
      lands[index] = type;
      return { ...d, lands };
    });
    setOpenLandSlot(null);
  };

  const swapLands = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setDraft((d) => {
      const lands = [...d.lands];
      const temp = lands[fromIndex]!;
      lands[fromIndex] = lands[toIndex]!;
      lands[toIndex] = temp;
      return { ...d, lands };
    });
  };

  const save = () => {
    if (errors.length > 0) {
      showToast(errors[0]!);
      return;
    }
    onSave({
      ...draft,
      name: draft.name.trim(),
      cards: [...draft.cards],
      lands: [...draft.lands],
    });
  };

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

      {/* LEFT COLUMN: Hero + Filters (all controls stacked in 1 column) */}
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
              <img className="cw-hero-img" src={hero.image} alt={hero.name} draggable={false} />
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
              <option value="number">По номеру</option>
              <option value="cost">По стоимости</option>
              <option value="name">По алфавиту</option>
              <option value="type">По типу карты</option>
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

      {/* CENTER COLUMN: Top Header (Back + Lands + Responsive Toggles) + Scrollable Catalog Grid */}
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

            {/* Step 3 button (left): Hero & Filters drawer toggle */}
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

            {/* Step 2 button (center): Lands collapse toggle with 4 land indicators */}
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
                      onClick={() => setOpenLandSlot(isOpen ? null : i)}
                      title={`Зона ${i + 1}: ${LAND_META[landType].label} (клик — сменить, перетаскивание — поменять местами)`}
                    >
                      {imgUrl ? (
                        <img src={imgUrl} alt={LAND_META[landType].label} draggable={false} />
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

            {/* Step 1 button (right): Deck preview drawer toggle */}
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

        <div className="cw-catalog-scroll ui-card" data-zoom-bounds>
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
              {filtered.map((card) => (
                <CatalogCardTile
                  key={card.id}
                  card={card}
                  inDeck={(counts.get(card.id) ?? 0) > 0}
                  favorite={favorites.has(card.id)}
                  onAdd={addCard}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* RIGHT COLUMN: Controls + Name + All 40 Individual Card Slots */}
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
          <div className="cw-right-actions">
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

            <button
              type="button"
              className="btn-primary cw-save-btn"
              disabled={errors.length > 0}
              onClick={save}
              title={errors[0] ?? 'Сохранить колоду'}
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
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
        </div>

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
      </aside>

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

function CatalogCardTile({
  card,
  inDeck,
  favorite,
  onAdd,
  onToggleFavorite,
}: {
  card: CardData;
  inDeck: boolean;
  favorite: boolean;
  onAdd: (card: CardData) => void;
  onToggleFavorite: (cardId: string) => void;
}) {
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
}

function DeckSlotCard({
  card,
  index,
  onRemove,
}: {
  card: CardData;
  index: number;
  onRemove: (index: number) => void;
}) {
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
}
