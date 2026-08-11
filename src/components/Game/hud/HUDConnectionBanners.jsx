export function HUDConnectionBanners({ realtimeStatus, actionError, isApplying }) {
  return (
    <>
      {(realtimeStatus === 'disconnected' || realtimeStatus === 'reconnecting') && (
        <div className="connection-banner" role="alert" aria-live="polite">
          <span className="connection-spinner" />
          {realtimeStatus === 'disconnected'
            ? '⚠️ Связь потеряна — переподключаемся...'
            : '🔄 Переподключение к серверу...'}
        </div>
      )}
      {actionError && (
        <div className="action-error-banner" role="alert">
          ❌ {actionError}
        </div>
      )}
      {isApplying && (
        <div className="action-pending-banner" role="status">
          ⏳ Отправляем действие...
        </div>
      )}
    </>
  )
}
