import { usePwaInstall } from './usePwaInstall';
import { IosInstallModal } from './IosInstallModal';

export function PwaInstallPrompt() {
  const {
    canInstall,
    isInstalled,
    showBanner,
    isIosModalOpen,
    promptInstall,
    dismissBanner,
    closeIosModal,
  } = usePwaInstall();

  if (isInstalled) {
    return null;
  }

  return (
    <>
      {showBanner && canInstall && (
        <aside className="pwa-install-banner" aria-label="Предложение установить приложение">
          <div className="pwa-banner-content">
            <img
              src="/icons/icon.svg"
              alt="Card Wars Icon"
              className="pwa-banner-icon"
              width="44"
              height="44"
            />
            <div className="pwa-banner-text">
              <span className="pwa-banner-title">Card Wars (Adventure Time)</span>
              <span className="pwa-banner-desc">
                Полноэкранный режим и быстрый запуск с домашнего экрана
              </span>
            </div>
          </div>
          <div className="pwa-banner-actions">
            <button
              type="button"
              className="btn-primary pwa-btn-install"
              onClick={promptInstall}
            >
              Установить
            </button>
            <button
              type="button"
              className="pwa-btn-dismiss"
              onClick={dismissBanner}
              aria-label="Скрыть напоминание"
            >
              ✕
            </button>
          </div>
        </aside>
      )}

      <IosInstallModal isOpen={isIosModalOpen} onClose={closeIosModal} />
    </>
  );
}

export function PwaInstallButton({ className }: { className?: string }) {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall();

  if (!canInstall || isInstalled) {
    return null;
  }

  return (
    <button
      type="button"
      className={className ?? 'link-btn'}
      onClick={promptInstall}
      aria-label="Установить приложение Card Wars"
    >
      📱 Установить игру
    </button>
  );
}
