import { Suspense, lazy, useEffect, useMemo } from 'react';
import { GameConnection } from '../connection';
import { useGame } from '../store';
import { Hud } from './hud/Hud';
import { HudSidebar } from './hud/HudSidebar';
import { DomGame } from './debug/DomGame';
import { Lobby } from './lobby/Lobby';

const Scene = lazy(() => import('./scene/Scene').then((m) => ({ default: m.Scene })));

/** Game screen: lobby -> 3D scene + HUD; ?debug=1 — DOM debug view. */
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
          <div className="main-menu-panel cw-felt-box">
            <span className="eyebrow">Card Wars</span>
            <h1 className="cw-ink-title">Соединение потеряно</h1>
            <p className="main-menu-subtitle">Токен сессии сохранён — перезагрузка вернёт вас в партию</p>
            <button className="cw-btn-3d btn-green btn-lg" onClick={() => location.reload()}>
              Переподключиться
            </button>
          </div>
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
    <div className="game-3d game-fullscreen-arena">
      <div className="game-3d-main game-3d-viewport">
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
        <Hud code={code} />
      </div>
      <HudSidebar code={code} />
    </div>
  );
}
