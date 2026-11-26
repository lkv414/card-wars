import { Suspense, lazy, useEffect, useState } from 'react';
import { CONFIG } from '@card-wars/protocol';
import { GameShell } from './game/GameShell';
import { PRIMARY_LAND_IMAGES } from './decks/landImages';
import { makeRoomCode } from './roomCode';
import { setQuality, useGame } from './store';
import { PwaInstallButton, PwaInstallPrompt } from './pwa';
import { soundEngine } from './sound/SoundEngine';
import './styles.css';

import { APP_VERSION } from './version';

const DecksScreen = lazy(() => import('./decks/DecksScreen').then((m) => ({ default: m.DecksScreen })));
const MockScene = lazy(() => import('./game/debug/MockScene').then((m) => ({ default: m.MockScene })));

export const preloadDecksScreen = () => {
  import('./decks/DecksScreen').catch(() => {});
};

type Screen = 'menu' | 'decks';

function routeFromLocation(): { screen: Screen; code: string | null } {
  const match = /^\/play\/(\d+)$/.exec(location.pathname);
  if (match?.[1]) return { screen: 'menu', code: match[1] };
  if (location.pathname === '/decks') return { screen: 'decks', code: null };
  return { screen: 'menu', code: null };
}

export function App() {
  const [nickname, setNickname] = useState(() => localStorage.getItem('cw-nickname') ?? '');
  const [codeInput, setCodeInput] = useState('');
  const [screen, setScreen] = useState<Screen>(() => routeFromLocation().screen);
  const [activeCode, setActiveCode] = useState<string | null>(() => routeFromLocation().code);

  useEffect(() => {
    // Eagerly prefetch DecksScreen chunk so clicking "Колоды" transitions instantly with zero black flash
    const timer = setTimeout(() => {
      preloadDecksScreen();
      // Pre-warm primary land and card back textures into browser cache
      for (const url of PRIMARY_LAND_IMAGES) {
        const img = new Image();
        img.src = url;
      }
    }, 60);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const next = routeFromLocation();
      setScreen(next.screen);
      setActiveCode(next.code);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // ?scene=1 — dev preview of the 3D scene with a mock snapshot, without a server.
  if (new URLSearchParams(location.search).has('scene')) {
    return (
      <Suspense fallback={null}>
        <MockScene />
      </Suspense>
    );
  }

  if (activeCode) {
    return nickname.trim() ? (
      <GameShell key={activeCode} code={activeCode} nickname={nickname.trim()} />
    ) : (
      <NicknameScreen
        code={activeCode}
        onDone={(nick) => {
          localStorage.setItem('cw-nickname', nick);
          setNickname(nick);
        }}
      />
    );
  }

  if (screen === 'decks') {
    return (
      <Suspense
        fallback={
          <main className="decks-page ui-v2" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <header className="decks-header">
              <div className="decks-title">
                <span className="eyebrow">Колоды</span>
                <h1>Колоды</h1>
              </div>
            </header>
            <p className="decks-subtitle" style={{ opacity: 0.6 }}>Загрузка…</p>
          </main>
        }
      >
        <DecksScreen
          onBack={() => {
            history.pushState(null, '', '/');
            setScreen('menu');
          }}
        />
      </Suspense>
    );
  }

  const enter = (code: string, create = false) => {
    if (nickname.trim()) localStorage.setItem('cw-nickname', nickname.trim());
    history.pushState(null, '', `/play/${code}${create ? '?create=1' : ''}`);
    setActiveCode(code);
  };

  return (
    <>
      <MainMenu
        nickname={nickname}
        onNickname={setNickname}
        codeInput={codeInput}
        onCodeInput={setCodeInput}
        onEnter={enter}
        onDecks={() => {
          history.pushState(null, '', '/decks');
          setScreen('decks');
        }}
      />
      <PwaInstallPrompt />
    </>
  );
}

function MainMenu({
  nickname,
  onNickname,
  codeInput,
  onCodeInput,
  onEnter,
  onDecks,
}: {
  nickname: string;
  onNickname: (value: string) => void;
  codeInput: string;
  onCodeInput: (value: string) => void;
  onEnter: (code: string, create?: boolean) => void;
  onDecks: () => void;
}) {
  const quality = useGame((s) => s.ui.quality);
  const [muted, setMuted] = useState(() => soundEngine.getSettings().muted);
  const [music, setMusic] = useState(() => soundEngine.isMusicEnabled());

  return (
    <main className="main-menu ui-v2 treehouse-menu">
      <div className="main-menu-content">
        <div className="main-menu-panel cw-felt-box">
          <div className="menu-header-sign">
            <span className="eyebrow menu-eyebrow">Земли Ууу · Карточные Войны</span>
            <h1 className="menu-title-logo">CARD WARS</h1>
            <p className="main-menu-subtitle">«Я флопаю свинку!» — сразитесь за звание крутого парня</p>
          </div>

          <div className="main-menu-form cw-paper-box">
            <label className="field">
              <span className="field-label">Ваш ник</span>
              <input
                placeholder="Введите ник"
                maxLength={20}
                value={nickname}
                onChange={(e) => onNickname(e.target.value)}
              />
            </label>

            <button
              type="button"
              className="cw-btn-3d btn-green btn-lg btn-block"
              disabled={!nickname.trim()}
              onClick={() => {
                soundEngine.playGong();
                onEnter(makeRoomCode(), true);
              }}
            >
              ⚔️ Создать битву
            </button>

            <div className="join-block">
              <span className="field-label">Войти по коду комнаты</span>
              <div className="join-row">
                <input
                  className="code-input"
                  placeholder={'•'.repeat(CONFIG.lobbyCodeDigits)}
                  inputMode="numeric"
                  maxLength={CONFIG.lobbyCodeDigits}
                  value={codeInput}
                  onChange={(e) => onCodeInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      codeInput.length === CONFIG.lobbyCodeDigits &&
                      nickname.trim()
                    ) {
                      soundEngine.playButtonClick();
                      onEnter(codeInput);
                    }
                  }}
                />
                <button
                  type="button"
                  className="cw-btn-3d btn-orange"
                  disabled={codeInput.length !== CONFIG.lobbyCodeDigits || !nickname.trim()}
                  onClick={() => {
                    soundEngine.playButtonClick();
                    onEnter(codeInput);
                  }}
                >
                  Войти
                </button>
              </div>
            </div>

            <button
              type="button"
              className="cw-btn-3d btn-blue btn-lg btn-block"
              onClick={() => {
                soundEngine.playCardDraw();
                onDecks();
              }}
              onMouseEnter={preloadDecksScreen}
              onTouchStart={preloadDecksScreen}
            >
              📖 Гримуар колод (Каталог)
            </button>
          </div>

          <div className="main-menu-foot">
            <div className="main-menu-foot-row">
              <span>
                Звук:{' '}
                <button
                  type="button"
                  className="cw-btn-3d btn-paper btn-sm"
                  onClick={() => {
                    const next = !muted;
                    soundEngine.setMuted(next);
                    setMuted(next);
                    if (!next) soundEngine.playButtonClick();
                  }}
                >
                  {muted ? 'выкл 🔇' : 'вкл 🔊'}
                </button>
              </span>
              <span>
                Музыка:{' '}
                <button
                  type="button"
                  className="cw-btn-3d btn-paper btn-sm"
                  onClick={() => {
                    const next = soundEngine.toggleMusic();
                    setMusic(next);
                    if (next) soundEngine.playButtonClick();
                  }}
                >
                  {music ? 'вкл 🎵' : 'выкл 🔇'}
                </button>
              </span>
              <span>
                Графика:{' '}
                <button
                  type="button"
                  className="cw-btn-3d btn-paper btn-sm"
                  onClick={() => {
                    soundEngine.playButtonClick();
                    setQuality(quality === 'high' ? 'low' : 'high');
                  }}
                >
                  {quality === 'high' ? 'высокая' : 'низкая'}
                </button>
              </span>
            </div>
            <PwaInstallButton />
            <span className="main-menu-version">Версия {APP_VERSION}</span>
          </div>
        </div>
      </div>
    </main>
  );
}

function NicknameScreen({ code, onDone }: { code: string; onDone: (nick: string) => void }) {
  const [nick, setNick] = useState('');
  return (
    <main className="main-menu ui-v2 treehouse-menu">
      <div className="main-menu-content">
        <div className="main-menu-panel cw-felt-box">
          <div className="menu-header-sign">
            <span className="eyebrow menu-eyebrow">Комната {code}</span>
            <h1 className="menu-title-logo">Card Wars</h1>
            <p className="main-menu-subtitle">Представьтесь, чтобы занять место за столом</p>
          </div>
          <div className="main-menu-form cw-paper-box">
            <label className="field">
              <span className="field-label">Ваш ник</span>
              <input
                autoFocus
                placeholder="Введите ник"
                maxLength={20}
                value={nick}
                onChange={(e) => setNick(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nick.trim()) {
                    soundEngine.playGong();
                    onDone(nick.trim());
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="cw-btn-3d btn-green btn-lg btn-block"
              disabled={!nick.trim()}
              onClick={() => {
                soundEngine.playGong();
                onDone(nick.trim());
              }}
            >
              ⚔️ Занять место
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
