import { useEffect, useRef, useState } from 'react';
import type { GameSummary, Quiz, QuizSummary } from '../../../shared/types.ts';
import { AuthError, api, download, go } from './api.ts';
import { newQuizTemplate } from './templates.ts';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Waiting for players',
  number: 'Number drawn',
  question: 'Question running',
  reveal: 'Answer shown',
  leaderboard: 'Leaderboard',
  ended: 'Finished',
};

export function Home({ onAuthError }: { onAuthError: () => void }) {
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const guard = async (fn: () => Promise<void>) => {
    setErr('');
    try {
      await fn();
    } catch (e: any) {
      if (e instanceof AuthError) onAuthError();
      else setErr(e.message);
    }
  };

  const load = () =>
    guard(async () => {
      const [q, g] = await Promise.all([api<QuizSummary[]>('/api/quizzes'), api<GameSummary[]>('/api/games')]);
      setQuizzes(q);
      setGames(g);
    });

  useEffect(() => {
    void load();
    const id = setInterval(() => api<GameSummary[]>('/api/games').then(setGames).catch(() => {}), 5000);
    return () => clearInterval(id);
  }, []);

  const create = () =>
    guard(async () => {
      const q = await api<Quiz>('/api/quizzes', { method: 'POST', body: newQuizTemplate() });
      go(`/quiz/${q.id}`);
    });

  const duplicate = (id: string) =>
    guard(async () => {
      const q = await api<Quiz>(`/api/quizzes/${id}`);
      await api('/api/quizzes', { method: 'POST', body: { ...q, id: '', title: `${q.title} (copy)` } });
      await load();
    });

  const remove = (q: QuizSummary) =>
    guard(async () => {
      if (!confirm(`Delete "${q.title}"? This cannot be undone.`)) return;
      await api(`/api/quizzes/${q.id}`, { method: 'DELETE' });
      await load();
    });

  const exportQuiz = (q: QuizSummary) =>
    guard(async () => {
      const full = await api<Quiz>(`/api/quizzes/${q.id}`);
      download(`${q.title.replace(/[^\w\- ]+/g, '').trim() || 'quiz'}.musicalbingo.json`, JSON.stringify(full, null, 2));
    });

  const importQuiz = (file: File) =>
    guard(async () => {
      const data = JSON.parse(await file.text());
      const q = await api<Quiz>('/api/quizzes', { method: 'POST', body: { ...data, id: '' } });
      go(`/quiz/${q.id}`);
    });

  const start = (q: QuizSummary) =>
    guard(async () => {
      const { code } = await api<{ code: string }>('/api/games', { method: 'POST', body: { quizId: q.id } });
      go(`/live/${code}`);
    });

  const closeGame = (g: GameSummary) =>
    guard(async () => {
      if (!confirm(`Close game ${g.code}? Players will be disconnected. Results are saved in the data/results folder.`)) return;
      await api(`/api/games/${g.code}`, { method: 'DELETE' });
      await load();
    });

  return (
    <div className="page">
      <header className="topbar">
        <h1>🎵 Musical Bingo · Presenter</h1>
        <div className="row">
          <a className="btn" href="#/cards">
            🖨 Print bingo cards
          </a>
          <a className="btn" href="/display" target="_blank">
            📺 Open big screen
          </a>
        </div>
      </header>

      {err && <p className="error">{err}</p>}

      {games.length > 0 && (
        <section>
          <h2>Live games</h2>
          <div className="cards-list">
            {games.map((g) => (
              <div key={g.code} className="panel game-card">
                <div>
                  <div className="game-code">{g.code}</div>
                  <strong>{g.title}</strong>
                  <div className="muted">
                    {PHASE_LABEL[g.phase]} · {g.players} player{g.players === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="row">
                  <a className="btn primary" href={`#/live/${g.code}`}>
                    Control
                  </a>
                  <a className="btn" href={`/display?code=${g.code}`} target="_blank">
                    Big screen
                  </a>
                  <button className="btn danger" onClick={() => closeGame(g)}>
                    Close
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Quizzes</h2>
          <div className="row">
            <button className="btn" onClick={() => fileRef.current?.click()}>
              ⬆ Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void importQuiz(f);
              }}
            />
            <button className="btn primary" onClick={create}>
              ＋ New quiz
            </button>
          </div>
        </div>
        {quizzes && !quizzes.length && (
          <div className="panel empty">
            <p>No quizzes yet. Create one and add your questions: song clips from YouTube or audio files, and pictures that are revealed piece by piece.</p>
            <button className="btn primary big" onClick={create}>
              ＋ Create your first quiz
            </button>
          </div>
        )}
        <div className="cards-list">
          {quizzes?.map((q) => (
            <div key={q.id} className="panel quiz-card">
              <div>
                <strong className="quiz-title">{q.title}</strong>
                <div className="muted">
                  {q.questionCount} question{q.questionCount === 1 ? '' : 's'} · edited {new Date(q.updatedAt).toLocaleDateString()}
                </div>
                {q.description && <p className="muted small">{q.description}</p>}
              </div>
              <div className="row">
                <button className="btn primary" disabled={!q.questionCount} onClick={() => start(q)} title="Start a live game with this quiz">
                  ▶ Start game
                </button>
                <a className="btn" href={`#/quiz/${q.id}`}>
                  ✎ Edit
                </a>
                <button className="btn small" onClick={() => duplicate(q.id)}>
                  Duplicate
                </button>
                <button className="btn small" onClick={() => exportQuiz(q)}>
                  Export
                </button>
                <button className="btn small danger" onClick={() => remove(q)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
