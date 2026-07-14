import { useState } from 'react'
import { navigate, ROUTES } from '../router'

export function TopBar({
  name,
  setName,
  deckCode,
  cardTotal,
  landTotal,
  errors,
  warnings,
  save,
  clear,
  importDeck,
}) {
  const [codeDraft, setCodeDraft] = useState('')
  const [isEditingCode, setIsEditingCode] = useState(false)
  const codeInputValue = isEditingCode ? codeDraft : deckCode

  const handleCodeKeyDown = (event) => {
    if (event.key !== 'Enter') return

    event.preventDefault()
    const normalizedCode = codeInputValue.trim()
    setCodeDraft(normalizedCode)
    setIsEditingCode(false)

    if (normalizedCode) {
      importDeck(normalizedCode)
    }
  }

  return (
    <header className="topbar">
      <button className="back-btn" onClick={() => navigate(ROUTES.menu)}>
        ← Назад
      </button>

      <input
        aria-label="Название колоды"
        placeholder="Название колоды"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <span className={`counter ${cardTotal === 40 ? 'full' : errors.length ? 'invalid' : 'ok'}`}>
        Карт: {cardTotal} / 40
      </span>

      <span className={landTotal === 4 ? 'counter ok' : 'counter invalid'}>
        Земель: {landTotal} / 4
      </span>

      <button onClick={save} disabled={errors.some((e) => e.includes('больше')) || landTotal !== 4}>
        💾 Сохранить колоду
      </button>

      <input
        aria-label="Live-код колоды или код для загрузки"
        className="code-input"
        placeholder="Код DK-XXXXXX"
        title="Live-код текущей колоды. Вставьте другой код и нажмите Enter, чтобы загрузить колоду."
        value={codeInputValue}
        onFocus={(event) => {
          const input = event.currentTarget
          setCodeDraft(deckCode)
          setIsEditingCode(true)
          requestAnimationFrame(() => input.select())
        }}
        onBlur={() => setIsEditingCode(false)}
        onChange={(e) => setCodeDraft(e.target.value)}
        onKeyDown={handleCodeKeyDown}
      />

      <button onClick={clear}>
        🗑️ Очистить
      </button>

      <button className="admin-btn" onClick={() => navigate(ROUTES.admin)}>
        🔧 Админ-панель
      </button>

      <div className="validation">
        {warnings.map((w) => (
          <span className="warn" key={w}>
            ⚠️ {w}
          </span>
        ))}
        {errors.map((e) => (
          <span className="err" key={e}>
            ❌ {e}
          </span>
        ))}
      </div>
    </header>
  )
}
