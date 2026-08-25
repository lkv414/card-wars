import { useState, useCallback } from 'react'
import { copyToClipboard } from '../utils/clipboard'
import { generateDeckCode } from '../utils/deckCode.js'

/**
 * useDeckSave — логика диалога сохранения колоды.
 *
 * Пункт 4.5: если редактируется уже существующая колода (editingDeck),
 * сохранение по умолчанию заменяет исходную колоду вместо создания дубля.
 * В диалоге можно снять галочку «Обновить...» и сохранить как новую.
 */
export function useDeckSave({
  cardTotal,
  landTotal,
  errors,
  selectedCards,
  selectedLands,
  heroId = null,
  editingDeck = null,
  addDeck,
  updateDeckContents,
  clearEditingDeck,
  toast,
}) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveStep, setSaveStep] = useState('form')
  const [saveName, setSaveName] = useState('')
  const [savedDeck, setSavedDeck] = useState(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [updateExisting, setUpdateExisting] = useState(true)

  const closeSaveDialog = useCallback(() => {
    setSaveDialogOpen(false)
    setSaveStep('form')
    setSaveName('')
    setSavedDeck(null)
    setCodeCopied(false)
  }, [])

  const handleSaveDeck = useCallback(() => {
    if (cardTotal === 0 && landTotal === 0) {
      toast?.('error', 'Колода пустая — добавьте хотя бы одну карту')
      return
    }
    if (errors.length > 0) {
      toast?.('error', 'Исправьте ошибки в колоде перед сохранением')
      return
    }
    setSaveName(editingDeck?.name || '')
    setUpdateExisting(Boolean(editingDeck))
    setSaveStep('form')
    setSavedDeck(null)
    setCodeCopied(false)
    setSaveDialogOpen(true)
  }, [cardTotal, landTotal, errors, editingDeck, toast])

  const handleConfirmSave = useCallback(() => {
    const name = saveName.trim() || `Колода ${new Date().toLocaleDateString('ru-RU')}`
    if (updateExisting && editingDeck) {
      updateDeckContents(editingDeck.id, {
        name,
        selectedCards,
        selectedLands,
        heroId,
      })
      clearEditingDeck?.()
      setSavedDeck({ name, code: generateDeckCode(selectedCards, selectedLands), updated: true })
    } else {
      const newDeck = addDeck({ name, selectedCards, selectedLands, heroId })
      setSavedDeck({ name: newDeck.name, code: newDeck.code, updated: false })
    }
    setSaveStep('success')
  }, [
    saveName,
    updateExisting,
    editingDeck,
    addDeck,
    updateDeckContents,
    clearEditingDeck,
    selectedCards,
    selectedLands,
    heroId,
  ])

  const handleCopySavedCode = useCallback(async () => {
    if (!savedDeck?.code) return
    const ok = await copyToClipboard(savedDeck.code, { fallbackPromptLabel: 'Скопируй код колоды:' })
    if (ok) {
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 1500)
    }
  }, [savedDeck?.code])

  return {
    saveDialogOpen,
    saveStep,
    saveName,
    setSaveName,
    savedDeck,
    codeCopied,
    updateExisting,
    setUpdateExisting,
    closeSaveDialog,
    handleSaveDeck,
    handleConfirmSave,
    handleCopySavedCode,
  }
}
