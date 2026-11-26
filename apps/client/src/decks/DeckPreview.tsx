import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { catalog, cards, heroes, type CardData, type LandType } from '@card-wars/content';
import { computeZoomOrigin } from './cardZoom';
import { LAND_META, resolveLandImageUrl } from './landImages';

const cardById = new Map(cards.map((c) => [c.id, c]));
const TARGET_ZOOM_WIDTH_PX = 224;
const HOLD_DELAY_MS = 180;

function applyDynamicZoom(slotEl: HTMLElement) {
  const visual = slotEl.querySelector<HTMLElement>('.deck-preview__visual');
  if (!visual) return;
  const rect = slotEl.getBoundingClientRect();
  const scale = rect.width > 0 ? Math.max(2.8, Math.min(6.2, TARGET_ZOOM_WIDTH_PX / rect.width)) : 3.8;
  visual.style.setProperty('--preview-zoom-scale', scale.toFixed(2));
  visual.style.transformOrigin = computeZoomOrigin(slotEl, scale);
}

export interface DeckPreviewData {
  heroId: string;
  lands: string[];
  landIds?: (string | null)[];
  cards: string[];
}

export function DeckPreview({
  deck,
  compact = false,
}: {
  deck: DeckPreviewData;
  compact?: boolean;
}) {
  const hero = heroes.find((h) => h.id === deck.heroId) ?? heroes[0];
  const [holdKey, setHoldKey] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const { manaCurve, typeCounts } = useMemo(() => {
    const curve: Record<'0' | '1' | '2' | '3+', number> = { '0': 0, '1': 0, '2': 0, '3+': 0 };
    const types = { creature: 0, spell: 0, building: 0 };
    for (const cardId of deck.cards) {
      const card = catalog.getCard(cardId) ?? cardById.get(cardId);
      if (!card) continue;
      if (card.cost <= 0) curve['0']++;
      else if (card.cost === 1) curve['1']++;
      else if (card.cost === 2) curve['2']++;
      else curve['3+']++;

      if (card.type === 'creature') types.creature++;
      else if (card.type === 'spell') types.spell++;
      else if (card.type === 'building') types.building++;
    }
    return { manaCurve: curve, typeCounts: types };
  }, [deck.cards]);

  const maxCurve = Math.max(1, manaCurve['0'], manaCurve['1'], manaCurve['2'], manaCurve['3+']);

  const clearHold = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
    setHoldKey(null);
  };

  const onPointerDown = (key: string, e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.currentTarget;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      applyDynamicZoom(el);
      setHoldKey(key);
    }, HOLD_DELAY_MS);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!startPosRef.current || timerRef.current === null) return;
    if (Math.hypot(e.clientX - startPosRef.current.x, e.clientY - startPosRef.current.y) > 10) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      startPosRef.current = null;
    }
  };

  const onMouseEnter = (e: ReactMouseEvent<HTMLElement>) => {
    applyDynamicZoom(e.currentTarget);
  };

  return (
    <div className={`deck-preview ${compact ? 'deck-preview--compact' : ''}`}>
      <div className="deck-preview__top">
        {hero && (
          <div
            className={`deck-preview__hero ${holdKey === 'hero' ? 'is-zoomed' : ''}`}
            onMouseEnter={onMouseEnter}
            onPointerDown={(e) => onPointerDown('hero', e)}
            onPointerMove={onPointerMove}
            onPointerUp={clearHold}
            onPointerCancel={clearHold}
            onPointerLeave={clearHold}
            title={`${hero.name}${hero.text ? ` — ${hero.text}` : ''}`}
          >
            <div className="deck-preview__visual">
              {hero.image ? (
                <img src={hero.image} alt={hero.name} draggable={false} fetchPriority="high" />
              ) : (
                <span className="deck-preview__hero-fallback">{hero.name}</span>
              )}
            </div>
          </div>
        )}

        <div className="deck-preview__lands">
          {deck.lands.map((landType, idx) => {
            const meta = LAND_META[landType as LandType] ?? {
              label: landType,
              shortLabel: landType,
            };
            const imgUrl = resolveLandImageUrl(landType as LandType, deck.landIds?.[idx], idx + 1);
            return (
              <div
                key={idx}
                className={`deck-preview__land land-bg--${landType}`}
                title={`${idx + 1}. ${meta.label}`}
              >
                {imgUrl && <img src={imgUrl} alt={meta.label} draggable={false} fetchPriority="high" />}
                <span className="deck-preview__land-label">{meta.shortLabel}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="deck-preview__meta">
        <div className="cw-type-breakdown" aria-label="Состав колоды по типам">
          <span className="cw-type-pill cw-type-pill--creature" title={`Существа: ${typeCounts.creature}`}>
            <span className="cw-type-icon" aria-hidden="true">⚔️</span>
            <span className="cw-type-count">{typeCounts.creature}</span>
          </span>
          <span className="cw-type-pill cw-type-pill--spell" title={`Заклинания: ${typeCounts.spell}`}>
            <span className="cw-type-icon" aria-hidden="true">✨</span>
            <span className="cw-type-count">{typeCounts.spell}</span>
          </span>
          <span className="cw-type-pill cw-type-pill--building" title={`Строения: ${typeCounts.building}`}>
            <span className="cw-type-icon" aria-hidden="true">🏛️</span>
            <span className="cw-type-count">{typeCounts.building}</span>
          </span>
        </div>

        <div
          className="cw-mana-curve"
          aria-label="Распределение по стоимости (кривая маны)"
          title={`Кривая маны: 0 AP (${manaCurve['0']}), 1 AP (${manaCurve['1']}), 2 AP (${manaCurve['2']}), 3+ AP (${manaCurve['3+']})`}
        >
          {(['0', '1', '2', '3+'] as const).map((costKey) => {
            const count = manaCurve[costKey];
            const pct = count > 0 ? Math.max(16, Math.round((count / maxCurve) * 100)) : 0;
            return (
              <div key={costKey} className="cw-curve-col" title={`${costKey} AP: ${count} карт`}>
                <div className="cw-curve-bar-wrap">
                  {count > 0 && <span className="cw-curve-count">{count}</span>}
                  <div
                    className="cw-curve-bar"
                    style={{ height: `${pct}%` }}
                  />
                </div>
                <span className="cw-curve-label">{costKey}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="deck-preview__cards">
        {deck.cards.map((cardId, idx) => {
          const card: CardData | undefined = catalog.getCard(cardId) ?? cardById.get(cardId);
          const key = `card-${idx}`;
          return (
            <div
              key={`${cardId}-${idx}`}
              className={`deck-preview__card ${holdKey === key ? 'is-zoomed' : ''}`}
              onMouseEnter={onMouseEnter}
              onPointerDown={(e) => onPointerDown(key, e)}
              onPointerMove={onPointerMove}
              onPointerUp={clearHold}
              onPointerCancel={clearHold}
              onPointerLeave={clearHold}
              title={card ? `${card.name} (${card.cost})` : cardId}
            >
              <div className="deck-preview__visual">
                {card?.image ? (
                  <img src={card.image} alt={card.name} loading="eager" draggable={false} />
                ) : (
                  <span className="deck-preview__card-fallback">{card?.name ?? cardId}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
