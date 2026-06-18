import { useEffect, useState } from 'react'
import { supabase } from './supabase'

function App() {
  const [status, setStatus] = useState('Проверка подключения...')

  useEffect(() => {
    async function testSupabase() {
      try {
        const { error } = await supabase.from('rooms').select('*').limit(1)

        if (error && error.code === '42P01') {
          setStatus('✅ Supabase успешно подключён! Таблиц пока нет — это нормально.')
        } else if (error) {
          setStatus('⚠️ Подключено, но ошибка: ' + error.message)
        } else {
          setStatus('✅ Supabase работает отлично!')
        }
      } catch (err) {
        setStatus('❌ Ошибка подключения: ' + err.message)
      }
    }

    testSupabase()
  }, [])

  return (
      <div style={{ padding: '40px', fontFamily: 'Arial', textAlign: 'center' }}>
        <h1>🃏 Card Game</h1>
        <p>{status}</p>
      </div>
  )
}

export default App