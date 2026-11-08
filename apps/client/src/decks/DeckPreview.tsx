import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cards, heroes, type CardData, type LandType } from '@card-wars/content';
import { computeZoomOrigin } from './cardZoom';

const LAND_META: Record<string, { label: string; shortLabel: string; prefix: string | null }> = {
  corn: { label: 'Кукурузные поля', shortLabel: 'Кукуруза', prefix: 'land_corn' },
  blue: { label: 'Синие равнины', shortLabel: 'Синие', prefix: 'land_blue' },
  good: { label: 'Милые земли', shortLabel: 'Милые', prefix: 'land_nice' },
  ice: { label: 'Ледяные земли', shortLabel: 'Лёд', prefix: 'land_icy' },
  sand: { label: 'Песчаные земли', shortLabel: 'Песок', prefix: 'land_sandy' },
  swamp: { label: 'Болото', shortLabel: 'Болото', prefix: 'land_swamp' },
  rainbow: { label: 'Радужная земля', shortLabel: 'Радуга', prefix: null },
  ghost: { label: 'Призрачные земли', shortLabel: 'Призраки', prefix: 'land_ghost' },
};

function landImageUrl(type: string, variant = 1): string | null {
  const meta = LAND_META[type];
  if (!meta?.prefix) return null;
  const v = ((variant - 1) % 4) + 1;
  return `/content/lands/images/${meta.prefix}_${v}.png`;
}

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
            title={`${hero.name}${hero.description ? ` — ${hero.description}` : ''}`}
          >
            <div className="deck-preview__visual">
              {hero.image ? (
                <img src={hero.image} alt={hero.name} draggable={false} />
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
              prefix: null,
            };
            const imgUrl = landImageUrl(landType, idx + 1);
            return (
              <div
                key={idx}
                className={`deck-preview__land land-bg--${landType}`}
                title={`${idx + 1}. ${meta.label}`}
              >
                {imgUrl && <img src={imgUrl} alt={meta.label} draggable={false} />}
                <span className="deck-preview__land-label">{meta.shortLabel}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="deck-preview__cards">
        {deck.cards.map((cardId, idx) => {
          const card: CardData | undefined = cardById.get(cardId);
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
                  <img src={card.image} alt={card.name} loading="lazy" draggable={false} />
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
