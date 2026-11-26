import { useEffect, useRef, useState } from 'react';
import { cards as catalog, type CardData } from '@card-wars/content';
import { setUi, useGame } from '../../store';

const LAND_NAMES: Record<string, string> = {
  corn: 'Кукурузные поля',
  blue: 'Синие равнины',
  good: 'Добрые земли',
  ice: 'Ледяные земли',
  sand: 'Песчаные земли',
  swamp: 'Болотные земли',
  rainbow: 'Радужные земли',
  lava: 'Лавовые земли',
};

const TYPE_NAMES: Record<string, string> = {
  creature: 'Существо',
  building: 'Строение',
  spell: 'Заклинание',
  companion: 'Парная',
};

export function CardZoomModal() {
  const zoomed = useGame((s) => s.ui.zoomedCard);
  const [imgError, setImgError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerDownOutsideRef = useRef(false);

  useEffect(() => {
    setImgError(false);
  }, [zoomed?.cardId]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (zoomed) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [zoomed]);

  if (!zoomed) return null;

  const card: CardData | undefined = catalog.find((c) => c.id === zoomed.cardId);
  const cardName = card?.name ?? zoomed.cardId;
  const landType = card?.landType ?? 'rainbow';
  const landLabel = card?.landType ? LAND_NAMES[card.landType] ?? card.landType : 'Нейтральная';
  const typeLabel = card?.type ? TYPE_NAMES[card.type] ?? card.type : 'Карта';
  const hasDamage = (zoomed.damage ?? 0) > 0;
  const hasShield = (zoomed.shield ?? 0) > 0;
  const currentHp =
    card?.type === 'creature' && card.defense !== undefined
      ? Math.max(0, card.defense - (zoomed.damage ?? 0))
      : null;

  const handleClose = () => {
    setUi({ zoomedCard: null });
  };

  const isOutsideDialog = (e: React.PointerEvent<HTMLDialogElement>) => {
    const el = dialogRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    );
  };

  return (
    <dialog
      ref={dialogRef}
      className="cw-dialog cw-dialog--card-zoom cw-felt-box"
      aria-labelledby="card-zoom-title"
      onClose={handleClose}
      onPointerDown={(e) => {
        pointerDownOutsideRef.current = e.target === dialogRef.current && isOutsideDialog(e);
      }}
      onPointerUp={(e) => {
        if (pointerDownOutsideRef.current && e.target === dialogRef.current && isOutsideDialog(e)) {
          handleClose();
        }
        pointerDownOutsideRef.current = false;
      }}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="cw-dialog__head">
        <div className="card-zoom-title-row">
          <span aria-hidden="true">🔍</span>
          <h2 id="card-zoom-title" className="cw-ink-title">
            {cardName}
          </h2>
        </div>
        <button
          type="button"
          className="cw-dialog__close cw-btn-3d btn-dark btn-sm"
          onClick={handleClose}
          aria-label="Закрыть просмотр"
        >
          ✕
        </button>
      </div>

      <div className="card-zoom-layout">
        <div className="card-zoom-art-wrap">
          {card?.image && !imgError ? (
            <img
              src={card.image}
              alt={cardName}
              className="card-zoom-art"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className={`card-zoom-fallback land-${landType}`}>
              <div className="fallback-cost">⚡ {card?.cost ?? 0}</div>
              <div className="fallback-name">{cardName}</div>
              <div className="fallback-type">{typeLabel}</div>
            </div>
          )}
        </div>

        <div className="card-zoom-info">
          <div className="card-zoom-tags">
            <span className={`card-zoom-tag land-${landType}`}>{landLabel}</span>
            <span className="card-zoom-tag type-tag">{typeLabel}</span>
            <span className="card-zoom-tag cost-tag">⚡ {card?.cost ?? 0}</span>
          </div>

          {card?.type === 'creature' && (
            <div className="card-zoom-stats">
              <div className="card-zoom-stat-pill stat-atk" title="Атака">
                <span className="stat-icon">⚔️</span>
                <span className="stat-val">{card.attack ?? 0}</span>
                <span className="stat-lbl">АТК</span>
              </div>
              <div className="card-zoom-stat-pill stat-def" title="Защита">
                <span className="stat-icon">🛡️</span>
                <span className="stat-val">{card.defense ?? 0}</span>
                <span className="stat-lbl">ЗАЩ</span>
              </div>
              {currentHp !== null && hasDamage && (
                <div className="card-zoom-stat-pill stat-hp" title="Текущее здоровье">
                  <span className="stat-icon">❤️</span>
                  <span className="stat-val">{currentHp}</span>
                  <span className="stat-dmg">(-{zoomed.damage})</span>
                </div>
              )}
              {hasShield && (
                <div className="card-zoom-stat-pill stat-shield" title="Щит">
                  <span className="stat-icon">✨</span>
                  <span className="stat-val">+{zoomed.shield}</span>
                  <span className="stat-lbl">Щит</span>
                </div>
              )}
            </div>
          )}

          {zoomed.flipped !== undefined && (
            <div className="card-zoom-status">
              <span className="status-label">На поле:</span>
              <span className={`status-pill ${zoomed.flipped ? 'is-flooped' : 'is-ready'}`}>
                {zoomed.flipped ? '🌀 Флюпнуто' : '⚡ Готово к бою'}
              </span>
            </div>
          )}

          {card?.abilities && card.abilities.length > 0 && (
            <div className="card-zoom-abilities">
              <div className="section-label">Способности:</div>
              {card.abilities.map((ab, idx) => (
                <div key={idx} className={`card-zoom-ability ${ab.kind}`}>
                  <span className="ability-badge">
                    {ab.kind === 'active'
                      ? '⚡ Флюп'
                      : ab.kind === 'passive'
                      ? '✨ Пассив'
                      : '🎯 Триггер'}
                  </span>
                  <span className="ability-desc">{ab.text || ''}</span>
                </div>
              ))}
            </div>
          )}

          {(card?.description || !card?.abilities?.length) && (
            <div className="card-zoom-flavor cw-paper-box">
              <p className="flavor-text">{card?.description || 'Нет описания'}</p>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
