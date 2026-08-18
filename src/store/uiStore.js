/**
 * uiStore.js — UI-state для game board (testing_3d pattern: один owner).
 *
 * Сюда выносятся:
 * - выбранная карта в руке (selectedCardIndex)
 * - выбранная зона на поле (selectedZoneIndex)
 * - текущая drag-операция (draggingCardIndex)
 * - визуальные эффекты боя (damageFlash, battleEvents, damageMarkers, damageFlashCards)
 * - состояние модалки действий над картой на земле (zoneCardActionMenu)
 *
 * Это ЛОКАЛЬНЫЙ UI state, не синхронизируется через WS.
 */
import { create } from 'zustand'

export const useUiStore = create((set) => ({
  // === Selection ===
  selectedCardIndex: null,
  selectedZoneIndex: null,
  draggingCardIndex: null,

  // === Visual effects (battle/damage) ===
  damageFlash: false,
  battleEvents: [],
  damageMarkers: [],
  damageFlashCards: {},

  // === Modals ===
  zoneCardActionMenu: null,

  // === Selection actions ===
  selectCard: (index) => set({ selectedCardIndex: index }),
  selectZone: (index) => set({ selectedZoneIndex: index }),
  setDragging: (index) => set({ draggingCardIndex: index }),

  clearSelection: () =>
    set({ selectedCardIndex: null, selectedZoneIndex: null, draggingCardIndex: null }),

  // === Damage effects ===
  triggerDamageFlash: () => set({ damageFlash: true }),
  clearDamageFlash: () => set({ damageFlash: false }),

  addBattleEvents: (events) =>
    set((s) => ({ battleEvents: [...s.battleEvents, ...events] })),
  clearBattleEvents: () => set({ battleEvents: [] }),

  addDamageMarkers: (markers) =>
    set((s) => ({ damageMarkers: [...s.damageMarkers, ...markers] })),
  removeDamageMarkers: (keys) =>
    set((s) => ({ damageMarkers: s.damageMarkers.filter((m) => !keys.includes(m.key)) })),

  flashCards: (cards) => set({ damageFlashCards: cards }),
  clearCardFlash: (key) =>
    set((s) => {
      const next = { ...s.damageFlashCards }
      delete next[key]
      return { damageFlashCards: next }
    }),

  // === Modal ===
  openZoneCardActionMenu: (payload) => set({ zoneCardActionMenu: payload }),
  closeZoneCardActionMenu: () => set({ zoneCardActionMenu: null }),

  // === Reset ===
  reset: () =>
    set({
      selectedCardIndex: null,
      selectedZoneIndex: null,
      draggingCardIndex: null,
      damageFlash: false,
      battleEvents: [],
      damageMarkers: [],
      damageFlashCards: {},
      zoneCardActionMenu: null,
    }),
}))
