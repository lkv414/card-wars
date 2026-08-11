import { useState, useCallback } from 'react'
import { copyToClipboard } from '../utils/clipboard'

export function useDeckSave({
  cardTotal,
  landTotal,
  errors,
  selectedCards,
  selectedLands,
  getSelectedDeck,
  addDeck,
  toast,
}) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveStep, setSaveStep] = useState('form')
  const [saveName, setSaveName] = useState('')
  const [savedDeck, setSavedDeck] = useState(null)
  const [codeCopied, setCodeCopied] = useState(false)

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
    setSaveName(getSelectedDeck()?.name || '')
    setSaveStep('form')
    setSavedDeck(null)
    setCodeCopied(false)
    setSaveDialogOpen(true)
  }, [cardTotal, landTotal, errors, getSelectedDeck, toast])

  const handleConfirmSave = useCallback(() => {
    const name = saveName.trim() || `Колода ${new Date().toLocaleDateString('ru-RU')}`
    const newDeck = addDeck({ name, selectedCards, selectedLands })
    setSavedDeck({ name: newDeck.name, code: newDeck.code })
    setSaveStep('success')
  }, [saveName, addDeck, selectedCards, selectedLands])

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
    closeSaveDialog,
    handleSaveDeck,
    handleConfirmSave,
    handleCopySavedCode,
  }
}
