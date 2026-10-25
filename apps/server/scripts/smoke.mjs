// Stage-2 smoke: a full scripted match over real WebSockets against wrangler dev.
// Two connections act as the "two browser tabs" (docs/TECH.md, этап 2).
import { cards } from '@card-wars/content';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:8787';
const WS_BASE = BASE.replace('http', 'ws');
const CODE = String(Math.floor(1000 + Math.random() * 9000));

function connect(name) {
  const ws = new WebSocket(`${WS_BASE}/ws?code=${CODE}`);
  const queue = [];
  const waiters = [];
  ws.addEventListener('message', (event) => {
    if (String(event.data) === 'pong') return;
    const message = JSON.parse(String(event.data));
    queue.push(message);
    for (const waiter of waiters.splice(0)) waiter();
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  async function wait(predicate, label, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return queue.splice(index, 1)[0];
      if (Date.now() > deadline) throw new Error(`timeout waiting: ${label}; have: ${queue.map((m) => m.t).join(',')}`);
      await new Promise((resolve) => waiters.push(resolve));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  function send(message) {
    ws.send(JSON.stringify(message));
  }
  return { ws, ready, wait, send, name };
}

const assert = (condition, label) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ok — ${label}`);
};

console.log(`Комната ${CODE}`);
const a = connect('Вкладка A');
const b = connect('Вкладка B');
await a.ready;
await b.ready;

a.send({ t: 'join', code: CODE, nickname: 'Бимо', protocolVersion: 1 });
const joinedA = await a.wait((m) => m.t === 'joined', 'A joined');
assert(joinedA.you.isHost === true, 'первый вошедший — хост');

b.send({ t: 'join', code: CODE, nickname: 'Билли', protocolVersion: 1 });
const joinedB = await b.wait((m) => m.t === 'joined', 'B joined');
assert(joinedB.you.isHost === false, 'второй — не хост');
await a.wait((m) => m.t === 'lobby' && m.room.players.length === 2, 'A видит обоих в лобби');

a.send({ t: 'start', player: joinedA.you.playerId });
const snapA1 = await a.wait((m) => m.t === 'snapshot' && m.view.status === 'mulligan', 'снапшот муллигана у A');
const snapB1 = await b.wait((m) => m.t === 'snapshot' && m.view.status === 'mulligan', 'снапшот муллигана у B');
assert(snapB1.view.players[joinedA.you.playerId].handCount === 5, 'рука A = 5 (только счётчик)');

// утечка: id карт руки A не встречаются в виде B
const jsonB = JSON.stringify(snapB1);
// возьмём реальный вид A: его собственная рука
for (const card of snapA1.view.myHand) {
  assert(!jsonB.includes(card.instanceId), `карта ${card.instanceId} руки A не утекла к B`);
}

a.send({ t: 'command', command: { type: 'keep_hand', player: joinedA.you.playerId } });
b.send({ t: 'command', command: { type: 'mulligan', player: joinedB.you.playerId } });
const snapA2 = await a.wait((m) => m.t === 'snapshot' && m.view.status === 'running', 'матч идёт (A)');
await b.wait((m) => m.t === 'snapshot' && m.view.status === 'running', 'матч идёт (B)');
assert(snapA2.view.turn === 1 && snapA2.view.activePlayer === joinedA.you.playerId, 'первый ход у A');
assert(snapA2.view.journal.length > 0, 'журнал заполнен');

// A играет существо из руки (любое существо в руке)
const handCard = snapA2.view.myHand.find((c) => cards.find((x) => x.id === c.cardId)?.type === 'creature');
assert(Boolean(handCard), 'в руке A есть существо');
const itsCost = cards.find((x) => x.id === handCard.cardId).cost;
a.send({ t: 'command', command: { type: 'play_card', player: joinedA.you.playerId, instanceId: handCard.instanceId, zone: 0 } });
const snapA3 = await a.wait((m) => m.t === 'snapshot' && m.view.players[joinedA.you.playerId].zones[0].creature, 'существо в зоне 1');
assert(snapA3.view.players[joinedA.you.playerId].actions === 2 - itsCost, 'действие списано');

// B пытается послать команду за A — отклон
b.send({ t: 'command', command: { type: 'go_battle', player: joinedA.you.playerId } });
await b.wait((m) => m.t === 'error' && m.message.includes('другого игрока'), 'команда за другого отклонена');

// A заканчивает ход → ход B; A жмёт «Поторопить»
a.send({ t: 'command', command: { type: 'go_battle', player: joinedA.you.playerId } });
const snapB2 = await b.wait((m) => m.t === 'snapshot' && m.view.activePlayer === joinedB.you.playerId, 'ход перешёл к B');
assert(snapB2.view.turn === 2, 'ход 2');
a.send({ t: 'hurry', player: joinedA.you.playerId });
const timerMsg = await a.wait((m) => m.t === 'timer' && m.timer.running, 'таймер запущен');
assert(timerMsg.timer.remainingMs > 80_000, `таймер ~90 с (${Math.round(timerMsg.timer.remainingMs / 1000)} с)`);

// спам «Поторопить» ускоряет
a.send({ t: 'hurry', player: joinedA.you.playerId });
const timer2 = await a.wait((m) => m.t === 'timer' && m.timer !== timerMsg.timer, 'повторное ускорение');
assert(timer2.timer.remainingMs <= timerMsg.timer.remainingMs, 'остаток не сброшен');

// обрыв B: партия на паузу, реконнект по токену — пауза снята
b.ws.close();
const pausedSnap = await a.wait((m) => m.t === 'snapshot' && m.timer?.paused === true, 'пауза при обрыве');
assert(pausedSnap.view.players[joinedB.you.playerId].connected === false, 'B помечен отключённым');
const b2 = connect('Вкладка B (возврат)');
await b2.ready;
b2.send({ t: 'join', code: CODE, nickname: 'Билли', token: joinedB.you.token, protocolVersion: 1 });
await b2.wait((m) => m.t === 'joined', 'B переподключился по токену');
const resumedA = await a.wait((m) => m.t === 'snapshot' && m.timer?.paused === false, 'пауза снята после возврата');
assert(resumedA.view.players[joinedB.you.playerId].connected === true, 'B снова на связи');

// B сдаётся → конец партии
b2.send({ t: 'command', command: { type: 'surrender', player: joinedB.you.playerId } });
const finA = await a.wait((m) => m.t === 'snapshot' && m.view.status === 'finished', 'партия завершена (A)');
assert(finA.view.winners.includes(joinedA.you.playerId), 'победитель — A');
assert(finA.view.finishReason === 'surrender', 'причина — сдача');
await b.wait((m) => m.t === 'snapshot' && m.view.status === 'finished', 'партия завершена (B)');

console.log('\nSMOKE PASS — партия в «двух вкладках» сыграна полностью');
process.exit(0);
