import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = 'cw-pwa-dismissed';

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    document.referrer.includes('android-app://')
  );
}

function checkIsIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|opios/i.test(ua);
  return isIos && isSafari;
}

// Module-level state to capture beforeinstallprompt even before React tree mounts
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<(prompt: BeforeInstallPromptEvent | null) => void>();
const installListeners = new Set<(installed: boolean) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    for (const listener of promptListeners) {
      listener(globalDeferredPrompt);
    }
  });

  window.addEventListener('appinstalled', () => {
    globalDeferredPrompt = null;
    for (const listener of promptListeners) {
      listener(null);
    }
    for (const listener of installListeners) {
      listener(true);
    }
  });
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => globalDeferredPrompt);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkIsStandalone());
  const [isIosModalOpen, setIsIosModalOpen] = useState(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const isIos = checkIsIosSafari();

  useEffect(() => {
    const handlePromptChange = (prompt: BeforeInstallPromptEvent | null) => {
      setDeferredPrompt(prompt);
    };
    const handleInstallChange = (installed: boolean) => {
      setIsInstalled(installed);
    };

    promptListeners.add(handlePromptChange);
    installListeners.add(handleInstallChange);

    // Recheck standalone on mount
    setIsInstalled(checkIsStandalone());

    return () => {
      promptListeners.delete(handlePromptChange);
      installListeners.delete(handleInstallChange);
    };
  }, []);

  const canInstall = !isInstalled && (deferredPrompt !== null || isIos);

  const promptInstall = useCallback(async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          setIsInstalled(true);
        }
      } catch (err) {
        console.warn('[PWA] Error prompting installation:', err);
      } finally {
        globalDeferredPrompt = null;
        setDeferredPrompt(null);
      }
    } else if (isIos && !isInstalled) {
      setIsIosModalOpen(true);
    }
  }, [deferredPrompt, isIos, isInstalled]);

  const dismissBanner = useCallback(() => {
    setIsDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const openIosModal = useCallback(() => {
    setIsIosModalOpen(true);
  }, []);

  const closeIosModal = useCallback(() => {
    setIsIosModalOpen(false);
  }, []);

  return {
    canInstall,
    isInstalled,
    isIos,
    isDismissed,
    showBanner: canInstall && !isDismissed,
    isIosModalOpen,
    promptInstall,
    dismissBanner,
    openIosModal,
    closeIosModal,
  };
}
