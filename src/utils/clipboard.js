/** Copy text to clipboard with optional prompt fallback. Returns true on success. */
export async function copyToClipboard(text, { fallbackPromptLabel = 'Скопируй:' } = {}) {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    window.prompt(fallbackPromptLabel, text)
    return false
  }
}
