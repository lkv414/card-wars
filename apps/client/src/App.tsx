import { useState } from 'react';
import { CONFIG } from '@card-wars/protocol';
import { GameShell } from './game/GameShell';
import { DecksScreen } from './decks/DecksScreen';
import { getSelectedDeckId, heroName, loadDecks } from './decks';
import { makeRoomCode } from './roomCode';
import { setQuality, useGame } from './store';
import './styles.css';

type Screen = 'menu' | 'decks';

export function App() {
  const [nickname, setNickname] = useState(() => localStorage.getItem('cw-nickname') ?? '');
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
    <div className="center-screen menu-screen">
      <div className="panel menu">
        <h1>Card Wars</h1>
        <p className="hint">Онлайн-партия по коду. Первый вошедший — хост.</p>
        <input
          placeholder="Ник"
          maxLength={20}
          value={nickname}
          onChange={(e) => onNickname(e.target.value)}
        />
        <button disabled={!nickname.trim()} onClick={() => onEnter(makeRoomCode(), true)}>
          Создать лобби
        </button>
        <div className="row">
          <input
            placeholder={`Код (${CONFIG.lobbyCodeDigits} цифры)`}
            inputMode="numeric"
            maxLength={CONFIG.lobbyCodeDigits}
            value={codeInput}
            onChange={(e) => onCodeInput(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && codeInput.length === CONFIG.lobbyCodeDigits && nickname.trim() && onEnter(codeInput)}
          />
          <button
            disabled={codeInput.length !== CONFIG.lobbyCodeDigits || !nickname.trim()}
            onClick={() => onEnter(codeInput)}
          >
            Войти
          </button>
        </div>
        <button className="secondary" onClick={onDecks}>
          Редактор колод
        </button>
        <div className="menu-settings">
          <span className="hint">
            Колода: {selectedDeck ? `${selectedDeck.name} · ${heroName(selectedDeck.heroId)}` : 'не выбрана'}
          </span>
          <span className="hint">
            Графика:{' '}
            <button className="mini" onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}>
              {quality === 'high' ? 'высокая' : 'низкая'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function NicknameScreen({ code, onDone }: { code: string; onDone: (nick: string) => void }) {
  const [nick, setNick] = useState('');
  return (
    <div className="center-screen">
      <div className="panel menu">
        <h2>Комната {code}</h2>
        <input
          autoFocus
          placeholder="Ник"
          maxLength={20}
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && nick.trim() && onDone(nick.trim())}
        />
        <button disabled={!nick.trim()} onClick={() => onDone(nick.trim())}>
          Войти
        </button>
      </div>
    </div>
  );
}
