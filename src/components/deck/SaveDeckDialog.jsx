/**
 * SaveDeckDialog — двухшаговый диалог сохранения колоды.
 *
 * Шаг 'form': ввод имени + кнопки «Отмена» / «Сохранить»
 * Шаг 'success': показ кода колоды + кнопка копирования + переход на /decks
 *
 * Закрытие по клику на overlay или Escape.
 * Enter в поле имени = сохранить.
 *
 * Props:
 *   - open: boolean
 *   - step: 'form' | 'success'
 *   - onClose: () => void
 *   - onConfirm: () => void  (вызывается при клике «Сохранить»)
 *   - onCopyCode: () => Promise<void>
 *   - onGoToDecks: () => void
 *   - saveName, cardTotal, landTotal
 *   - setSaveName: (name: string) => void
 *   - savedDeck: { name, code } | null
 *   - codeCopied: boolean
 */

export function SaveDeckDialog({
  open,
  step,
  saveName,
  setSaveName,
  cardTotal,
  landTotal,
  savedDeck,
  codeCopied,
  onClose,
  onConfirm,
  onCopyCode,
  onGoToDecks,
}) {
  if (!open) return null

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') onConfirm()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className="save-dialog-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="save-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'form' ? (
          <>
            <h2 id="save-dialog-title">Сохранить колоду</h2>
            <p className="save-dialog-hint">
              Будет сохранено: {cardTotal} карт, {landTotal} земель
            </p>
            <label>
              Название:
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Например: Основная колода"
                autoFocus
                onKeyDown={handleKeyDown}
              />
            </label>
            <div className="save-dialog-actions">
              <button type="button" className="cancel-btn" onClick={onClose}>
                Отмена
              </button>
              <button type="button" className="confirm-btn" onClick={onConfirm}>
                Сохранить
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="save-dialog-title">Колода сохранена</h2>
            <p className="save-dialog-hint">
              «{savedDeck?.name}» · {cardTotal} карт, {landTotal} земель
            </p>
            <div className="save-dialog-code-block">
              <span className="save-dialog-code-label">Код колоды</span>
              <div className="save-dialog-code-row">
                <code className="save-dialog-code" title={savedDeck?.code}>
                  {savedDeck?.code}
                </code>
                <button
                  type="button"
                  className="save-dialog-copy-btn"
                  onClick={onCopyCode}
                  title="Скопировать код"
                >
                  {codeCopied ? '✓' : '📋'}
                </button>
              </div>
            </div>
            <div className="save-dialog-actions">
              <button type="button" className="cancel-btn" onClick={onClose}>
                Продолжить
              </button>
              <button
                type="button"
                className="confirm-btn"
                onClick={() => {
                  onClose()
                  onGoToDecks()
                }}
              >
                К списку колод
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
