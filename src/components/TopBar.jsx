import { useEffect, useState, useMemo } from 'react'

// Функция для генерирования кода колоды на основе состояния
function generateDeckCode(selectedCards, selectedLands) {
  if (Object.keys(selectedCards).length === 0 && Object.keys(selectedLands).length === 0) {
    return ''
  }
  
  // Сортируем карты и земли по ID и количеству для консистентного кода
  const cardIds = Object.keys(selectedCards).sort()
  const landIds = Object.keys(selectedLands).sort()
  
  // Создаём хеш из данных
  const data = `${cardIds.map(id => `${id}:${selectedCards[id]}`).join(',')}|${landIds.map(id => `${id}:${selectedLands[id]}`).join(',')}`
  
  // Простой хеш для DK-XXXXXX
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  
  const code = Math.abs(hash).toString(36).toUpperCase().substring(0, 6).padEnd(6, '0')
  return `DK-${code}`
}

export function TopBar({
  name,
  setName,
  cardTotal,
  landTotal,
  errors,
  warnings,
  save,
  clear,
  importDeck,
  selectedCards,
  selectedLands,
  onAdminClick,
}) {
  const [importCode, setImportCode] = useState('')
  
  // Live обновление кода колоды
  const liveCode = useMemo(() => generateDeckCode(selectedCards, selectedLands), [selectedCards, selectedLands])

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
        onChange={(e) => setImportCode(e.target.value)}
      />
      
      <button onClick={() => importDeck(importCode)}>
        📥 Импортировать
      </button>
      
      <button onClick={clear}>
        🗑️ Очистить
      </button>
      
      {liveCode && (
        <button onClick={() => navigator.clipboard?.writeText(liveCode)} title="Скопировать код">
          Код: {liveCode}
        </button>
      )}
      
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
