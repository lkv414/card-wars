import { useEffect, useMemo } from 'react';
import { GameConnection } from '../connection';
import { useGame } from '../store';
import { Scene } from './scene/Scene';
import { Hud } from './hud/Hud';
import { DomGame } from './debug/DomGame';

/** Экран игры: 3D-сцена + HUD; ?debug=1 — DOM-отладочный вид этапа 2. */
export function GameShell({ code, nickname }: { code: string; nickname: string }) {
  const conn = useMemo(() => new GameConnection(code, nickname), [code, nickname]);
  const status = useGame((s) => s.status);
  const lobby = useGame((s) => s.lobby);
  const you = useGame((s) => s.you);
  const error = useGame((s) => s.error);
  const view = useGame((s) => s.view);

  useEffect(() => {
    conn.connect();
    return () => conn.close();
  }, [conn]);

  if (status === 'closed') {
    return (
      <div className="center-screen">
        <div className="panel">
          <h2>Соединение потеряно</h2>
          <p className="hint">Токен сессии сохранён — перезагрузка вернёт вас в партию</p>
          <button onClick={() => location.reload()}>Переподключиться</button>
        </div>
      </div>
    );
  }

  if (status === 'lobby' && !view) {
    return (
      <div className="center-screen">
        <div className="panel menu">
          <h2>Лобби {code}</h2>
          {lobby?.players.map((p) => (
            <div key={p.id} className={p.connected ? '' : 'disconnected'}>
              {p.nickname} {lobby.host === p.id ? '(хост)' : ''} {p.connected ? '' : '— нет связи'}
            </div>
          ))}
          <button onClick={() => navigator.clipboard?.writeText(`${location.origin}/play/${code}`)}>
            Скопировать ссылку
          </button>
          {you?.isHost ? (
            <button
              disabled={(lobby?.players.filter((p) => p.connected).length ?? 0) < 2}
              onClick={() => useGame.getState().start()}
            >
              Начать матч
            </button>
          ) : (
            <p className="hint">Ждём, когда хост начнёт матч…</p>
          )}
          {error && <div className="error-line">{error.message}</div>}
        </div>
      </div>
    );
  }

  if (!view) return <div className="center-screen hint">Ожидание начала матча…</div>;

  if (location.search.includes('debug=1')) {
    return <DomGame code={code} />;
  }

  return (
    <div className="game-3d">
      <Scene />
      <Hud code={code} />
    </div>
  );
}
