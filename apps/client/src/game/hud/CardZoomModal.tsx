import { useEffect } from 'react';
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
  ghost: 'Призрачные земли',
};

const TYPE_NAMES: Record<string, string> = {
  creature: 'Существо',
  building: 'Строение',
  spell: 'Заклинание',
  companion: 'Парная',
};

export function CardZoomModal() {
  const zoomed = useGame((s) => s.ui.zoomedCard);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUi({ zoomedCard: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  if (!zoomed) return null;

  const card: CardData | undefined = catalog.find((c) => c.id === zoomed.cardId);
  const cardName = card?.name ?? zoomed.cardId;
  const landLabel = card?.landType ? LAND_NAMES[card.landType] ?? card.landType : 'Нейтральная';
  const typeLabel = card?.type ? TYPE_NAMES[card.type] ?? card.type : 'Карта';
  const hasDamage = (zoomed.damage ?? 0) > 0;
  const hasShield = (zoomed.shield ?? 0) > 0;
  const currentHp = card?.type === 'creature' && card.defense !== undefined
    ? Math.max(0, card.defense - (zoomed.damage ?? 0))
    : null;

  return (
    <div
      className="card-zoom-backdrop"
      onClick={() => setUi({ zoomedCard: null })}
      role="dialog"
      aria-modal="true"
      aria-label={`Осмотр карты ${cardName}`}
    >
      <div className="card-zoom-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="card-zoom-header">
          <div className="card-zoom-title-group">
            <h2 className="card-zoom-title">{cardName}</h2>
            <div className="card-zoom-tags">
              <span className={`card-zoom-tag land-${card?.landType ?? 'rainbow'}`}>{landLabel}</span>
              <span className="card-zoom-tag type">{typeLabel}</span>
              <span className="card-zoom-tag cost">⚡ {card?.cost ?? 0}</span>
            </div>
          </div>
          <button
            className="card-zoom-close"
            onClick={() => setUi({ zoomedCard: null })}
            aria-label="Закрыть просмотр"
          >
            ✕
          </button>
        </div>

        <div className="card-zoom-body">
          <div className="card-zoom-image-col">
            {card?.image ? (
              <img
                src={card.image}
                alt={cardName}
                className="card-zoom-img"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <div className={`card-zoom-fallback land-${card?.landType ?? 'rainbow'}`}>
                <div className="fallback-cost">{card?.cost ?? 0}</div>
                <div className="fallback-name">{cardName}</div>
                <div className="fallback-type">{typeLabel}</div>
              </div>
            )}
          </div>

          <div className="card-zoom-details">
            {card?.type === 'creature' && (
              <div className="card-zoom-stats">
                <div className="stat-box attack">
                  <span className="stat-label">Атака</span>
                  <span className="stat-value">{card.attack ?? 0}</span>
                </div>
                <div className="stat-box defense">
                  <span className="stat-label">Защита</span>
                  <span className="stat-value">{card.defense ?? 0}</span>
                </div>
                {currentHp !== null && hasDamage && (
                  <div className="stat-box current-hp">
                    <span className="stat-label">Текущие HP</span>
                    <span className="stat-value">{currentHp}</span>
                    <span className="stat-sub">(-{zoomed.damage})</span>
                  </div>
                )}
                {hasShield && (
                  <div className="stat-box shield">
                    <span className="stat-label">Щит</span>
                    <span className="stat-value">+{zoomed.shield}</span>
                  </div>
                )}
              </div>
            )}

            {zoomed.flipped !== undefined && (
              <div className="card-zoom-status">
                <span className="status-label">Состояние на столе:</span>
                <span className={`status-badge ${zoomed.flipped ? 'flooped' : 'ready'}`}>
                  {zoomed.flipped ? 'Флюпнуто (повернуто)' : 'Готово к действию'}
                </span>
              </div>
            )}

            <div className="card-zoom-description">
              <h3>Описание:</h3>
              <p>{card?.description || 'Нет описания'}</p>
            </div>

            {card?.abilities && card.abilities.length > 0 && (
              <div className="card-zoom-abilities">
                <h3>Способности:</h3>
                <ul>
                  {card.abilities.map((ab, i) => (
                    <li key={i} className={`ability-item ${ab.kind}`}>
                      <span className="ability-kind">
                        {ab.kind === 'active' ? '⚡ Прием (Флюп)' : ab.kind === 'passive' ? '✨ Пассивная' : '🎯 Триггер'}:
                      </span>{' '}
                      <span className="ability-text">{ab.text || ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
