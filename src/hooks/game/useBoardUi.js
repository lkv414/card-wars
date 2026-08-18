/**
 * useBoardUi — UI-state и обработчики для game board (testing_3d pattern).
 *
 * Заменяет локальный useState в GameBoard3D на useUiStore + набор
 * стабильных коллбэков. Возвращает всё необходимое для рендера сцены.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useUiStore } from '../../store/uiStore'
import { battleEventsToVisuals } from '../../hooks/game/battlePhase'

export function useBoardUi({ playerId }) {
  const ui = useUiStore()

  // === Refs ===
  const cardIndexRef = useRef(null)
  const placingLockRef = useRef(false)

  useEffect(() => {
    cardIndexRef.current = ui.draggingCardIndex ?? ui.selectedCardIndex
  }, [ui.draggingCardIndex, ui.selectedCardIndex])

  // === Visual damage effect (battle events) ===
  const triggerDamageVisual = useCallback(({ markers, flashedCards = {} }) => {
    if (Array.isArray(markers) && markers.length > 0) {
      ui.addDamageMarkers(markers)
      // чистка через 1.5с
      const keys = markers.map((m) => m.key)
      setTimeout(() => ui.removeDamageMarkers(keys), 1500)
    }
    if (Object.keys(flashedCards).length > 0) {
      ui.flashCards(flashedCards)
      // снимаем флэш через 0.6с
      setTimeout(() => {
        const s = useUiStore.getState()
        const next = { ...s.damageFlashCards }
        for (const k of Object.keys(flashedCards)) delete next[k]
        useUiStore.setState({ damageFlashCards: next })
      }, 650)
    }
  }, [ui])

  // === End turn: подавляет realtime reload, чистит selection, рендерит damage ===
  const handleEndTurn = useCallback(
    async ({ onEndTurn, onSuppressRealtimeReload, toast }) => {
      onSuppressRealtimeReload?.(8000)
      const result = await onEndTurn?.()
      if (result?.error) {
        toast('error', result.error)
        return result
      }
      ui.clearSelection()

      const events = result?.battleEvents
      if (Array.isArray(events) && events.length > 0) {
        ui.addBattleEvents(events)
        const { markers, flashMe } = battleEventsToVisuals(events, playerId)
        triggerDamageVisual({ markers })
        if (flashMe) {
          ui.triggerDamageFlash()
          setTimeout(() => ui.clearDamageFlash(), 550)
        }
      }
      return result
    },
    [ui, playerId, triggerDamageVisual],
  )

  // === Play card via raycast release ===
  const handleRayRelease = useCallback(
    async ({ cardIdx, target, handCards, onPlayCard, onSuppressRealtimeReload, toast }) => {
      if (placingLockRef.current) return
      const card = handCards[cardIdx]
      if (!card || !target) return

      placingLockRef.current = true
      ui.setDragging(null)
      onSuppressRealtimeReload?.(5000)
      try {
        const result = await onPlayCard?.(cardIdx, target.zoneIndex, 1, target.slotType)
        if (result?.error) {
          toast('error', result.error)
          return
        }
        ui.selectCard(null)
      } catch (err) {
        toast('error', err?.message || 'Не удалось сыграть карту')
      } finally {
        placingLockRef.current = false
      }
    },
    [ui],
  )

  return useMemo(
    () => ({
      ...ui,
      cardIndexRef,
      placingLockRef,
      triggerDamageVisual,
      handleEndTurn,
      handleRayRelease,
    }),
    [ui, triggerDamageVisual, handleEndTurn, handleRayRelease],
  )
}
