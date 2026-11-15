import { useEffect, useRef } from 'react';

interface IosInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function IosInstallModal({ isOpen, onClose }: IosInstallModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Auto-focus primary close button on open
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="pwa-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-ios-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pwa-modal-dialog" ref={dialogRef}>
        <div className="pwa-modal-header">
          <div className="pwa-modal-header-icon" aria-hidden="true">
            <img src="/icons/icon.svg" alt="" width="36" height="36" />
          </div>
          <div>
            <h2 id="pwa-ios-title" className="pwa-modal-title">
              Установка на iOS
            </h2>
            <p className="pwa-modal-subtitle">Запускайте Card Wars прямо с домашнего экрана</p>
          </div>
          <button
            type="button"
            className="pwa-modal-close-btn"
            onClick={onClose}
            aria-label="Закрыть окно"
          >
            ✕
          </button>
        </div>

        <ol className="pwa-steps-list">
          <li className="pwa-step-item">
            <span className="pwa-step-num">1</span>
            <div className="pwa-step-text">
              Нажмите кнопку <strong>«Поделиться»</strong> в нижней панели браузера Safari:
              <div className="pwa-step-icon-badge" aria-hidden="true">
                {/* Safari Share Icon */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                <span>Кнопка «Поделиться»</span>
              </div>
            </div>
          </li>

          <li className="pwa-step-item">
            <span className="pwa-step-num">2</span>
            <div className="pwa-step-text">
              В появившемся меню прокрутите вниз и выберите <strong>«На экран «Домой»»</strong>:
              <div className="pwa-step-icon-badge" aria-hidden="true">
                {/* Add to Home Screen Icon */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="4" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <span>«На экран "Домой"»</span>
              </div>
            </div>
          </li>

          <li className="pwa-step-item">
            <span className="pwa-step-num">3</span>
            <div className="pwa-step-text">
              В правом верхнем углу нажмите <strong>«Добавить»</strong>. Иконка игры появится на главном экране устройства.
            </div>
          </li>
        </ol>

        <div className="pwa-modal-actions">
          <button
            ref={closeButtonRef}
            type="button"
            className="btn-primary btn-xl pwa-modal-ok-btn"
            onClick={onClose}
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}
