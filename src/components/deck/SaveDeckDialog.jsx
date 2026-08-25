/**
 * SaveDeckDialog — двухшаговый диалог сохранения колоды.
 */

import { useEffect, useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

export function SaveDeckDialog({
  open,
  step,
  saveName,
  setSaveName,
  cardTotal,
  landTotal,
  savedDeck,
  codeCopied,
  editingDeckName = null,
  updateExisting = false,
  onUpdateExistingChange,
  onClose,
  onConfirm,
  onCopyCode,
  onGoToDecks,
}) {
  const dialogRef = useRef(null)
  useFocusTrap(open, dialogRef)

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') onConfirm()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className="save-dialog-overlay"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="save-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {step === 'form' ? (
          <>
            <h2 id="save-dialog-title">Сохранить колоду</h2>
            <p className="save-dialog-hint">
              Будет сохранено: {cardTotal} карт, {landTotal} земель
            </p>
            <label htmlFor="save-deck-name">
              Название:
              <input
                id="save-deck-name"
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Например: Основная колода"
                autoFocus
                onKeyDown={handleKeyDown}
              />
            </label>
            {editingDeckName && (
              <label className="save-dialog-update-toggle" htmlFor="save-deck-update">
                <input
                  id="save-deck-update"
                  type="checkbox"
                  checked={updateExisting}
                  onChange={(e) => onUpdateExistingChange?.(e.target.checked)}
                />
                Обновить колоду «{editingDeckName}» вместо создания новой
              </label>
            )}
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
            <h2 id="save-dialog-title">{savedDeck?.updated ? 'Колода обновлена' : 'Колода сохранена'}</h2>
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
                  aria-label={codeCopied ? 'Код скопирован' : 'Скопировать код колоды'}
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
