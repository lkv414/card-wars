import { useEffect, useMemo } from 'react';
import { GameConnection } from '../connection';
import { useGame } from '../store';
import { Scene } from './scene/Scene';
import { Hud } from './hud/Hud';
import { DomGame } from './debug/DomGame';
import { Lobby } from './lobby/Lobby';

/** Экран игры: лобби → 3D-сцена + HUD; ?debug=1 — DOM-отладочный вид. */
export function GameShell({ code, nickname }: { code: string; nickname: string }) {
  const [create] = useMemo(
    () => [new URLSearchParams(location.search).get('create') === '1'],
    [],
  );
  const conn = useMemo(() => new GameConnection(code, nickname, create), [code, nickname, create]);
  const status = useGame((s) => s.status);
  const view = useGame((s) => s.view);

  useEffect(() => {
    conn.connect();
    return () => conn.close();
  }, [conn]);

  if (status === 'closed') {
    return (
      <main className="main-menu ui-v2">
        <div className="main-menu-content">
          <span className="eyebrow">Card Wars</span>
          <h1>Соединение потеряно</h1>
          <p className="main-menu-subtitle">Токен сессии сохранён — перезагрузка вернёт вас в партию</p>
          <button className="btn-primary btn-xl" onClick={() => location.reload()}>
            Переподключиться
          </button>
        </div>
      </main>
    );
  }

  if (!view) {
    return <Lobby code={code} />;
  }

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
