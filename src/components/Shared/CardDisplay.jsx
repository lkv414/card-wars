/**
 * CardDisplay — тонкая обёртка над CardFace.
 *
 * Исторически это был «единый» компонент карты, но он оставался отдельным
 * лицом: собственная разметка, свой CSS, собственная логика полей, эмодзи
 * и жёсткие `card.card_type` вместо нормализации. Аудит §2.2-2.3 показал,
 * что из-за этого колода, админка, рука и превью показывали разное.
 *
 * Теперь разметка и стили живут в CardFace, а здесь только совместимость
 * API для существующих потребителей. Новый код должен использовать CardFace.
 *
 * Режимы сохранены 1:1:
 *   'hand' — арт + стоимость (HUDHand)
 *   'tile' — плитка (CardTile, AdminCardTile)
 *   'full' — превью (CardPreviewModal)
 */
import { memo } from 'react'

import { CardFace } from './CardFace'

export const CardDisplay = memo(function CardDisplay({
  card,
  mode = 'tile',
  onClick,
  selected = false,
  showDescription = false,
  className = '',
}) {
  return (
    <CardFace
      card={card}
      mode={mode}
      onClick={onClick}
      selected={selected}
      showDescription={showDescription}
      className={`card-display card-display--${mode} ${className}`.trim()}
    />
  )
})

export default CardDisplay