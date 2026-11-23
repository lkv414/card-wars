import { useEffect, useState } from 'react';
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

/**
 * Permanent left-hand Card Inspector widget (docs/AUDIT-KIBERBUS-UIUX.md §3.2, §8 Этап 2).
 * Displays rich card art, stats, and text immediately on hover/tap without requiring modal dialogs.
 */
export function CardInspector() {
  const inspected = useGame((s) => s.ui.inspectedCard);
  const zoomed = useGame((s) => s.ui.zoomedCard);
  const collapsed = useGame((s) => s.ui.inspectorCollapsed);
  const [imgError, setImgError] = useState(false);

  // Active target is either hovered/tapped inspected card or zoomed card
  const activeInfo = inspected ?? zoomed;

  useEffect(() => {
    setImgError(false);
  }, [activeInfo?.cardId]);

  const toggleCollapsed = () => {
    setUi({ inspectorCollapsed: !collapsed });
  };

  if (collapsed) {
    return (
      <div className="card-inspector-collapsed" aria-label="Инспектор карты">
        <button
          className="card-inspector-tab-btn cw-btn-3d btn-dark btn-sm"
          onClick={toggleCollapsed}
          title="Развернуть инспектор карт (Осмотр)"
          aria-label="Развернуть инспектор карт"
        >
          <span>🔍</span>
          <span className="tab-label">Инспектор</span>
        </button>
      </div>
    );
  }

  const card: CardData | undefined = activeInfo
    ? catalog.find((c) => c.id === activeInfo.cardId)
    : undefined;

  const cardName = card?.name ?? (activeInfo ? activeInfo.cardId : null);
  const landLabel = card?.landType ? LAND_NAMES[card.landType] ?? card.landType : 'Нейтральная';
  const typeLabel = card?.type ? TYPE_NAMES[card.type] ?? card.type : 'Карта';
  const hasDamage = (activeInfo?.damage ?? 0) > 0;
  const hasShield = (activeInfo?.shield ?? 0) > 0;
  const currentHp =
    card?.type === 'creature' && card.defense !== undefined
      ? Math.max(0, card.defense - (activeInfo?.damage ?? 0))
      : null;

  return (
    <aside
      className="card-inspector-panel cw-felt-box"
      aria-label="Инспектор активной карты"
    >
      <div className="card-inspector-header">
        <div className="card-inspector-title-row">
          <span className="inspector-badge-icon">🔍</span>
          <h3 className="inspector-heading cw-ink-title">
            {cardName ?? 'Осмотр карты'}
          </h3>
          <button
            className="inspector-close-btn"
            onClick={toggleCollapsed}
            title="Свернуть инспектор"
            aria-label="Свернуть инспектор"
          >
            ◀
          </button>
        </div>
      </div>

      <div className="card-inspector-content">
        {!card ? (
          <div className="card-inspector-placeholder">
            <div className="placeholder-icon">🎴</div>
            <p className="placeholder-text">
              Наведите курсор или зажмите карту на столе или в руке для детального просмотра
            </p>
          </div>
        ) : (
          <div className="card-inspector-details">
            {/* Card Preview Art */}
            <div className="inspector-art-container">
              {card.image && !imgError ? (
                <img
                  src={card.image}
                  alt={cardName!}
                  className="inspector-card-art"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className={`inspector-card-fallback land-${card.landType ?? 'rainbow'}`}>
                  <div className="fallback-cost">⚡ {card.cost ?? 0}</div>
                  <div className="fallback-name">{cardName}</div>
                  <div className="fallback-type">{typeLabel}</div>
                </div>
              )}
            </div>

            {/* Tags: Land, Type, Cost */}
            <div className="inspector-tags">
              <span className={`inspector-tag land-${card.landType ?? 'rainbow'}`}>
                {landLabel}
              </span>
              <span className="inspector-tag type-tag">{typeLabel}</span>
              <span className="inspector-tag cost-tag">⚡ {card.cost ?? 0}</span>
            </div>

            {/* Stats row for creatures */}
            {card.type === 'creature' && (
              <div className="inspector-stats-row">
                <div className="stat-pill stat-atk" title="Атака">
                  <span className="stat-icon">⚔️</span>
                  <span className="stat-val">{card.attack ?? 0}</span>
                  <span className="stat-lbl">АТК</span>
                </div>
                <div className="stat-pill stat-def" title="Защита">
                  <span className="stat-icon">🛡️</span>
                  <span className="stat-val">{card.defense ?? 0}</span>
                  <span className="stat-lbl">ЗАЩ</span>
                </div>
                {currentHp !== null && hasDamage && (
                  <div className="stat-pill stat-hp" title="Текущее здоровье">
                    <span className="stat-icon">❤️</span>
                    <span className="stat-val">{currentHp}</span>
                    <span className="stat-dmg">(-{activeInfo?.damage})</span>
                  </div>
                )}
                {hasShield && (
                  <div className="stat-pill stat-shield" title="Щит">
                    <span className="stat-icon">✨</span>
                    <span className="stat-val">+{activeInfo?.shield}</span>
                  </div>
                )}
              </div>
            )}

            {/* Board Status */}
            {activeInfo?.flipped !== undefined && (
              <div className="inspector-board-status">
                <span className="status-label">На поле:</span>
                <span className={`status-pill ${activeInfo.flipped ? 'is-flooped' : 'is-ready'}`}>
                  {activeInfo.flipped ? '🌀 Флюпнуто' : '⚡ Готово к бою'}
                </span>
              </div>
            )}

            {/* Abilities */}
            {card.abilities && card.abilities.length > 0 && (
              <div className="inspector-abilities-list">
                <div className="section-label">Способности:</div>
                {card.abilities.map((ab, idx) => (
                  <div key={idx} className={`inspector-ability-item ${ab.kind}`}>
                    <span className="ability-badge">
                      {ab.kind === 'active'
                        ? '⚡ Флюп'
                        : ab.kind === 'passive'
                        ? '✨ Пассив'
                        : '🎯 Триггер'}
                    </span>
                    <span className="ability-desc">{ab.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Flavor description */}
            {card.description && (
              <div className="inspector-flavor-box cw-paper-box">
                <p className="flavor-text">{card.description}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
