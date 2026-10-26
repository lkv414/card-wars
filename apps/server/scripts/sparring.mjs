// Sparring bot for visual checks: joins as the host, starts when a second
// player arrives, keeps its hand, then idles holding the match open.
const CODE = process.argv[2] ?? '3141';
const BASE = process.env.SMOKE_BASE ?? 'ws://127.0.0.1:8787/ws';

const ws = new WebSocket(`${BASE}?code=${CODE}`);
const queue = [];
ws.addEventListener('message', (event) => {
  if (String(event.data) !== 'pong') queue.push(JSON.parse(String(event.data)));
});
const send = (message) => ws.send(JSON.stringify(message));
const wait = (predicate, label, timeoutMs = 240000) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = setInterval(() => {
      const index = queue.findIndex(predicate);
      if (index >= 0) {
        clearInterval(tick);
        resolve(queue.splice(index, 1)[0]);
      } else if (Date.now() > deadline) {
        clearInterval(tick);
        reject(new Error(`timeout: ${label}`));
      }
    }, 100);
  });

const you = await new Promise((resolve, reject) => {
  ws.addEventListener('open', () => send({ t: 'join', code: CODE, nickname: 'Спарринг-бот', protocolVersion: 1 }));
  ws.addEventListener('error', reject);
  wait((m) => m.t === 'joined', 'joined').then((m) => resolve(m.you));
});

console.log(`bot joined room ${CODE} as ${you.playerId} (host=${you.isHost}); waiting for a partner…`);
await wait((m) => m.t === 'lobby' && m.room.players.length === 2, 'partner');
send({ t: 'start', player: you.playerId });
await wait((m) => m.t === 'snapshot' && m.view.status === 'mulligan', 'match started');
send({ t: 'command', command: { type: 'keep_hand', player: you.playerId } });
console.log('match started, bot kept hand; ending its turns automatically');

// Игровой цикл: на своём ходу в основную фазу бот отправляет «В бой».
let mainTicks = 0;
const loop = setInterval(() => {
  const snapshot = [...queue].reverse().find((m) => m.t === 'snapshot');
  if (!snapshot || snapshot.view.status !== 'running') return;
  if (snapshot.view.activePlayer === you.playerId && snapshot.view.phase === 'main') {
    mainTicks++;
    if (mainTicks >= 2) {
      mainTicks = 0;
      send({ t: 'command', command: { type: 'go_battle', player: you.playerId } });
    }
  } else {
    mainTicks = 0;
  }
}, 900);
setTimeout(() => {
  clearInterval(loop);
  process.exit(0);
}, 600_000);
