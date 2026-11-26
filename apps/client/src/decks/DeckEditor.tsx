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
import { LAND_TYPES, PLAYABLE_LAND_TYPES, cards, heroes, type CardData, type LandType } from '@card-wars/content';
import {
  generateRandomDeck,
  isPlayableLandType,
  loadFavorites,
  saveFavorites,
  validateSavedDeck,
  type SavedDeck,
} from '../decks';
import { CATALOG_ZOOM_SCALE, DECK_ZOOM_SCALE, computeZoomOrigin } from './cardZoom';
import { LAND_META, getLandArts, resolveLandImageUrl } from './landImages';
import { soundEngine } from '../sound/SoundEngine';

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
const INITIAL_CHUNK = 240;
const CHUNK_SIZE = 120;

function hasFloop(card: CardData): boolean {
  if (card.abilities?.some((a) => a.kind === 'active')) return true;
  if (!card.description) return false;
  return /при[её]м|флюп|floop/i.test(card.description);
}

function isPointerOutside(e: ReactPointerEvent<HTMLDialogElement>): boolean {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
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
      const lands = (parsed.lands as LandType[]).map((l) => (l === 'rainbow' ? 'blue' : l));
      const landIds = Array.isArray(parsed.landIds)
        ? lands.map((_, i) => {
            const id = parsed.landIds?.[i];
            return typeof id === 'string' ? id : null;
          })
        : undefined;
      return {
        id: parsed.id,
        name: parsed.name,
        heroId: parsed.heroId,
        lands,
        ...(landIds ? { landIds } : {}),
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
  const [draft, setDraft] = useState<SavedDeck>(() => {
    const lands = deck.lands.map((l) => (l === 'rainbow' ? 'blue' : l));
    const landIds = Array.from({ length: Math.max(lands.length, CONFIG.landsPerPlayer) }, (_, i) => deck.landIds?.[i] ?? null);
    return {
      ...deck,
      lands,
      landIds,
      cards: [...deck.cards],
    };
  });

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
  // Default to list view on mobile/tablets (< 768px) for readability & ergonomics
  const [deckViewMode, setDeckViewMode] = useState<'grid' | 'list'>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return 'list';
    }
    return 'grid';
  });

  // UI modals and drawers
  const [heroPickerOpen, setHeroPickerOpen] = useState(false);
  const [heroSearch, setHeroSearch] = useState('');
  const [openLandSlot, setOpenLandSlot] = useState<number | null>(null);
  const [activeLandTab, setActiveLandTab] = useState<Exclude<LandType, 'rainbow'>>('blue');
  const [dragLandSlot, setDragLandSlot] = useState<number | null>(null);
  const [dragOverLandSlot, setDragOverLandSlot] = useState<number | null>(null);
  const [drawerRightOpen, setDrawerRightOpen] = useState(false);
  const [drawerLeftOpen, setDrawerLeftOpen] = useState(false);
  const [landsMenuOpen, setLandsMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReroll, setConfirmReroll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const heroDialogRef = useRef<HTMLDialogElement | null>(null);
  const landDialogRef = useRef<HTMLDialogElement | null>(null);
  const clearDialogRef = useRef<HTMLDialogElement | null>(null);
  const rerollDialogRef = useRef<HTMLDialogElement | null>(null);
  const heroOutsideRef = useRef(false);
  const landOutsideRef = useRef(false);
  const clearOutsideRef = useRef(false);
  const rerollOutsideRef = useRef(false);

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

  // Sync native <dialog> modals
  useEffect(() => {
    const dialog = heroDialogRef.current;
    if (!dialog) return;
    if (heroPickerOpen) {
      if (!dialog.open) {
        soundEngine.playModalOpen();
        dialog.showModal();
      }
    } else if (dialog.open) {
      soundEngine.playModalClose();
      dialog.close();
    }
  }, [heroPickerOpen]);

  useEffect(() => {
    const dialog = landDialogRef.current;
    if (!dialog) return;
    if (openLandSlot !== null) {
      if (!dialog.open) {
        soundEngine.playModalOpen();
        dialog.showModal();
      }
    } else if (dialog.open) {
      soundEngine.playModalClose();
      dialog.close();
    }
  }, [openLandSlot]);

  useEffect(() => {
    const dialog = clearDialogRef.current;
    if (!dialog) return;
    if (confirmClear) {
      if (!dialog.open) {
        soundEngine.playModalOpen();
        dialog.showModal();
      }
    } else if (dialog.open) {
      soundEngine.playModalClose();
      dialog.close();
    }
  }, [confirmClear]);

  useEffect(() => {
    const dialog = rerollDialogRef.current;
    if (!dialog) return;
    if (confirmReroll) {
      if (!dialog.open) {
        soundEngine.playModalOpen();
        dialog.showModal();
      }
    } else if (dialog.open) {
      soundEngine.playModalClose();
      dialog.close();
    }
  }, [confirmReroll]);

  // Keyboard navigation: Escape key closes active mobile drawers/menus (native <dialog> handles its own Esc)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
  }, [drawerLeftOpen, drawerRightOpen, landsMenuOpen]);

  const errors = validateSavedDeck(draft);
  const hero = heroes.find((h) => h.id === draft.heroId) ?? heroes[0];

  const filteredHeroes = useMemo(() => {
    const q = heroSearch.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((item) => `${item.name} ${item.text ?? ''}`.toLowerCase().includes(q));
  }, [heroSearch]);

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

  // Dual pagination trigger: direct scroll listener + IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scrollEl = catalogScrollRef.current;
    if (visibleCount >= filtered.length) return;

    const handleScroll = () => {
      if (!scrollEl) return;
      if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1600) {
        setVisibleCount((prev) => Math.min(prev + CHUNK_SIZE, filtered.length));
      }
    };

    if (scrollEl) {
      scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    }

    let observer: IntersectionObserver | null = null;
    if (sentinel) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setVisibleCount((prev) => Math.min(prev + CHUNK_SIZE, filtered.length));
          }
        },
        { root: scrollEl, rootMargin: '2400px', threshold: 0.01 },
      );
      observer.observe(sentinel);
    }

    return () => {
      if (scrollEl) scrollEl.removeEventListener('scroll', handleScroll);
      if (observer) observer.disconnect();
    };
  }, [filtered.length, visibleCount]);

  // Proactive image preloading
  useEffect(() => {
    const immediateBatch = filtered.slice(0, Math.min(filtered.length, 240));
    for (const card of immediateBatch) {
      if (card.image) {
        const img = new Image();
        img.src = card.image;
      }
    }

    let cancelled = false;
    let idx = 240;
    const preloadChunk = () => {
      if (cancelled || idx >= filtered.length) return;
      const end = Math.min(filtered.length, idx + 60);
      for (let i = idx; i < end; i++) {
        const card = filtered[i];
        if (card?.image) {
          const img = new Image();
          img.src = card.image;
        }
      }
      idx = end;
      if (idx < filtered.length) {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(preloadChunk, { timeout: 150 });
        } else {
          setTimeout(preloadChunk, 40);
        }
      }
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(preloadChunk, { timeout: 200 });
    } else {
      setTimeout(preloadChunk, 80);
    }

    return () => {
      cancelled = true;
    };
  }, [filtered]);

  const addCard = useCallback(
    (card: CardData) => {
      setDraft((d) => {
        const currentCount = d.cards.filter((id) => id === card.id).length;
        if (currentCount >= CONFIG.copyLimit) {
          soundEngine.playError();
          showToast(`Максимум ${CONFIG.copyLimit} копии карты «${card.name}»`);
          return d;
        }
        if (d.cards.length >= CONFIG.deckSize) {
          soundEngine.playError();
          showToast(`В колоде уже ${CONFIG.deckSize} из ${CONFIG.deckSize} карт`);
          return d;
        }
        soundEngine.playCardSelect();
        return { ...d, cards: [...d.cards, card.id] };
      });
    },
    [showToast],
  );

  const removeCardAtIndex = useCallback((index: number) => {
    soundEngine.playCardDiscard();
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

  const setLandArt = useCallback((index: number, type: Exclude<LandType, 'rainbow'>, artId: string) => {
    setDraft((d) => {
      const lands = [...d.lands];
      lands[index] = type;
      const landIds = Array.from({ length: CONFIG.landsPerPlayer }, (_, i) => d.landIds?.[i] ?? null);
      landIds[index] = artId;
      return { ...d, lands, landIds };
    });
    setOpenLandSlot(null);
  }, []);

  const swapLands = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setDraft((d) => {
      const lands = [...d.lands];
      const tempLand = lands[fromIndex]!;
      lands[fromIndex] = lands[toIndex]!;
      lands[toIndex] = tempLand;

      const landIds = Array.from({ length: CONFIG.landsPerPlayer }, (_, i) => d.landIds?.[i] ?? null);
      const tempId = landIds[fromIndex] ?? null;
      landIds[fromIndex] = landIds[toIndex] ?? null;
      landIds[toIndex] = tempId;

      return { ...d, lands, landIds };
    });
  }, []);

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
      soundEngine.playError();
      if (draft.cards.length < CONFIG.deckSize) {
        showToast(`Не хватает ${CONFIG.deckSize - draft.cards.length} карт до полной колоды`);
      } else {
        showToast(errors[0]!);
      }
      return;
    }
    soundEngine.playDeckSave();
    onSave({
      ...draft,
      name: draft.name.trim(),
      cards: [...draft.cards],
      lands: [...draft.lands],
      landIds: Array.from({ length: draft.lands.length }, (_, i) => draft.landIds?.[i] ?? null),
    });
  }, [draft, errors, onSave, showToast]);

  // Compute land variant numbers (1..4) so duplicate land types show distinct artwork scans by default.
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
  const landArtsForTab = useMemo(() => getLandArts(activeLandTab), [activeLandTab]);

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
      <aside className={`cw-editor-col cw-editor-left ui-card cw-felt-box ${drawerLeftOpen ? 'is-drawer-open' : ''}`}>
        <div className="cw-left-desktop-head">
          <button
            type="button"
            className="cw-btn-3d btn-dark btn-sm"
            onClick={onClose}
            title="Назад к списку колод"
          >
            ← Назад
          </button>
          <span className="cw-left-desktop-title">Редактор</span>
        </div>
        <div className="cw-drawer-head cw-drawer-head--left">
          <b>Герой и фильтры</b>
          <button
            type="button"
            className="cw-drawer-close cw-btn-3d btn-dark btn-sm"
            onClick={() => setDrawerLeftOpen(false)}
            aria-label="Закрыть фильтры"
          >
            ✕
          </button>
        </div>

        <div className="cw-hero-box">
          <button
            type="button"
            className="cw-hero-preview cw-hero-preview-btn"
            onClick={() => setHeroPickerOpen(true)}
            title={`Сменить героя (сейчас: ${hero?.name ?? 'Герой'})`}
            aria-label={`Сменить героя: ${hero?.name ?? 'Герой'}`}
          >
            {hero?.image ? (
              <img className="cw-hero-img" src={hero.image} alt={hero.name} draggable={false} fetchPriority="high" />
            ) : (
              <div className="cw-hero-fallback">
                <b>{hero?.name ?? 'Герой'}</b>
                {hero?.text && <p>{hero.text}</p>}
              </div>
            )}
            <span className="cw-hero-change-ribbon">Сменить героя</span>
          </button>
        </div>

        <div className="cw-filters-box">
          <input
            type="search"
            className="cw-control"
            placeholder="Поиск карты…"
            style={{ fontSize: '16px', borderRadius: '10px' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <label className="cw-filter-field">
            <span>Сортировка</span>
            <select
              className="cw-control"
              style={{ borderRadius: '10px' }}
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
              style={{ borderRadius: '10px' }}
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
                style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '10px' }}
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
                    style={{ borderRadius: '10px' }}
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
                    style={{ borderRadius: '10px' }}
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
                    style={{ borderRadius: '10px' }}
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
                  style={{ borderRadius: '10px' }}
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
              style={{ borderRadius: '10px' }}
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly((v) => !v)}
            >
              ★ Избранные
            </button>

            <button
              type="button"
              className={`cw-pill ${floopOnly ? 'is-on' : ''}`}
              style={{ borderRadius: '10px' }}
              aria-pressed={floopOnly}
              onClick={() => setFloopOnly((v) => !v)}
            >
              Только с флюпом
            </button>

            <button
              type="button"
              className={`cw-pill ${showCompanions ? 'is-on' : ''}`}
              style={{ borderRadius: '10px' }}
              aria-pressed={showCompanions}
              onClick={() => setShowCompanions((v) => !v)}
            >
              Парные карты (2 на 2)
            </button>
          </div>

          <div className="cw-filter-footer">
            <span className="cw-filter-count">Найдено: {filtered.length}</span>
            {hasActiveFilters && (
              <button type="button" className="cw-reset-btn cw-btn-3d btn-paper btn-sm" onClick={resetFilters}>
                Сбросить
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* CENTER COLUMN: Top Header + Scrollable Catalog Grid */}
      <section className="cw-editor-col cw-editor-center">
        <div className="cw-lands-bar ui-card cw-felt-box">
          <div className="cw-lands-bar-row">
            <button
              type="button"
              className="cw-top-back-btn cw-btn-3d btn-dark btn-sm"
              onClick={onClose}
              title="Назад к списку колод"
              aria-label="Назад к списку колод"
            >
              ←
            </button>

            {/* Left drawer toggle button (Hero & Filters) */}
            <button
              type="button"
              className={`cw-header-toggle cw-header-toggle--left cw-btn-3d btn-dark btn-sm ${drawerLeftOpen ? 'is-open' : ''}`}
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
              className={`cw-header-toggle cw-header-toggle--lands cw-btn-3d btn-dark btn-sm ${landsMenuOpen ? 'is-open' : ''}`}
              onClick={() => setLandsMenuOpen((v) => !v)}
            >
              <span>Земли</span>
              <span className="cw-lands-dots" aria-hidden="true">
                {Array.from({ length: CONFIG.landsPerPlayer }, (_, i) => {
                  const rawLand = draft.lands[i];
                  const landType: Exclude<LandType, 'rainbow'> =
                    rawLand && isPlayableLandType(rawLand) ? rawLand : 'blue';
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
                const rawLand = draft.lands[i];
                const landType: Exclude<LandType, 'rainbow'> =
                  rawLand && isPlayableLandType(rawLand) ? rawLand : 'blue';
                const variant = landVariants[i] ?? 1;
                const imgUrl = resolveLandImageUrl(landType, draft.landIds?.[i], variant);
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
                      onClick={() => {
                        setActiveLandTab(landType);
                        setOpenLandSlot(i);
                      }}
                      title={`Зона ${i + 1}: ${LAND_META[landType].label} — нажмите, чтобы выбрать землю и арт`}
                    >
                      {imgUrl && (
                        <img src={imgUrl} alt={LAND_META[landType].label} draggable={false} fetchPriority="high" />
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
              className={`cw-header-toggle cw-header-toggle--right cw-btn-3d ${isDeckFull ? 'btn-green is-ok' : 'btn-dark'} btn-sm ${drawerRightOpen ? 'is-open' : ''}`}
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
        </div>

        <div className="cw-catalog-scroll ui-card cw-felt-box" data-zoom-bounds ref={catalogScrollRef}>
          {filtered.length === 0 ? (
            <div className="cw-catalog-empty">
              <p>Нет карт по выбранным фильтрам</p>
              {hasActiveFilters && (
                <button type="button" className="cw-btn-3d btn-orange btn-sm" onClick={resetFilters}>
                  Сбросить фильтры
                </button>
              )}
            </div>
          ) : (
            <div className="cw-catalog-grid">
              {visibleCards.map((card, index) => (
                <CatalogCardTile
                  key={card.id}
                  card={card}
                  index={index}
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
        className={`cw-editor-col cw-editor-right ui-card cw-felt-box ${drawerRightOpen ? 'is-drawer-open' : ''}`}
        data-zoom-bounds
      >
        <div className="cw-drawer-head cw-drawer-head--right">
          <b>Предпросмотр колоды</b>
          <button
            type="button"
            className="cw-drawer-close cw-btn-3d btn-dark btn-sm"
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
                className="cw-clear-btn cw-btn-3d btn-red btn-sm"
                disabled={draft.cards.length === 0}
                onClick={() => setConfirmClear(true)}
                title="Очистить все карты из колоды"
              >
                Очистить
              </button>
            </div>

            {/* Save Button */}
            <button
              type="button"
              className={`cw-save-btn cw-btn-3d ${errors.length > 0 ? 'btn-dark is-invalid' : 'btn-green'} btn-sm`}
              onClick={save}
              title={
                errors.length > 0
                  ? `Не хватает ${CONFIG.deckSize - draft.cards.length} карт до полной колоды`
                  : 'Сохранить колоду'
              }
            >
              ✓ Сохранить
            </button>

            {/* Random Fill Button */}
            <button
              type="button"
              className="cw-random-btn cw-btn-3d btn-orange btn-sm"
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
          </div>

          <div className="cw-right-name-row">
            <input
              type="text"
              className="cw-control cw-deck-name-input"
              placeholder="Название колоды…"
              maxLength={40}
              style={{ fontSize: '16px', borderRadius: '10px' }}
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
                  className="cw-btn-3d btn-orange btn-sm"
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
                      className="cw-grouped-btn cw-grouped-minus cw-btn-3d btn-red btn-sm"
                      onClick={() => removeCardAtIndex(group.indices[group.indices.length - 1]!)}
                      aria-label={`Убрать копию ${group.card.name}`}
                      title="Убрать копию"
                    >
                      −
                    </button>
                    <span className="cw-grouped-count">×{group.count}</span>
                    <button
                      type="button"
                      className="cw-grouped-btn cw-grouped-plus cw-btn-3d btn-green btn-sm"
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

      {/* Hero Visual Picker Dialog */}
      <dialog
        ref={heroDialogRef}
        className="cw-dialog cw-dialog--heroes cw-felt-box"
        aria-labelledby="hero-picker-dialog-title"
        {...({ closedby: 'any' } as Record<string, string>)}
        onPointerDown={(e) => {
          if (!('closedBy' in HTMLDialogElement.prototype)) {
            heroOutsideRef.current = isPointerOutside(e);
          }
        }}
        onPointerUp={(e) => {
          if (!('closedBy' in HTMLDialogElement.prototype) && heroOutsideRef.current && isPointerOutside(e)) {
            e.currentTarget.close();
          }
          heroOutsideRef.current = false;
        }}
        onClose={() => setHeroPickerOpen(false)}
      >
        <div className="cw-dialog__head">
          <h2 id="hero-picker-dialog-title" className="cw-ink-title">
            Выбор героя ({heroes.length})
          </h2>
          <button
            type="button"
            className="cw-dialog__close cw-btn-3d btn-dark btn-sm"
            onClick={() => setHeroPickerOpen(false)}
            aria-label="Закрыть выбор героя"
          >
            ✕
          </button>
        </div>
        <div className="cw-dialog__body">
          <input
            type="search"
            autoFocus
            className="cw-hero-picker-search cw-control"
            placeholder="Поиск героя по имени или способности…"
            style={{ fontSize: '16px', borderRadius: '10px' }}
            value={heroSearch}
            onChange={(e) => setHeroSearch(e.target.value)}
          />
          <div className="cw-hero-picker-grid">
            {filteredHeroes.map((item) => {
              const isSelected = item.id === draft.heroId;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`cw-hero-picker-card ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => {
                    setDraft((d) => ({ ...d, heroId: item.id }));
                    setHeroPickerOpen(false);
                  }}
                  title={`${item.name}${item.text ? ` — ${item.text}` : ''}`}
                >
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                  ) : (
                    <span>{item.name}</span>
                  )}
                  <span className="cw-hero-picker-name">{item.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </dialog>

      {/* Land & Art Picker Dialog */}
      <dialog
        ref={landDialogRef}
        className="cw-dialog cw-dialog--lands cw-felt-box"
        aria-labelledby="land-picker-dialog-title"
        {...({ closedby: 'any' } as Record<string, string>)}
        onPointerDown={(e) => {
          if (!('closedBy' in HTMLDialogElement.prototype)) {
            landOutsideRef.current = isPointerOutside(e);
          }
        }}
        onPointerUp={(e) => {
          if (!('closedBy' in HTMLDialogElement.prototype) && landOutsideRef.current && isPointerOutside(e)) {
            e.currentTarget.close();
          }
          landOutsideRef.current = false;
        }}
        onClose={() => setOpenLandSlot(null)}
      >
        {openLandSlot !== null && (
          <>
            <div className="cw-dialog__head">
              <h2 id="land-picker-dialog-title" className="cw-ink-title">
                Земля для слота #{openLandSlot + 1}
              </h2>
              <button
                type="button"
                className="cw-dialog__close cw-btn-3d btn-dark btn-sm"
                onClick={() => setOpenLandSlot(null)}
                aria-label="Закрыть выбор земли"
              >
                ✕
              </button>
            </div>
            <div className="cw-dialog__body">
              <div className="cw-land-type-tabs" role="tablist" aria-label="Типы земель">
                {PLAYABLE_LAND_TYPES.map((type) => {
                  const isActive = activeLandTab === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`cw-land-type-tab ${isActive ? 'is-active' : ''}`}
                      onClick={() => setActiveLandTab(type)}
                    >
                      {LAND_META[type].shortLabel}
                    </button>
                  );
                })}
              </div>

              <div className="cw-land-art-grid">
                {landArtsForTab.map((art) => {
                  const isSelected =
                    draft.lands[openLandSlot] === art.landType &&
                    draft.landIds?.[openLandSlot] === art.id;
                  return (
                    <button
                      key={art.id}
                      type="button"
                      className={`cw-land-art-option ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => setLandArt(openLandSlot, art.landType, art.id)}
                      title={`${art.name} (${LAND_META[art.landType].label})`}
                    >
                      <img
                        src={art.image}
                        alt={art.name}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="cw-dialog__actions">
              <button
                type="button"
                className="cw-btn-3d btn-dark btn-sm"
                disabled={openLandSlot <= 0}
                onClick={() => {
                  if (openLandSlot > 0) {
                    swapLands(openLandSlot, openLandSlot - 1);
                    setOpenLandSlot(openLandSlot - 1);
                  }
                }}
              >
                ◀ Левее
              </button>
              <button
                type="button"
                className="cw-btn-3d btn-dark btn-sm"
                disabled={openLandSlot >= CONFIG.landsPerPlayer - 1}
                onClick={() => {
                  if (openLandSlot < CONFIG.landsPerPlayer - 1) {
                    swapLands(openLandSlot, openLandSlot + 1);
                    setOpenLandSlot(openLandSlot + 1);
                  }
                }}
              >
                Правее ▶
              </button>
            </div>
          </>
        )}
      </dialog>

      {/* Dialog: Confirm Clear Deck */}
      <dialog
        ref={clearDialogRef}
        className="cw-dialog cw-felt-box"
        aria-labelledby="clear-deck-dialog-title"
        {...({ closedby: 'any' } as Record<string, string>)}
        onPointerDown={(e) => {
          if (!('closedBy' in HTMLDialogElement.prototype)) {
            clearOutsideRef.current = isPointerOutside(e);
          }
        }}
        onPointerUp={(e) => {
          if (!('closedBy' in HTMLDialogElement.prototype) && clearOutsideRef.current && isPointerOutside(e)) {
            e.currentTarget.close();
          }
          clearOutsideRef.current = false;
        }}
        onClose={() => setConfirmClear(false)}
      >
        <div className="cw-dialog__head">
          <h2 id="clear-deck-dialog-title" className="cw-ink-title">
            Очистить колоду?
          </h2>
          <button
            type="button"
            className="cw-dialog__close cw-btn-3d btn-dark btn-sm"
            onClick={() => setConfirmClear(false)}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
        <div className="cw-dialog__body">
          <p className="hint">Все набранные карты ({draft.cards.length} шт.) будут убраны из колоды.</p>
        </div>
        <div className="cw-dialog__actions">
          <button
            type="button"
            autoFocus
            className="cw-btn-3d btn-dark btn-sm"
            onClick={() => setConfirmClear(false)}
          >
            Отмена
          </button>
          <button
            type="button"
            className="cw-btn-3d btn-red btn-sm"
            onClick={() => {
              setDraft((d) => ({ ...d, cards: [] }));
              setConfirmClear(false);
              showToast('Колода очищена');
            }}
          >
            Очистить
          </button>
        </div>
      </dialog>

      {/* Dialog: Confirm Re-roll Deck */}
      <dialog
        ref={rerollDialogRef}
        className="cw-dialog cw-felt-box"
        aria-labelledby="reroll-deck-dialog-title"
        {...({ closedby: 'any' } as Record<string, string>)}
        onPointerDown={(e) => {
          if (!('closedBy' in HTMLDialogElement.prototype)) {
            rerollOutsideRef.current = isPointerOutside(e);
          }
        }}
        onPointerUp={(e) => {
          if (!('closedBy' in HTMLDialogElement.prototype) && rerollOutsideRef.current && isPointerOutside(e)) {
            e.currentTarget.close();
          }
          rerollOutsideRef.current = false;
        }}
        onClose={() => setConfirmReroll(false)}
      >
        <div className="cw-dialog__head">
          <h2 id="reroll-deck-dialog-title" className="cw-ink-title">
            Пересобрать колоду случайно?
          </h2>
          <button
            type="button"
            className="cw-dialog__close cw-btn-3d btn-dark btn-sm"
            onClick={() => setConfirmReroll(false)}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
        <div className="cw-dialog__body">
          <p className="hint">
            В колоде уже 40 карт. Все текущие карты будут заменены сбалансированным случайным набором под выбранные земли.
          </p>
        </div>
        <div className="cw-dialog__actions">
          <button
            type="button"
            autoFocus
            className="cw-btn-3d btn-dark btn-sm"
            onClick={() => setConfirmReroll(false)}
          >
            Отмена
          </button>
          <button
            type="button"
            className="cw-btn-3d btn-orange btn-sm"
            onClick={handleRerollConfirmed}
          >
            🎲 Заполнить заново
          </button>
        </div>
      </dialog>
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
  index?: number;
  inDeck: boolean;
  count?: number;
  favorite: boolean;
  onAdd: (card: CardData) => void;
  onToggleFavorite: (cardId: string) => void;
}

const CatalogCardTile = memo(
  function CatalogCardTile({
    card,
    index = 0,
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
              loading="eager"
              fetchPriority={index < 48 ? 'high' : 'auto'}
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
              loading="eager"
              fetchPriority="high"
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
