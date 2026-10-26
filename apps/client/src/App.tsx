import { useState } from 'react';
import { GameShell } from './game/GameShell';
import './styles.css';

export function App() {
  const [nickname, setNickname] = useState(() => localStorage.getItem('cw-nickname') ?? '');
  const [codeInput, setCodeInput] = useState('');
  const [activeCode, setActiveCode] = useState<string | null>(() => {
    const match = /^\/play\/(\d{4})$/.exec(location.pathname);
    return match?.[1] ?? null;
  });

  if (activeCode) {
    return nickname.trim() ? (
      <GameShell key={activeCode} code={activeCode} nickname={nickname.trim()} />
    ) : (
      <NicknameScreen code={activeCode} onDone={(nick) => {
        localStorage.setItem('cw-nickname', nick);
        setNickname(nick);
      }} />
    );
  }

  const enter = (code: string) => {
    if (nickname.trim()) localStorage.setItem('cw-nickname', nickname.trim());
    history.pushState(null, '', `/play/${code}`);
    setActiveCode(code);
  };

  return (
    <div className="center-screen">
      <div className="panel menu">
        <h1>Card Wars</h1>
        <p className="hint">Онлайн-партия по коду — скажите другу код или отправьте ссылку</p>
        <input placeholder="Ник" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        <button disabled={!nickname.trim()} onClick={() => enter(String(Math.floor(1000 + Math.random() * 9000)))}>
          Создать лобби
        </button>
        <div className="row">
          <input
            placeholder="Код (4 цифры)"
            inputMode="numeric"
            maxLength={4}
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && /^\d{4}$/.test(codeInput) && enter(codeInput)}
          />
          <button disabled={!/^\d{4}$/.test(codeInput) || !nickname.trim()} onClick={() => enter(codeInput)}>
            Войти
          </button>
        </div>
      </div>
    </div>
  );
}

function NicknameScreen({ code, onDone }: { code: string; onDone: (nick: string) => void }) {
  const [nick, setNick] = useState('');
  return (
    <div className="center-screen">
      <div className="panel">
        <h2>Комната {code}</h2>
        <input
          autoFocus
          placeholder="Ник"
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
