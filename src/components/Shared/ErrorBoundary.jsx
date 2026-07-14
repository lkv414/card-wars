import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h1>Что-то пошло не так</h1>
          <p>Приложение столкнулось с ошибкой. Попробуйте перезагрузить страницу.</p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="error-boundary-details">{this.state.error.toString()}</pre>
          )}
          <button type="button" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
