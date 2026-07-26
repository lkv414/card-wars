/**
 * DeckActions — плавающие кнопки поверх редактора колоды.
 *
 * Показываются только если в колоде есть хотя бы одна карта/земля.
 *   - 🗑️ Очистить (слева внизу, открывает ConfirmDialog в DeckBuilder)
 *   - 💾 Сохранить (правая нижняя, большой стиль)
 *   - Твоя колода (правая нижняя, открывает DeckModal)
 *
 * ConfirmDialog остаётся в DeckBuilder.jsx — он использует общий state.
 */

export function DeckActions({ cardTotal, landTotal, onClear, onSave, onOpenDeck }) {
  const hasCards = cardTotal + landTotal > 0
  if (!hasCards) return null

  return (
    <>
      <button
        type="button"
        className="panel-button bottom-left trash-btn"
        title="Очистить колоду"
        aria-label="Очистить колоду"
        onClick={onClear}
      >
        🗑️
      </button>

      <button
        type="button"
        className="panel-button bottom-right"
        onClick={onOpenDeck}
      >
        Твоя колода
      </button>

      <button
        type="button"
        className="panel-button save-btn"
        onClick={onSave}
        style={{
          position: 'fixed',
          bottom: '5rem',
          right: '1.5rem',
          background: 'linear-gradient(135deg, #4caf50 0%, #45a049 100%)',
          color: 'white',
          border: 'none',
          padding: '0.75rem 1.25rem',
          borderRadius: '12px',
          fontWeight: 700,
          cursor: 'pointer',
          fontSize: '1rem',
          boxShadow: '0 4px 16px rgba(76, 175, 80, 0.4)',
          zIndex: 10,
        }}
        title="Сохранить колоду"
      >
        💾 Сохранить
      </button>
    </>
  )
}
