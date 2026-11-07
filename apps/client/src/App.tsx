import { useState } from 'react';
import { CONFIG } from '@card-wars/protocol';
import { GameShell } from './game/GameShell';
import { DecksScreen } from './decks/DecksScreen';
import { MockScene } from './game/debug/MockScene';
import { getSelectedDeckId, heroName, loadDecks } from './decks';
import { makeRoomCode } from './roomCode';
import { setQuality, useGame } from './store';
import './styles.css';

type Screen = 'menu' | 'decks';

export function App() {
  const [nickname, setNickname] = useState(() => localStorage.getItem('cw-nickname') ?? '');
  // ?scene=1 — dev-превью 3D-сцены с мок-снапшотом, без сервера.
  if (new URLSearchParams(location.search).has('scene')) {
    return <MockScene />;
  }
  const [codeInput, setCodeInput] = useState('');
  const [screen, setScreen] = useState<Screen>(() => (location.pathname === '/decks' ? 'decks' : 'menu'));
  const [activeCode, setActiveCode] = useState<string | null>(() => {
    const match = /^\/play\/(\d+)$/.exec(location.pathname);
    return match?.[1] ?? null;
  });

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
      <DecksScreen
        onBack={() => {
          history.pushState(null, '', '/');
          setScreen('menu');
        }}
      />
    );
  }

  const enter = (code: string, create = false) => {
    if (nickname.trim()) localStorage.setItem('cw-nickname', nickname.trim());
    history.pushState(null, '', `/play/${code}${create ? '?create=1' : ''}`);
    setActiveCode(code);
  };

  return (
    <MainMenu
      nickname={nickname}
      onNickname={setNickname}
      codeInput={codeInput}
      onCodeInput={setCodeInput}
      onEnter={enter}
      onDecks={() => setScreen('decks')}
    />
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
  const decks = loadDecks();
  const selectedDeck = decks.find((d) => d.id === getSelectedDeckId()) ?? decks[0];

  return (
    <main className="main-menu ui-v2">
      <div className="main-menu-content">
        <h1>Card Wars</h1>
        <p className="main-menu-subtitle">Собирайте колоду и сражайтесь онлайн</p>

        <div className="main-menu-form">
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
            className="btn-primary btn-xl"
            disabled={!nickname.trim()}
            onClick={() => onEnter(makeRoomCode(), true)}
          >
            Создать лобби
          </button>

          <div className="join-block">
            <span className="field-label">Войти по коду</span>
            <div className="join-row">
              <input
                className="code-input"
                placeholder={'•'.repeat(CONFIG.lobbyCodeDigits)}
                inputMode="numeric"
                maxLength={CONFIG.lobbyCodeDigits}
                value={codeInput}
                onChange={(e) => onCodeInput(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) =>
                  e.key === 'Enter' &&
                  codeInput.length === CONFIG.lobbyCodeDigits &&
                  nickname.trim() &&
                  onEnter(codeInput)
                }
              />
              <button
                className="btn-accent"
                disabled={codeInput.length !== CONFIG.lobbyCodeDigits || !nickname.trim()}
                onClick={() => onEnter(codeInput)}
              >
                Войти
              </button>
            </div>
          </div>

          <button className="btn-accent btn-xl" onClick={onDecks}>
            Мои колоды
          </button>
        </div>

        <div className="main-menu-foot">
          <span>
            Активная колода: <b>{selectedDeck ? selectedDeck.name : 'не выбрана'}</b>
            {selectedDeck ? ` · ${heroName(selectedDeck.heroId)}` : ''}
          </span>
          <span>
            Графика:{' '}
            <button className="link-btn" onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}>
              {quality === 'high' ? 'высокая' : 'низкая'}
            </button>
          </span>
        </div>
      </div>
    </main>
  );
}

function NicknameScreen({ code, onDone }: { code: string; onDone: (nick: string) => void }) {
  const [nick, setNick] = useState('');
  return (
    <main className="main-menu ui-v2">
      <div className="main-menu-content">
        <span className="eyebrow">Card Wars</span>
        <h1>Комната {code}</h1>
        <p className="main-menu-subtitle">Представьтесь, чтобы войти в лобби</p>
        <div className="main-menu-form">
          <label className="field">
            <span className="field-label">Ваш ник</span>
            <input
              autoFocus
              placeholder="Введите ник"
              maxLength={20}
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && nick.trim() && onDone(nick.trim())}
            />
          </label>
          <button className="btn-primary btn-xl" disabled={!nick.trim()} onClick={() => onDone(nick.trim())}>
            Войти
          </button>
        </div>
      </div>
    </main>
  );
}
