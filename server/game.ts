// One live game: players, groups, drawn bingo numbers, questions, scoring.
import { nanoid } from 'nanoid';
import type {
  GroupRow,
  LiveQuestion,
  Phase,
  PlayerRow,
  PlayerYou,
  PresenterExtra,
  PublicState,
  Quiz,
  RevealInfo,
} from '../shared/types.ts';

interface Player {
  id: string;
  token: string;
  name: string;
  groupId: string | null;
  score: number;
  correct: number;
  firsts: number;
  joinedAt: number;
  sockets: Set<string>;
}

interface Group {
  id: string;
  name: string;
  total: number;
}

interface Answer {
  choice: number;
  at: number;
}

interface Current {
  index: number;
  startedAt: number;
  endsAt: number;
  closed: boolean;
  answers: Map<string, Answer>;
  reveal: RevealInfo | null;
  results: Map<string, { correct: boolean; points: number; first: boolean }>;
}

interface Award {
  playerId: string;
  groupId: string | null;
  points: number;
  correct: boolean;
  first: boolean;
}

type Result<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_NAME = 24;
const cleanName = (s: unknown) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);

export class Game {
  code: string;
  quiz: Quiz;
  createdAt = Date.now();
  phase: Phase = 'lobby';
  players = new Map<string, Player>();
  groups = new Map<string, Group>();
  drawn: number[] = [];
  questionIndex = -1;
  current: Current | null = null;
  /** points awarded per question id, so a replayed question can be undone first */
  history = new Map<string, Award[]>();
  announcement: { text: string; at: number } | null = null;
  mediaNonce = 0;
  mediaStopped = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    code: string,
    quiz: Quiz,
    private onChange: (game: Game) => void,
  ) {
    this.code = code;
    this.quiz = quiz;
  }

  private changed() {
    this.onChange(this);
  }

  // ---------- players & groups ----------

  join(nameIn: unknown, playerId?: string, token?: string): Result<{ player: Player }> {
    if (playerId && token) {
      const p = this.players.get(playerId);
      if (p && p.token === token) return { ok: true, player: p };
    }
    const name = cleanName(nameIn);
    if (!name) return { ok: false, error: 'Please enter your name.' };
    if (this.phase === 'ended') return { ok: false, error: 'This game has ended.' };
    const lower = name.toLowerCase();
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === lower) return { ok: false, error: 'That name is taken, please pick another one.' };
    }
    if (this.players.size >= 1000) return { ok: false, error: 'The game is full.' };
    const player: Player = {
      id: nanoid(10),
      token: nanoid(24),
      name,
      groupId: null,
      score: 0,
      correct: 0,
      firsts: 0,
      joinedAt: Date.now(),
      sockets: new Set(),
    };
    this.players.set(player.id, player);
    this.changed();
    return { ok: true, player };
  }

  attachSocket(playerId: string, socketId: string) {
    this.players.get(playerId)?.sockets.add(socketId);
    this.changed();
  }

  detachSocket(playerId: string, socketId: string) {
    this.players.get(playerId)?.sockets.delete(socketId);
    this.changed();
  }

  kick(playerId: string): boolean {
    const ok = this.players.delete(playerId);
    this.current?.answers.delete(playerId);
    this.pruneGroups();
    if (ok) this.changed();
    return ok;
  }

  createGroup(playerId: string, nameIn: unknown): Result {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: 'Unknown player.' };
    const name = cleanName(nameIn);
    if (!name) return { ok: false, error: 'Please enter a group name.' };
    const existing = [...this.groups.values()].find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (existing) return this.joinGroup(playerId, existing.id);
    if (this.groups.size >= 200) return { ok: false, error: 'Too many groups.' };
    const g: Group = { id: nanoid(8), name, total: 0 };
    this.groups.set(g.id, g);
    p.groupId = g.id;
    this.pruneGroups();
    this.changed();
    return { ok: true };
  }

  joinGroup(playerId: string, groupId: string | null): Result {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: 'Unknown player.' };
    if (groupId && !this.groups.has(groupId)) return { ok: false, error: 'That group no longer exists.' };
    p.groupId = groupId;
    this.pruneGroups();
    this.changed();
    return { ok: true };
  }

  /** Remove groups that have no members and no points. */
  private pruneGroups() {
    const used = new Set([...this.players.values()].map((p) => p.groupId));
    for (const g of this.groups.values()) if (!used.has(g.id) && g.total === 0) this.groups.delete(g.id);
  }

  // ---------- bingo ----------

  draw(manual?: number): Result<{ number: number }> {
    const max = this.quiz.settings.bingoMax;
    let n: number;
    if (manual != null) {
      n = Math.round(Number(manual));
      if (!(n >= 1 && n <= max)) return { ok: false, error: `Number must be between 1 and ${max}.` };
      if (this.drawn.includes(n)) return { ok: false, error: `${n} has already been drawn.` };
    } else {
      const left: number[] = [];
      for (let i = 1; i <= max; i++) if (!this.drawn.includes(i)) left.push(i);
      if (!left.length) return { ok: false, error: 'All numbers have been drawn.' };
      n = left[Math.floor(Math.random() * left.length)];
    }
    this.drawn.push(n);
    this.stopTimer();
    if (this.current && !this.current.reveal) this.revealNow();
    this.phase = 'number';
    this.changed();
    return { ok: true, number: n };
  }

  undoDraw(): Result {
    if (!this.drawn.length) return { ok: false, error: 'Nothing to undo.' };
    this.drawn.pop();
    this.changed();
    return { ok: true };
  }

  resetBingo(): Result {
    this.drawn = [];
    this.changed();
    return { ok: true };
  }

  // ---------- questions ----------

  startQuestion(index?: number): Result {
    const i = index ?? this.questionIndex + 1;
    const q = this.quiz.questions[i];
    if (!q) return { ok: false, error: 'There are no more questions.' };
    this.stopTimer();
    if (this.current && !this.current.reveal) this.revealNow();
    this.undoAwards(q.id);
    const now = Date.now();
    this.questionIndex = i;
    this.current = {
      index: i,
      startedAt: now,
      endsAt: now + q.timeLimit * 1000,
      closed: false,
      answers: new Map(),
      reveal: null,
      results: new Map(),
    };
    this.phase = 'question';
    this.mediaStopped = false;
    this.mediaNonce++;
    this.timer = setTimeout(() => this.timeUp(), q.timeLimit * 1000 + 300);
    this.changed();
    return { ok: true };
  }

  answer(playerId: string, choiceIn: unknown): Result {
    const c = this.current;
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: 'Unknown player.' };
    if (this.phase !== 'question' || !c || c.closed) return { ok: false, error: 'Answers are closed.' };
    const q = this.quiz.questions[c.index];
    const choice = Number(choiceIn);
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.answers.length) return { ok: false, error: 'Invalid answer.' };
    if (c.answers.has(playerId)) return { ok: false, error: 'You already answered.' };
    if (Date.now() > c.endsAt + 250) return { ok: false, error: "Time's up!" };
    c.answers.set(playerId, { choice, at: Date.now() });
    if (this.quiz.settings.autoReveal && this.everyoneAnswered()) {
      this.stopTimer();
      this.timer = setTimeout(() => this.reveal(), 600);
    }
    this.changed();
    return { ok: true };
  }

  private everyoneAnswered() {
    const c = this.current!;
    const online = [...this.players.values()].filter((p) => p.sockets.size > 0);
    return online.length > 0 && online.every((p) => c.answers.has(p.id));
  }

  private timeUp() {
    this.timer = null;
    if (!this.current || this.current.reveal) return;
    if (this.quiz.settings.autoReveal) this.reveal();
    else {
      this.current.closed = true;
      this.changed();
    }
  }

  closeAnswers(): Result {
    if (!this.current || this.phase !== 'question') return { ok: false, error: 'No open question.' };
    this.current.closed = true;
    this.current.endsAt = Math.min(this.current.endsAt, Date.now());
    this.stopTimer();
    this.changed();
    return { ok: true };
  }

  reveal(): Result {
    if (!this.current) return { ok: false, error: 'No question to reveal.' };
    this.stopTimer();
    if (!this.current.reveal) this.revealNow();
    this.phase = 'reveal';
    this.changed();
    return { ok: true };
  }

  /** Score the current question. */
  private revealNow() {
    const c = this.current!;
    const q = this.quiz.questions[c.index];
    c.closed = true;
    c.endsAt = Math.min(c.endsAt, Date.now());
    const counts = q.answers.map(() => 0);
    const sorted = [...c.answers.entries()].sort((a, b) => a[1].at - b[1].at);
    let first: RevealInfo['firstCorrect'] = null;
    const awards: Award[] = [];
    for (const [pid, a] of sorted) {
      counts[a.choice]++;
      const p = this.players.get(pid);
      if (!p) continue;
      const correct = a.choice === q.correct;
      const isFirst = correct && !first;
      const points = correct ? q.points + (isFirst ? this.quiz.settings.firstBonus : 0) : 0;
      if (isFirst) {
        const g = p.groupId ? this.groups.get(p.groupId) : null;
        first = { id: p.id, name: p.name, groupName: g?.name ?? null, ms: a.at - c.startedAt };
      }
      p.score += points;
      if (correct) p.correct++;
      if (isFirst) p.firsts++;
      const g = p.groupId ? this.groups.get(p.groupId) : null;
      if (g) g.total += points;
      awards.push({ playerId: pid, groupId: g ? g.id : null, points, correct, first: isFirst });
      c.results.set(pid, { correct, points, first: isFirst });
    }
    this.history.set(q.id, awards);
    c.reveal = { correct: q.correct, counts, correctCount: counts[q.correct] ?? 0, firstCorrect: first };
  }

  /** If a question is played again, take back the points it gave the first time. */
  private undoAwards(questionId: string) {
    const awards = this.history.get(questionId);
    if (!awards) return;
    for (const a of awards) {
      const p = this.players.get(a.playerId);
      if (p) {
        p.score -= a.points;
        if (a.correct) p.correct--;
        if (a.first) p.firsts--;
      }
      const g = a.groupId ? this.groups.get(a.groupId) : null;
      if (g) g.total -= a.points;
    }
    this.history.delete(questionId);
  }

  showLeaderboard(): Result {
    this.stopTimer();
    if (this.current && !this.current.reveal) this.revealNow();
    this.phase = 'leaderboard';
    this.changed();
    return { ok: true };
  }

  backToLobby(): Result {
    this.stopTimer();
    if (this.current && !this.current.reveal) this.revealNow();
    this.phase = 'lobby';
    this.changed();
    return { ok: true };
  }

  end(): Result {
    this.stopTimer();
    if (this.current && !this.current.reveal) this.revealNow();
    this.phase = 'ended';
    this.changed();
    return { ok: true };
  }

  adjustScore(playerId: string, delta: number): Result {
    const p = this.players.get(playerId);
    if (!p || !Number.isFinite(delta)) return { ok: false, error: 'Unknown player.' };
    p.score += Math.round(delta);
    const g = p.groupId ? this.groups.get(p.groupId) : null;
    if (g) g.total += Math.round(delta);
    this.changed();
    return { ok: true };
  }

  announce(text: unknown): Result {
    const t = String(text ?? '').trim().slice(0, 140);
    this.announcement = t ? { text: t, at: Date.now() } : null;
    this.changed();
    return { ok: true };
  }

  media(action: 'replay' | 'stop'): Result {
    if (action === 'replay') {
      this.mediaNonce++;
      this.mediaStopped = false;
    } else this.mediaStopped = true;
    this.changed();
    return { ok: true };
  }

  private stopTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose() {
    this.stopTimer();
  }

  // ---------- views ----------

  playerRows(): PlayerRow[] {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        correct: p.correct,
        firsts: p.firsts,
        groupId: p.groupId,
        connected: p.sockets.size > 0,
      }))
      .sort((a, b) => b.score - a.score || b.firsts - a.firsts || a.name.localeCompare(b.name));
  }

  groupRows(): GroupRow[] {
    const members = new Map<string, number>();
    for (const p of this.players.values()) if (p.groupId) members.set(p.groupId, (members.get(p.groupId) ?? 0) + 1);
    const avg = this.quiz.settings.groupScoring === 'average';
    return [...this.groups.values()]
      .map((g) => {
        const m = members.get(g.id) ?? 0;
        return { id: g.id, name: g.name, total: g.total, members: m, score: avg ? Math.round(g.total / Math.max(1, m)) : g.total };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  liveQuestion(): LiveQuestion | null {
    const c = this.current;
    if (!c) return null;
    const q = this.quiz.questions[c.index];
    return {
      index: c.index,
      total: this.quiz.questions.length,
      id: q.id,
      kind: q.kind,
      text: q.text,
      answers: q.answers,
      timeLimit: q.timeLimit,
      points: q.points,
      media: q.media,
      image: q.image,
      startedAt: c.startedAt,
      endsAt: c.endsAt,
      closed: c.closed,
    };
  }

  publicState(): PublicState {
    const showQuestion = this.phase === 'question' || this.phase === 'reveal';
    return {
      code: this.code,
      title: this.quiz.title,
      phase: this.phase,
      serverNow: Date.now(),
      settings: this.quiz.settings,
      drawn: this.drawn,
      lastNumber: this.drawn.length ? this.drawn[this.drawn.length - 1] : null,
      questionCount: this.quiz.questions.length,
      questionIndex: this.questionIndex,
      question: showQuestion ? this.liveQuestion() : null,
      reveal: showQuestion ? (this.current?.reveal ?? null) : null,
      answeredCount: this.current?.answers.size ?? 0,
      players: this.playerRows(),
      groups: this.groupRows(),
      announcement: this.announcement,
      mediaNonce: this.mediaNonce,
      mediaStopped: this.mediaStopped,
    };
  }

  playerYou(playerId: string, rows: PlayerRow[]): PlayerYou | null {
    const p = this.players.get(playerId);
    if (!p) return null;
    const c = this.current;
    const showQuestion = this.phase === 'question' || this.phase === 'reveal';
    return {
      id: p.id,
      name: p.name,
      groupId: p.groupId,
      score: p.score,
      rank: rows.findIndex((r) => r.id === p.id) + 1,
      answer: showQuestion ? (c?.answers.get(p.id)?.choice ?? null) : null,
      result: showQuestion && c?.reveal ? (c.results.get(p.id) ?? { correct: false, points: 0, first: false }) : null,
    };
  }

  presenterExtra(): PresenterExtra {
    const c = this.current;
    const q = c ? this.quiz.questions[c.index] : null;
    const liveCounts = q ? q.answers.map(() => 0) : [];
    const answers: PresenterExtra['answers'] = [];
    if (c) {
      for (const [pid, a] of c.answers) {
        liveCounts[a.choice]++;
        answers.push({ playerId: pid, name: this.players.get(pid)?.name ?? '?', choice: a.choice, ms: a.at - c.startedAt });
      }
      answers.sort((a, b) => a.ms - b.ms);
    }
    return {
      correct: q ? q.correct : null,
      liveCounts,
      answers,
      questions: this.quiz.questions.map((x) => ({ id: x.id, text: x.text, kind: x.kind, answers: x.answers, correct: x.correct })),
    };
  }

  // ---------- persistence ----------

  toJSON() {
    const c = this.current;
    return {
      code: this.code,
      quiz: this.quiz,
      createdAt: this.createdAt,
      phase: this.phase,
      players: [...this.players.values()].map(({ sockets, ...p }) => p),
      groups: [...this.groups.values()],
      drawn: this.drawn,
      questionIndex: this.questionIndex,
      current: c ? { ...c, answers: [...c.answers.entries()], results: [...c.results.entries()] } : null,
      history: [...this.history.entries()],
      announcement: this.announcement,
    };
  }

  static fromJSON(data: any, onChange: (g: Game) => void): Game {
    const g = new Game(data.code, data.quiz, onChange);
    g.createdAt = data.createdAt;
    g.phase = data.phase;
    for (const p of data.players) g.players.set(p.id, { ...p, sockets: new Set() });
    for (const gr of data.groups) g.groups.set(gr.id, gr);
    g.drawn = data.drawn;
    g.questionIndex = data.questionIndex;
    g.history = new Map(data.history);
    g.announcement = data.announcement;
    if (data.current) {
      g.current = { ...data.current, answers: new Map(data.current.answers), results: new Map(data.current.results) };
      // a question that was open when the server stopped stays closed; the presenter can reveal or restart it
      if (g.current && !g.current.reveal) g.current.closed = true;
    }
    return g;
  }
}
