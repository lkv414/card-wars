// Stage-5 smoke: 2v2 «стенка» with three server bots. The human host keeps
// their hand and ends every own turn; bots must act through the same API.
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:8787';
const WS_BASE = BASE.replace('http', 'ws');
const CODE = String(Math.floor(1000 + Math.random() * 9000));
const PROTOCOL_VERSION = 2;

const ws = new WebSocket(`${WS_BASE}/ws?code=${CODE}`);
const queue = [];
const waiters = [];
ws.addEventListener('message', (event) => {
  if (String(event.data) === 'pong') return;
  queue.push(JSON.parse(String(event.data)));
  for (const waiter of waiters.splice(0)) waiter();
});
const ready = new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
const send = (message) => ws.send(JSON.stringify(message));
async function wait(predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const index = queue.findIndex(predicate);
    if (index >= 0) return queue.splice(index, 1)[0];
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await new Promise((resolve) => waiters.push(resolve));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const assert = (condition, label) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ok — ${label}`);
};

await ready;
send({ t: 'join', code: CODE, nickname: 'Хост', protocolVersion: PROTOCOL_VERSION, create: true });
const joined = await wait((m) => m.t === 'joined', 'joined');
const me = joined.you.playerId;
console.log(`Комната ${CODE}, хост ${me}`);

for (let i = 0; i < 3; i++) send({ t: 'lobby_command', command: { type: 'add_bot' } });
send({ t: 'lobby_command', command: { type: 'set_mode', mode: { kind: 'teams', variant: 'wall' } } });
send({ t: 'lobby_command', command: { type: 'ready', ready: true } });
const lobby = await wait(
  (m) => m.t === 'lobby' && m.room.slots.filter(Boolean).length === 4 && m.room.slots.filter(Boolean).every((s) => s.ready),
  'lobby full & ready',
);
assert(lobby.room.mode.kind === 'teams' && lobby.room.mode.variant === 'wall', '2 на 2 «стенка»');
assert(lobby.room.slots.filter(Boolean).filter((s) => s.isBot).length === 3, 'три бота в слотах');

send({ t: 'lobby_command', command: { type: 'start' } });
let latest = null;
let decideSent = false;
let endedTurns = 0;
let lastTurn = -1;
const deadline = Date.now() + 20_000;

while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const snapshot = [...queue].reverse().find((m) => m.t === 'snapshot');
  if (!snapshot) continue;
  latest = snapshot.view;
  if (latest.turn !== lastTurn) {
    lastTurn = latest.turn;
    const info = latest.order.map((pid) => {
      const p = latest.players[pid];
      return `${p.nickname}:${p.actions}a${p.battleReady ? 'R' : ''}${p.eliminated ? 'X' : ''}`;
    });
    console.log(`  [turn ${latest.turn}] active=${latest.activePlayers.join(',')} | ${info.join(' | ')}`);
  }

  if (latest.status === 'mulligan' && !decideSent) {
    decideSent = true;
    send({ t: 'command', command: { type: 'keep_hand', player: me } });
  }
  if (latest.status === 'running' && latest.activePlayers.includes(me) && latest.phase === 'main') {
    const mine = latest.players[me];
    if (!mine.battleReady) {
      endedTurns++;
      send({ t: 'command', command: { type: 'go_battle', player: me } });
    }
  }
  if (latest.turn >= 4) break;
}

assert(Boolean(latest), 'получен снапшот партии');
assert(latest.mode === 'teams' && latest.teamVariant === 'wall', 'режим 2 на 2 «стенка»');
assert(latest.activePlayers.length === 2, 'в ход команды активны двое');
assert(latest.status === 'running' || latest.status === 'finished', 'партия идёт');
assert(latest.turn >= 3, `сыграно ходов: ${latest.turn}`);
assert(latest.journal.some((line) => line.includes('Бот')), 'боты фигурируют в журнале');
assert(endedTurns >= 1, 'хост завершал свои ходы');

const botCreatures = Object.values(latest.players)
  .filter((p) => p.id !== me)
  .flatMap((p) => p.zones)
  .filter((zone) => zone.creature).length;
console.log(`  ботовых существ на поле: ${botCreatures}; ходов: ${latest.turn}`);
assert(latest.journal.some((line) => line.includes('готов к бою')), 'боты жмут готовность');

console.log('\nBOTS SMOKE PASS — 2 на 2 с ботами идёт, боты действуют через сервер');
process.exit(0);
