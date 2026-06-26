import { useState } from 'react'

export function ImageThumb({ src, size = 'medium', alt }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <div className={`thumb thumb-${size}`}>🃏</div>
  return <img className={`thumb thumb-${size}`} src={src} alt={alt} onError={() => setFailed(true)} />
}
