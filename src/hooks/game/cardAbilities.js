/**
 * Чистые хелперы для карт — без зависимостей от Supabase/React.
 *
 * Вынесено из useFlipCard.js, чтобы их можно было импортировать в unit-тестах
 * (Node test runner падает на `import './supabase.js'` из-за @supabase/supabase-js
 * → `import.meta.env.VITE_SUPABASE_URL`).
 */

/**
 * Есть ли у карты способность «Флюп».
 *
 * Раньше код проверял `card.abilities?.includes('Флюп')`, но в данных из БД
 * нет поля `abilities`. Флип определяется одним из:
 *   - has_flip: true (булевый флаг)
 *   - flip_description: непустая строка
 *   - в mechanics есть элемент с type === 'flip_ability'
 *
 * @param {object|null|undefined} card
 * @returns {boolean}
 */
export function hasFlipAbility(card) {
  if (!card) return false
  if (card.has_flip === true) return true
  if (typeof card.flip_description === 'string' && card.flip_description.trim() !== '') {
    return true
  }
  if (Array.isArray(card.mechanics)) {
    return card.mechanics.some((m) => m && m.type === 'flip_ability')
  }
  return false
}