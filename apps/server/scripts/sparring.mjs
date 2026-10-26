// Sparring client for visual checks: joins the room, marks itself ready,
// keeps its hand and ends its turns automatically. The actual game logic and
// bot opponents live on the server (docs/NETWORK.md «Боты»).
const CODE = process.argv[2] ?? '3141';
const BASE = process.env.SMOKE_BASE ?? 'ws://127.0.0.1:8787/ws';
const PROTOCOL_VERSION = 2;

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
  ws.addEventListener('open', () =>
    send({ t: 'join', code: CODE, nickname: 'Спарринг-бот', protocolVersion: PROTOCOL_VERSION }),
  );
  ws.addEventListener('error', reject);
  wait((m) => m.t === 'joined', 'joined').then((m) => resolve(m.you));
});

console.log(`bot joined room ${CODE} as ${you.playerId} (host=${you.isHost}); waiting for a partner…`);
await wait(
  (m) => m.t === 'lobby' && m.room.slots.filter(Boolean).length >= 2,
  'partner',
);
send({ t: 'lobby_command', command: { type: 'ready', ready: true } });
console.log('partner found; ready. Waiting for the host to start…');

let keptHand = false;
let mainTicks = 0;
const loop = setInterval(() => {
  const snapshot = [...queue].reverse().find((m) => m.t === 'snapshot');
  if (!snapshot) return;

  if (snapshot.view.status === 'mulligan' && !keptHand) {
    keptHand = true;
    send({ t: 'command', command: { type: 'keep_hand', player: you.playerId } });
    console.log('kept hand');
    return;
  }
  if (snapshot.view.status !== 'running') return;

  if (snapshot.view.activePlayers.includes(you.playerId) && snapshot.view.phase === 'main') {
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
