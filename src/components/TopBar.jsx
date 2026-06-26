import { useState } from 'react'

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
  onAdminClick,
}) {
  const [importCode, setImportCode] = useState('')

  return (
    <header className="topbar">
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
        className="code-input"
        placeholder="Код DK-XXXXXX"
        value={importCode}
        onChange={(e) => setImportCode(e.target.value.toUpperCase())}
      />

      <button onClick={() => importDeck(importCode)}>
        📥 Импортировать
      </button>

      <button onClick={clear}>
        🗑️ Очистить
      </button>

      <button onClick={() => navigator.clipboard?.writeText(deckCode)} title="Скопировать live-код">
        Код: {deckCode}
      </button>

      <button className="admin-btn" onClick={onAdminClick}>
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
