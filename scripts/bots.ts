// Rehearsal helper: fills a game with fake players who join groups and answer at random.
//   npx tsx scripts/bots.ts <game code> [how many=12] [server=http://localhost:3000]
import { io } from 'socket.io-client';

const [code, countArg, baseArg] = process.argv.slice(2);
if (!code) {
  console.log('Usage: npx tsx scripts/bots.ts <game code> [count] [server url]');
  process.exit(1);
}
const COUNT = Number(countArg || 12);
const BASE = baseArg || 'http://localhost:3000';
const NAMES = ['Ana', 'Ben', 'Chloe', 'Dan', 'Eva', 'Finn', 'Gina', 'Hugo', 'Iris', 'Jack', 'Kira', 'Leo', 'Mia', 'Nico', 'Olga', 'Pete', 'Rosa', 'Sam', 'Tara', 'Vik'];
const GROUPS = ['Rock Stars', 'Disco Divas', 'The Jukebox', 'Table 7'];

for (let i = 0; i < COUNT; i++) {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  const name = `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''} 🤖`;
  let answeredKey = '';
  s.on('connect', async () => {
    const r = await s.emitWithAck('player:join', { code, name });
    if (!r.ok) return console.log(name, r.error);
    if (i % 5 !== 4) await s.emitWithAck('player:createGroup', { name: GROUPS[i % GROUPS.length] });
    console.log(`${name} joined`);
  });
  s.on('state', ({ state }: any) => {
    const q = state.question;
    if (state.phase !== 'question' || !q || q.closed) return;
    const key = `${q.id}:${q.startedAt}`;
    if (answeredKey === key) return;
    answeredKey = key;
    const delay = 1000 + Math.random() * (q.timeLimit * 1000 * 0.7);
    setTimeout(() => s.emit('player:answer', { choice: Math.floor(Math.random() * q.answers.length) }, () => {}), delay);
  });
}
console.log(`Starting ${COUNT} bots for game ${code} on ${BASE}. Press Ctrl+C to stop.`);
