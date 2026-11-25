// Musical Bingo server: REST API for quizzes/uploads, Socket.IO for the live game,
// and the built web apps (presenter, player, display).
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import multer from 'multer';
import QRCode from 'qrcode';
import { nanoid } from 'nanoid';
import { Game } from './game.ts';
import {
  DATA_DIR,
  GAME_DIR,
  RESULT_DIR,
  UPLOAD_DIR,
  deleteQuiz,
  getQuiz,
  listQuizzes,
  saveQuiz,
} from './store.ts';
import { checkCard, parseCardId } from '../shared/bingo.ts';
import type { GameSummary } from '../shared/types.ts';

const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.PRESENTER_PASSWORD || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const DIST = path.resolve('dist');

const presenterToken = PASSWORD ? crypto.createHash('sha256').update(`musical-bingo:${PASSWORD}`).digest('hex') : '';
const isPresenter = (token: unknown) => !PASSWORD || token === presenterToken;

// ---------- games ----------

const games = new Map<string, Game>();
const saveTimers = new Map<string, NodeJS.Timeout>();
const broadcastTimers = new Map<string, NodeJS.Timeout>();

function onGameChange(game: Game) {
  // coalesce bursts (e.g. 100 answers in a second) into a few broadcasts
  if (!broadcastTimers.has(game.code)) {
    broadcastTimers.set(
      game.code,
      setTimeout(() => {
        broadcastTimers.delete(game.code);
        broadcast(game);
      }, 80),
    );
  }
  if (!saveTimers.has(game.code)) {
    saveTimers.set(
      game.code,
      setTimeout(() => {
        saveTimers.delete(game.code);
        saveGame(game);
      }, 1000),
    );
  }
}

function saveGame(game: Game) {
  if (games.get(game.code) !== game) return; // closed meanwhile
  try {
    fs.writeFileSync(path.join(GAME_DIR, `${game.code}.json`), JSON.stringify(game.toJSON()));
    if (game.phase === 'ended') saveResults(game);
  } catch (e) {
    console.error('Could not save game', game.code, e);
  }
}

