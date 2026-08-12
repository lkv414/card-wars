/** Client fallbacks (direct table writes) — only in dev or when explicitly enabled. */
export const ALLOW_CLIENT_FALLBACK =
  import.meta.env.VITE_ALLOW_CLIENT_FALLBACK === 'true' ||
  (import.meta.env.DEV && import.meta.env.VITE_ALLOW_CLIENT_FALLBACK !== 'false')
