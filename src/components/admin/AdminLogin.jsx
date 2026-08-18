import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../../context/useAdminAuth'

export function AdminLogin() {
  const navigate = useNavigate()
  const { signIn } = useAdminAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    const result = await signIn(email.trim(), password)
    setSubmitting(false)
    if (!result.success) {
      setError(result.error || 'Не удалось войти')
      return
    }
    navigate('/admin', { replace: true })
  }

  return (
    <main className="admin-login">
      <form className="admin-login-form" onSubmit={submit}>
        <h1>Админ-панель</h1>
        <p className="admin-login-sub">Вход для редактирования каталога карт</p>
        <label htmlFor="admin-email">
          Email
          <input
            id="admin-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label htmlFor="admin-password">
          Пароль
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="admin-login-error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-login-actions">
          <button type="button" className="deck-link-btn" onClick={() => navigate('/')}>
            ← Меню
          </button>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'Вход…' : 'Войти'}
          </button>
        </div>
      </form>
    </main>
  )
}