function saveResults(game: Game) {
  const file = path.join(RESULT_DIR, `${new Date(game.createdAt).toLocaleDateString('sv-SE')}-${game.code}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      { code: game.code, title: game.quiz.title, playedAt: game.createdAt, drawn: game.drawn, players: game.playerRows(), groups: game.groupRows() },
      null,
      2,
    ),
  );
}

function loadGames() {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  for (const f of fs.readdirSync(GAME_DIR)) {
    if (!f.endsWith('.json')) continue;
    const file = path.join(GAME_DIR, f);
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.createdAt < weekAgo) {
        fs.unlinkSync(file);
        continue;
      }
      games.set(data.code, Game.fromJSON(data, onGameChange));
    } catch (e) {
      console.error('Could not restore game', f, e);
    }
  }
  if (games.size) console.log(`Restored ${games.size} game(s): ${[...games.keys()].join(', ')}`);
}

function newCode(): string {
  for (;;) {
    const code = String(Math.floor(10000 + Math.random() * 90000));
    if (!games.has(code)) return code;
  }
}

function gameSummaries(): GameSummary[] {
  return [...games.values()]
    .map((g) => ({ code: g.code, title: g.quiz.title, phase: g.phase, players: g.players.size, createdAt: g.createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ---------- network info (for the join QR code) ----------

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vEthernet|VirtualBox|VMware|WSL|docker|Hyper-V|Loopback/i.test(name)) continue;
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  // prefer common home/venue ranges
  return out.sort((a, b) => Number(!/^(192\.168|10\.|172\.)/.test(a)) - Number(!/^(192\.168|10\.|172\.)/.test(b)));
}

// ---------- http ----------

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

const requirePresenter: express.RequestHandler = (req, res, next) => {
  if (isPresenter(req.get('x-presenter-token'))) return next();
  res.status(401).json({ error: 'Presenter login required.' });
};

app.get('/api/info', (_req, res) => {
  res.json({ needsLogin: !!PASSWORD, publicUrl: PUBLIC_URL || null, lanAddresses: lanAddresses() });
});

app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ token: '' });
  if (req.body?.password === PASSWORD) return res.json({ token: presenterToken });
  res.status(401).json({ error: 'Wrong password.' });
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 500);
  if (!text) return res.status(400).end();
  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
});

app.get('/api/quizzes', requirePresenter, (_req, res) => res.json(listQuizzes()));
app.post('/api/quizzes', requirePresenter, (req, res) => res.json(saveQuiz(req.body)));
app.get('/api/quizzes/:id', requirePresenter, (req, res) => {
  const q = getQuiz(String(req.params.id));
  q ? res.json(q) : res.status(404).json({ error: 'Quiz not found.' });
});
app.put('/api/quizzes/:id', requirePresenter, (req, res) => {
  if (!getQuiz(String(req.params.id))) return res.status(404).json({ error: 'Quiz not found.' });
  res.json(saveQuiz(req.body, String(req.params.id)));
});
app.delete('/api/quizzes/:id', requirePresenter, (req, res) => res.json({ ok: deleteQuiz(String(req.params.id)) }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '').slice(0, 6);
      cb(null, `${Date.now()}-${nanoid(6)}${ext}`);
    },
  }),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^(image|audio)\//.test(file.mimetype)),
});

app.post('/api/upload', requirePresenter, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Only image and audio files can be uploaded (max 40 MB).' });
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

app.get('/api/games', (_req, res) => res.json(gameSummaries()));

app.post('/api/games', requirePresenter, (req, res) => {
  const quiz = getQuiz(String(req.body?.quizId || ''));
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  if (!quiz.questions.length) return res.status(400).json({ error: 'This quiz has no questions yet.' });
  const code = newCode();
  const game = new Game(code, quiz, onGameChange);
  games.set(code, game);
  saveGame(game);
  res.json({ code });
});

app.delete('/api/games/:code', requirePresenter, (req, res) => {
  const g = games.get(String(req.params.code));
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  saveResults(g);
  g.dispose();
  games.delete(g.code);
  clearTimeout(saveTimers.get(g.code));
  saveTimers.delete(g.code);
  io.to(g.code).emit('gameClosed');
  fs.rmSync(path.join(GAME_DIR, `${g.code}.json`), { force: true });
  res.json({ ok: true });
});

app.get('/api/games/:code/results.csv', requirePresenter, (req, res) => {
  const g = games.get(String(req.params.code));
  if (!g) return res.status(404).send('Game not found');
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const groups = new Map(g.groupRows().map((x) => [x.id, x]));
  const lines = [['Rank', 'Player', 'Group', 'Points', 'Correct answers', 'First correct'].map(q).join(',')];
  g.playerRows().forEach((p, i) =>
    lines.push([i + 1, p.name, p.groupId ? (groups.get(p.groupId)?.name ?? '') : '', p.score, p.correct, p.firsts].map(q).join(',')),
  );
  lines.push('');
  lines.push([q('Rank'), q('Group'), q('Members'), q('Total points'), q('Score')].join(','));
  g.groupRows().forEach((x, i) => lines.push([i + 1, x.name, x.members, x.total, x.score].map(q).join(',')));
  res
    .type('text/csv')
    .set('Content-Disposition', `attachment; filename="musical-bingo-${g.code}.csv"`)
    .send('﻿' + lines.join('\r\n'));
});

app.get('/api/games/:code/card/:id', requirePresenter, (req, res) => {
  const g = games.get(String(req.params.code));
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  const id = parseCardId(String(req.params.id));
  if (!id) return res.status(400).json({ error: 'Card number looks like A-012.' });
  if (g.quiz.settings.bingoMax !== 75) return res.status(400).json({ error: 'Card checking works with 75-ball cards only.' });
  res.json(checkCard(id.series, id.n, g.drawn));
});

app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '7d',
    // uploaded files are shown as images/audio only; never let them run scripts (e.g. inside an SVG)
    setHeaders: (res) => {
      res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; sandbox");
      res.set('X-Content-Type-Options', 'nosniff');
    },
  }),
);

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { extensions: ['html'], index: 'index.html' }));
} else {
  app.get('/', (_req, res) =>
    res.send('The web apps are not built yet. Run <code>npm start</code> (or <code>npm run dev</code> and open port 5173).'),
  );
}

// ---------- sockets ----------

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, pingInterval: 10000, pingTimeout: 20000 });

type Role = 'player' | 'display' | 'presenter';
interface SocketData {
  role?: Role;
  code?: string;
  playerId?: string;
}

function broadcast(game: Game) {
  if (!games.has(game.code)) return;
  const state = game.publicState();
  let extra: ReturnType<Game['presenterExtra']> | null = null;
  const room = io.sockets.adapter.rooms.get(game.code);
  if (!room) return;
  for (const id of room) {
    const s = io.sockets.sockets.get(id) as Socket<any, any, any, SocketData> | undefined;
    if (!s) continue;
    const d = s.data;
    if (d.role === 'player') s.emit('state', { state, you: game.playerYou(d.playerId!, state.players) });
    else if (d.role === 'presenter') s.emit('state', { state, extra: (extra ??= game.presenterExtra()) });
    else s.emit('state', { state });
  }
}

function sendTo(s: Socket<any, any, any, SocketData>, game: Game) {
  const state = game.publicState();
  if (s.data.role === 'player') s.emit('state', { state, you: game.playerYou(s.data.playerId!, state.players) });
  else if (s.data.role === 'presenter') s.emit('state', { state, extra: game.presenterExtra() });
  else s.emit('state', { state });
}

type Ack = (r: unknown) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

io.on('connection', (socket: Socket<any, any, any, SocketData>) => {
  const leave = () => {
    const { code, role, playerId } = socket.data;
    if (code) socket.leave(code);
    if (role === 'player' && code && playerId) games.get(code)?.detachSocket(playerId, socket.id);
    socket.data = {};
  };

  socket.on('player:join', (msg: any, ackIn: unknown) => {
    const ack = safeAck(ackIn);
    const game = games.get(String(msg?.code || '').trim());
    if (!game) return ack({ ok: false, error: 'No game with that code. Check the code on the big screen.' });
    const r = game.join(msg?.name, msg?.playerId, msg?.token);
    if (!r.ok) return ack(r);
    leave();
    socket.data = { role: 'player', code: game.code, playerId: r.player.id };
    socket.join(game.code);
    game.attachSocket(r.player.id, socket.id);
    ack({ ok: true, playerId: r.player.id, token: r.player.token, name: r.player.name });
    sendTo(socket, game);
  });

  socket.on('display:attach', (msg: any, ackIn: unknown) => {
    const ack = safeAck(ackIn);
    const game = games.get(String(msg?.code || ''));
    if (!game) return ack({ ok: false, error: 'Game not found.' });
    leave();
    socket.data = { role: 'display', code: game.code };
    socket.join(game.code);
    ack({ ok: true });
    sendTo(socket, game);
  });

  socket.on('presenter:attach', (msg: any, ackIn: unknown) => {
    const ack = safeAck(ackIn);
    if (!isPresenter(msg?.token)) return ack({ ok: false, error: 'Presenter login required.' });
    const game = games.get(String(msg?.code || ''));
    if (!game) return ack({ ok: false, error: 'Game not found.' });
    leave();
    socket.data = { role: 'presenter', code: game.code };
    socket.join(game.code);
    ack({ ok: true });
    sendTo(socket, game);
  });

  const playerGame = () => {
    const { role, code, playerId } = socket.data;
    const game = role === 'player' && code ? games.get(code) : undefined;
    return game && playerId && game.players.has(playerId) ? { game, playerId } : null;
  };

  socket.on('player:answer', (msg: any, ackIn: unknown) => {
    const ack = safeAck(ackIn);
    const pg = playerGame();
    if (!pg) return ack({ ok: false, error: 'Not in a game.' });
    ack(pg.game.answer(pg.playerId, msg?.choice));
  });

  socket.on('player:createGroup', (msg: any, ackIn: unknown) => {
    const ack = safeAck(ackIn);
    const pg = playerGame();
    if (!pg) return ack({ ok: false, error: 'Not in a game.' });
    ack(pg.game.createGroup(pg.playerId, msg?.name));
  });

  socket.on('player:joinGroup', (msg: any, ackIn: unknown) => {
    const ack = safeAck(ackIn);
    const pg = playerGame();
    if (!pg) return ack({ ok: false, error: 'Not in a game.' });
    ack(pg.game.joinGroup(pg.playerId, msg?.groupId ? String(msg.groupId) : null));
  });

  socket.on('player:leave', () => {
    const pg = playerGame();
    if (pg && pg.game.phase === 'lobby') pg.game.kick(pg.playerId);
    leave();
  });

  socket.on('presenter:action', (msg: any, ackIn: unknown) => {
    const ack = safeAck(ackIn);
    const { role, code } = socket.data;
    const game = role === 'presenter' && code ? games.get(code) : undefined;
    if (!game) return ack({ ok: false, error: 'Not attached to a game.' });
    const a = String(msg?.action || '');
    switch (a) {
      case 'draw':
        return ack(game.draw(msg.number == null || msg.number === '' ? undefined : Number(msg.number)));
      case 'undoDraw':
        return ack(game.undoDraw());
      case 'bingoMax':
        return ack(game.setBingoMax(Number(msg.max)));
      case 'playAs':
        return ack(game.setPlayAs(msg.value));
      case 'theme':
        return ack(game.setTheme(msg.value));
      case 'resetBingo':
        return ack(game.resetBingo());
      case 'start':
        return ack(game.startQuestion(msg.index == null ? undefined : Number(msg.index)));
      case 'close':
        return ack(game.closeAnswers());
      case 'reveal':
        return ack(game.reveal());
      case 'leaderboard':
        return ack(game.showLeaderboard());
      case 'lobby':
        return ack(game.backToLobby());
      case 'end':
        return ack(game.end());
      case 'kick': {
        const pid = String(msg.playerId);
        for (const [id, s] of io.sockets.sockets) {
          const d = (s as Socket<any, any, any, SocketData>).data;
          if (d.role === 'player' && d.code === game.code && d.playerId === pid) {
            s.emit('kicked');
            s.leave(game.code);
            (s as Socket<any, any, any, SocketData>).data = {};
            void id;
          }
        }
        return ack({ ok: game.kick(pid) });
      }
      case 'adjust':
        return ack(game.adjustScore(String(msg.playerId), Number(msg.delta)));
      case 'announce':
        return ack(game.announce(msg.text));
      case 'media':
        return ack(game.media(msg.mode === 'stop' ? 'stop' : 'replay'));
      default:
        return ack({ ok: false, error: `Unknown action ${a}` });
    }
  });

  socket.on('time', (_: unknown, ackIn: unknown) => safeAck(ackIn)(Date.now()));

  socket.on('disconnect', leave);
});

// ---------- start ----------

loadGames();

server.listen(PORT, () => {
  const lan = lanAddresses();
  console.log('\n  🎵  Musical Bingo server is running\n');
  console.log(`  This computer:   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  On the network:  http://${ip}:${PORT}`);
  if (PUBLIC_URL) console.log(`  Public URL:      ${PUBLIC_URL}`);
  console.log(`\n  Presenter: /presenter   Big screen: /display   Players: /play`);
  console.log(`  Data folder: ${DATA_DIR}`);
  if (!PASSWORD) console.log('  ⚠  No PRESENTER_PASSWORD set: anyone on the network can open the presenter app.');
  console.log('');
});

const shutdown = () => {
  for (const g of games.values()) saveGame(g);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
