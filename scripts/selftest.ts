// End-to-end smoke test against a running server:  npx tsx scripts/selftest.ts http://localhost:3000
// Creates a temporary quiz and game, plays it with fake players, checks the scores, then cleans up.
import { io, type Socket } from 'socket.io-client';
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://localhost:3000';
const PASSWORD = process.env.PRESENTER_PASSWORD || '';

let token = '';
async function api(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-presenter-token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return data;
}

const connect = () =>
  new Promise<Socket>((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
const call = (s: Socket, ev: string, payload?: unknown) => s.timeout(5000).emitWithAck(ev, payload);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lastState(s: Socket) {
  let last: any = null;
  s.on('state', (m) => (last = m));
  return () => last;
}

async function main() {
  if (PASSWORD) token = (await api('/api/login', 'POST', { password: PASSWORD })).token;
  const quiz = await api('/api/quizzes', 'POST', {
    title: 'Selftest quiz',
    settings: { defaultTime: 10, defaultPoints: 100, firstBonus: 50, bingoMax: 75 },
    questions: [
      { kind: 'song', text: 'Q1', answers: ['a', 'b', 'c', 'd'], correct: 2 },
      { kind: 'band', text: 'Q2', answers: ['a', 'b'], correct: 0, image: { url: '/x.png', reveal: 'tiles', grid: 3 } },
    ],
  });
  assert.equal(quiz.questions.length, 2);
  assert.equal(quiz.questions[0].points, 100);
  console.log('✔ quiz created', quiz.id);

  const { code } = await api('/api/games', 'POST', { quizId: quiz.id });
  console.log('✔ game created', code);

  const presenter = await connect();
  const pState = lastState(presenter);
  assert.equal((await call(presenter, 'presenter:attach', { code, token })).ok, true);
  const display = await connect();
  assert.equal((await call(display, 'display:attach', { code })).ok, true);

  const players: Record<string, { s: Socket; id: string; token: string; state: () => any }> = {};
  for (const name of ['Alice', 'Bob', 'Cara']) {
    const s = await connect();
    const st = lastState(s);
    const r = await call(s, 'player:join', { code, name });
    assert.equal(r.ok, true, r.error);
    players[name] = { s, id: r.playerId, token: r.token, state: st };
  }
  const dup = await connect();
  assert.equal((await call(dup, 'player:join', { code, name: 'alice' })).ok, false, 'duplicate names are rejected');
  dup.close();
  console.log('✔ 3 players joined, duplicate name rejected');

  assert.equal((await call(players.Alice.s, 'player:createGroup', { name: 'Table 1' })).ok, true);
  assert.equal((await call(players.Bob.s, 'player:createGroup', { name: 'table 1' })).ok, true, 'same name joins the group');
  await sleep(200);
  const groups = pState().state.groups;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members, 2);
  console.log('✔ groups: "table 1" joined the existing "Table 1"');

  const act = (action: string, extra: object = {}) => call(presenter, 'presenter:action', { action, ...extra });
  const d = await act('draw');
  assert.equal(d.ok, true);
  assert.ok(d.number >= 1 && d.number <= 75);
  assert.equal((await act('draw', { number: d.number })).ok, false, 'cannot draw same number twice');
  assert.equal((await act('draw', { number: 7 === d.number ? 8 : 7 })).ok, true);
  console.log('✔ drawing numbers works');

  assert.equal((await act('start')).ok, true);
  await sleep(100);
  assert.equal((await call(players.Bob.s, 'player:answer', { choice: 9 })).ok, false, 'invalid choice rejected');
  assert.equal((await call(players.Alice.s, 'player:answer', { choice: 2 })).ok, true);
  await sleep(30);
  assert.equal((await call(players.Bob.s, 'player:answer', { choice: 2 })).ok, true);
  assert.equal((await call(players.Bob.s, 'player:answer', { choice: 1 })).ok, false, 'one answer per question');
  assert.equal((await call(players.Cara.s, 'player:answer', { choice: 0 })).ok, true);
  await sleep(1000); // everyone answered -> auto reveal
  let st = pState().state;
  assert.equal(st.phase, 'reveal');
  const score = (n: string) => st.players.find((p: any) => p.name === n).score;
  assert.equal(score('Alice'), 150, 'correct + first bonus');
  assert.equal(score('Bob'), 100);
  assert.equal(score('Cara'), 0);
  assert.equal(st.groups[0].score, 250);
  assert.equal(st.reveal.firstCorrect.name, 'Alice');
  assert.deepEqual(st.reveal.counts, [1, 0, 2, 0]);
  const aliceView = players.Alice.state();
  assert.deepEqual(aliceView.you.result, { correct: true, points: 150, first: true });
  assert.equal(aliceView.you.rank, 1);
  assert.equal(display.connected, true);
  console.log('✔ scoring: Alice 150 (first), Bob 100, Cara 0, group 250, auto reveal');

  // replaying the same question first takes back its points
  assert.equal((await act('start', { index: 0 })).ok, true);
  await sleep(150);
  st = pState().state;
  assert.equal(score('Alice'), 0);
  assert.equal(st.groups[0].score, 0);
  assert.equal((await call(players.Bob.s, 'player:answer', { choice: 2 })).ok, true);
  assert.equal((await act('reveal')).ok, true);
  await sleep(150);
  st = pState().state;
  assert.equal(score('Bob'), 150);
  assert.equal(score('Alice'), 0);
  console.log('✔ replaying a question resets its points');

  // reconnect with the saved token keeps the same player
  players.Cara.s.close();
  const again = await connect();
  const rj = await call(again, 'player:join', { code, playerId: players.Cara.id, token: players.Cara.token });
  assert.equal(rj.ok, true);
  assert.equal(rj.playerId, players.Cara.id);
  console.log('✔ player reconnects to the same seat');

  // printed card check
  const card = await api(`/api/games/${code}/card/A-001`);
  assert.equal(card.id, 'A-001');
  assert.equal(card.grid[2][2], 0);
  console.log(`✔ card check works (A-001 missing ${card.missing})`);

  const csv = await api(`/api/games/${code}/results.csv`);
  assert.match(csv, /Bob/);
  console.log('✔ results CSV');

  const kick = await act('kick', { playerId: players.Bob.id });
  assert.equal(kick.ok, true);
  assert.equal((await act('leaderboard')).ok, true);
  assert.equal((await act('end')).ok, true);
  await sleep(150);
  assert.equal(pState().state.phase, 'ended');
  console.log('✔ kick, leaderboard, end');

  await api(`/api/games/${code}`, 'DELETE');
  await api(`/api/quizzes/${quiz.id}`, 'DELETE');
  for (const s of [presenter, display, again, ...Object.values(players).map((p) => p.s)]) s.close();
  console.log('\nAll checks passed ✅');
}

main().catch((e) => {
  console.error('✗ FAILED:', e);
  process.exit(1);
});
